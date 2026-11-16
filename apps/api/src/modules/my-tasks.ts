/**
 * Tarefas pessoais e rotina diária. Cada usuário vê e altera só as próprias
 * (toda consulta filtra por organização E usuário).
 */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { personalTasks, routineChecks, routineItems } from '../db/schema.js';
import { HttpError, isoDate, notFound, parse, uuid } from '../plugins/http.js';
import { audit } from '../services/audit.js';

const idParam = z.object({ id: uuid });
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullable().optional().transform((v) => (v ? v : null));
const status = z.enum(['A_FAZER', 'AGUARDANDO', 'FEITA']);

/** Data de hoje no fuso de São Paulo (AAAA-MM-DD). */
export const todaySP = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);

export default async function myTaskRoutes(app: FastifyInstance) {
  const { db } = app;
  const auth = { onRequest: [app.authenticate] };
  const mine = (id?: string) => (req: { user: { org: string; sub: string } }) =>
    and(eq(personalTasks.organizationId, req.user.org), eq(personalTasks.userId, req.user.sub), ...(id ? [eq(personalTasks.id, id)] : []));
  const myItem = (id: string, req: { user: { org: string; sub: string } }) =>
    and(eq(routineItems.id, id), eq(routineItems.organizationId, req.user.org), eq(routineItems.userId, req.user.sub));

  /* ---- tarefas ---- */
  // Abertas + feitas nos últimos 30 dias (as mais antigas ficam guardadas, fora da tela).
  app.get('/my/tasks', auth, async (req) => {
    const since = new Date(Date.now() - 30 * 86400_000);
    return db.select().from(personalTasks)
      .where(and(mine()(req), or(isNull(personalTasks.doneAt), gte(personalTasks.doneAt, since))))
      .orderBy(asc(personalTasks.dueDate), desc(personalTasks.createdAt));
  });

  app.post('/my/tasks', auth, async (req, reply) => {
    const b = parse(z.object({ title: text(300).min(1, 'Escreva a tarefa.'), details: optText(2000), person: optText(80), dueDate: isoDate.nullable().optional() }), req.body);
    const [t] = await db.insert(personalTasks).values({ ...b, organizationId: req.user.org, userId: req.user.sub }).returning();
    await audit(db, req, 'create', 'personal_task', t.id);
    return reply.code(201).send(t);
  });

  app.patch('/my/tasks/:id', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ title: text(300).min(1), details: optText(2000), person: optText(80), dueDate: isoDate.nullable(), status }).partial(), req.body);
    if (!Object.keys(b).length) throw new HttpError(400, 'empty', 'Nada para alterar.');
    const [t] = await db.update(personalTasks).set({ ...b, ...(b.status ? { doneAt: b.status === 'FEITA' ? new Date() : null } : {}) })
      .where(mine(id)(req)).returning();
    if (!t) throw notFound('Tarefa');
    await audit(db, req, 'update', 'personal_task', id, b.status ? { status: b.status } : undefined);
    return t;
  });

  app.delete('/my/tasks/:id', auth, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const [t] = await db.delete(personalTasks).where(mine(id)(req)).returning({ id: personalTasks.id });
    if (!t) throw notFound('Tarefa');
    await audit(db, req, 'delete', 'personal_task', id);
    return reply.code(204).send();
  });

  /* ---- rotina diária ---- */
  app.get('/my/routine', auth, async (req) => {
    const day = todaySP();
    const items = await db.select().from(routineItems)
      .where(and(eq(routineItems.organizationId, req.user.org), eq(routineItems.userId, req.user.sub), eq(routineItems.active, true)))
      .orderBy(asc(routineItems.position), asc(routineItems.createdAt));
    const checks = items.length ? await db.select({ itemId: routineChecks.itemId }).from(routineChecks)
      .where(and(inArray(routineChecks.itemId, items.map((i) => i.id)), eq(routineChecks.day, day))) : [];
    const done = new Set(checks.map((c) => c.itemId));
    return { day, items: items.map((i) => ({ id: i.id, title: i.title, checked: done.has(i.id) })) };
  });

  app.post('/my/routine', auth, async (req, reply) => {
    const b = parse(z.object({ title: text(120).min(1, 'Escreva o item da rotina.') }), req.body);
    const [i] = await db.insert(routineItems).values({ organizationId: req.user.org, userId: req.user.sub, title: b.title, position: Date.now() % 2_000_000_000 }).returning();
    await audit(db, req, 'create', 'routine_item', i.id);
    return reply.code(201).send(i);
  });

  // Remover um item só o desativa: as marcações antigas continuam no histórico.
  app.delete('/my/routine/:id', auth, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const [i] = await db.update(routineItems).set({ active: false }).where(myItem(id, req)).returning({ id: routineItems.id });
    if (!i) throw notFound('Item da rotina');
    await audit(db, req, 'delete', 'routine_item', id);
    return reply.code(204).send();
  });

  app.put('/my/routine/:id/check', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const { checked } = parse(z.object({ checked: z.boolean() }), req.body);
    const [i] = await db.select({ id: routineItems.id }).from(routineItems).where(myItem(id, req));
    if (!i) throw notFound('Item da rotina');
    const day = todaySP();
    if (checked) await db.insert(routineChecks).values({ organizationId: req.user.org, itemId: id, day }).onConflictDoNothing();
    else await db.delete(routineChecks).where(and(eq(routineChecks.itemId, id), eq(routineChecks.day, day)));
    await audit(db, req, checked ? 'check' : 'uncheck', 'routine_item', id, { day });
    return { id, day, checked };
  });
}
