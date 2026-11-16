/**
 * Calendário: aniversários da equipe (os feriados nacionais são calculados no
 * front com nationalHolidays do @sgi/core). Todos consultam; ADMIN e GESTOR alteram.
 * O ano de nascimento só é devolvido para quem pode editar.
 */
import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { parseBirthday } from '@sgi/core';
import { birthdays } from '../db/schema.js';
import { HttpError, notFound, parse, uuid } from '../plugins/http.js';
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
}
