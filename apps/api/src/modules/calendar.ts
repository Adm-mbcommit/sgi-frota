/**
 * Calendário: compromissos (pessoais ou da equipe) e aniversários da equipe (os feriados nacionais são calculados no
 * front com nationalHolidays do @sgi/core). Todos consultam; ADMIN e GESTOR alteram.
 * O ano de nascimento só é devolvido para quem pode editar.
 */
import type { FastifyInstance } from 'fastify';
import { and, asc, eq, gte, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { parseBirthday } from '@sgi/core';
import { appointments, birthdays, users } from '../db/schema.js';
import { HttpError, isoDate, notFound, parse, uuid } from '../plugins/http.js';
import { WRITE_ROLES } from '../plugins/auth.js';
import { cellValue, readWorkbook } from '../importers/xlsx.js';
import { audit } from '../services/audit.js';

const idParam = z.object({ id: uuid });
const body = z.object({
  name: z.string().trim().min(2, 'Informe o nome.').max(120),
  day: z.number().int().min(1).max(31),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
}).refine((b) => !!parseBirthday(`${b.day}/${b.month}`), { message: 'Data inválida.', path: ['day'] });

export default async function calendarRoutes(app: FastifyInstance) {
  const { db } = app;
  const read = { onRequest: [app.authenticate] };
  const write = { onRequest: [app.authenticate, app.requireRole(...WRITE_ROLES)] };
  const mine = (id: string, org: string) => and(eq(birthdays.id, id), eq(birthdays.organizationId, org));

  app.get('/birthdays', read, async (req) => {
    const rows = await db.select().from(birthdays).where(eq(birthdays.organizationId, req.user.org)).orderBy(asc(birthdays.month), asc(birthdays.day), asc(birthdays.name));
    const canEdit = (WRITE_ROLES as readonly string[]).includes(req.user.role);
    return rows.map((r) => ({ id: r.id, name: r.name, day: r.day, month: r.month, ...(canEdit ? { year: r.year } : {}) }));
  });

  app.post('/birthdays', write, async (req, reply) => {
    const b = parse(body, req.body);
    const [r] = await db.insert(birthdays).values({ ...b, year: b.year ?? null, organizationId: req.user.org }).returning();
    await audit(db, req, 'create', 'birthday', r.id, { name: r.name });
    return reply.code(201).send(r);
  });

  app.patch('/birthdays/:id', write, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(body, req.body);
    const [r] = await db.update(birthdays).set({ ...b, year: b.year ?? null }).where(mine(id, req.user.org)).returning();
    if (!r) throw notFound('Aniversário');
    await audit(db, req, 'update', 'birthday', id, { name: r.name });
    return r;
  });

  app.delete('/birthdays/:id', write, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const [r] = await db.delete(birthdays).where(mine(id, req.user.org)).returning({ id: birthdays.id });
    if (!r) throw notFound('Aniversário');
    await audit(db, req, 'delete', 'birthday', id);
    return reply.code(204).send();
  });

  /**
   * Importa uma planilha .xlsx com nome e data de nascimento (em qualquer coluna, em qualquer aba).
   * Linhas sem nome ou sem data válida são ignoradas. Quem já existe (mesmo nome) é atualizado.
   */
  app.post('/birthdays/import', write, async (req) => {
    const file = await req.file();
    if (!file) throw new HttpError(400, 'file_required', 'Envie o arquivo .xlsx no campo "file".');
    if (!/\.xlsx$/i.test(file.filename)) throw new HttpError(400, 'file_type', 'Envie um arquivo .xlsx.');
    const wb = await readWorkbook(await file.toBuffer());
    const found = new Map<string, { name: string; day: number; month: number; year: number | null }>();
    for (const ws of wb.worksheets) {
      ws.eachRow({ includeEmpty: false }, (row) => {
        const cells = (row.values as unknown[]).slice(1).map((v) => cellValue(v as never));
        const name = cells.find((c) => typeof c === 'string' && /\p{L}{2,}/u.test(c) && !parseBirthday(c)) as string | undefined;
        const date = cells.map(parseBirthday).find(Boolean);
        if (!name || !date) return;
        const clean = name.trim().replace(/\s+/g, ' ');
        if (clean.length > 120) return;
        found.set(clean.toLowerCase(), { name: clean, ...date });
      });
    }
    if (!found.size) throw new HttpError(400, 'no_rows', 'Não encontrei nomes com data de aniversário na planilha.');
    const existing = new Map((await db.select({ id: birthdays.id, name: birthdays.name }).from(birthdays)
      .where(eq(birthdays.organizationId, req.user.org))).map((r) => [r.name.toLowerCase(), r.id]));
    let created = 0, updated = 0;
    for (const [key, b] of found) {
      const id = existing.get(key);
      if (id) { await db.update(birthdays).set(b).where(mine(id, req.user.org)); updated++; }
      else { await db.insert(birthdays).values({ ...b, organizationId: req.user.org }); created++; }
    }
    await audit(db, req, 'import', 'birthday', null, { file: file.filename, created, updated });
    return { created, updated };
  });

  /* ---- compromissos: pessoais, ou da equipe quando shared ---- */
  const apptBody = z.object({
    date: isoDate,
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM').nullable().optional(),
    title: z.string().trim().min(1, 'Escreva o compromisso.').max(200),
    notes: z.string().trim().max(2000).nullable().optional().transform((v) => v || null),
    shared: z.boolean().optional(),
  });
  const myAppt = (id: string, req: { user: { org: string; sub: string } }) =>
    and(eq(appointments.id, id), eq(appointments.organizationId, req.user.org), eq(appointments.userId, req.user.sub));

  app.get('/appointments', read, async (req) => {
    const q = parse(z.object({ from: isoDate, to: isoDate }), req.query);
    const rows = await db.select({ a: appointments, owner: users.name }).from(appointments)
      .innerJoin(users, eq(users.id, appointments.userId))
      .where(and(eq(appointments.organizationId, req.user.org), gte(appointments.date, q.from), lte(appointments.date, q.to),
        or(eq(appointments.userId, req.user.sub), eq(appointments.shared, true))))
      .orderBy(asc(appointments.date), asc(appointments.time));
    return rows.map(({ a, owner }) => ({ id: a.id, date: a.date, time: a.time, title: a.title, notes: a.notes, shared: a.shared, mine: a.userId === req.user.sub, owner }));
  });

  app.post('/appointments', read, async (req, reply) => {
    const b = parse(apptBody, req.body);
    const [a] = await db.insert(appointments).values({ ...b, time: b.time ?? null, shared: b.shared ?? false, organizationId: req.user.org, userId: req.user.sub }).returning();
    await audit(db, req, 'create', 'appointment', a.id, { date: a.date, shared: a.shared });
    return reply.code(201).send(a);
  });

  // só quem criou altera ou exclui
  app.patch('/appointments/:id', read, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(apptBody, req.body);
    const [a] = await db.update(appointments).set({ ...b, time: b.time ?? null, shared: b.shared ?? false }).where(myAppt(id, req)).returning();
    if (!a) throw notFound('Compromisso');
    await audit(db, req, 'update', 'appointment', id, { date: a.date, shared: a.shared });
    return a;
  });

  app.delete('/appointments/:id', read, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const [a] = await db.delete(appointments).where(myAppt(id, req)).returning({ id: appointments.id });
    if (!a) throw notFound('Compromisso');
    await audit(db, req, 'delete', 'appointment', id);
    return reply.code(204).send();
  });
}
