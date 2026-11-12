/** Manutenção, documentos, custos e pendências. */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { costCategories, costs, maintenancePlan, maintenanceRecords, tasks, vehicleDocuments, vehicles } from '../db/schema.js';
import { HttpError, isoDate, notFound, parse, uuid } from '../plugins/http.js';
import { WRITE_ROLES } from '../plugins/auth.js';
import { analyzeOrg } from '../services/fleet.js';
import { audit } from '../services/audit.js';
import { applyToPlan, brDate } from '../services/maintenance.js';
import type { DB } from '../db/client.js';

const idParam = z.object({ id: uuid });
const costBody = z.object({
  date: isoDate, vehicleId: uuid.nullable(), category: z.enum(costCategories), description: z.string().min(1), supplier: z.string().nullable().optional(),
  amount: z.number().nonnegative().nullable(), invoice: z.string().nullable().optional(), notes: z.string().nullable().optional(),
  /** Itens do plano feitos neste serviço (ex.: revisão). Atualizam o prazo na tela Manutenção. */
  maintenance: z.object({ km: z.number().int().nonnegative().nullable(), planItemIds: z.array(uuid) }).optional(),
});

type Cost = typeof costs.$inferSelect;

/**
 * Liga o custo aos itens do plano: substitui os registros de histórico deste custo
 * e avança o prazo de cada item (se o serviço for mais recente que o último registrado).
 */
async function linkCostToPlan(db: DB, c: Cost, m: { km: number | null; planItemIds: string[] }, userId: string) {
  await db.delete(maintenanceRecords).where(eq(maintenanceRecords.costId, c.id));
  if (!m.planItemIds.length) return;
  if (!c.vehicleId) throw new HttpError(400, 'vehicle_required', 'Escolha o veículo para marcar os itens do plano de manutenção.');
  if (m.km == null) throw new HttpError(400, 'km_required', 'Informe o km do serviço para atualizar o plano de manutenção.');
  const items = await db.select().from(maintenancePlan).where(and(inArray(maintenancePlan.id, m.planItemIds), eq(maintenancePlan.organizationId, c.organizationId), eq(maintenancePlan.vehicleId, c.vehicleId)));
  if (items.length !== new Set(m.planItemIds).size) throw new HttpError(400, 'plan_item', 'Item do plano não pertence a este veículo.');
  for (const p of items) {
    await db.insert(maintenanceRecords).values({ organizationId: c.organizationId, planItemId: p.id, vehicleId: c.vehicleId, item: p.item, km: m.km, date: c.date,
      supplier: c.supplier, invoice: c.invoice, notes: c.description, costId: c.id, source: 'SGI', userId });
    await applyToPlan(db, p, m.km, c.date, `Custos: ${c.description} em ${brDate(c.date)}${c.supplier ? ' · ' + c.supplier : ''}`);
  }
}

export default async function managementRoutes(app: FastifyInstance) {
  const { db } = app;
  const read = { onRequest: [app.authenticate] };
  const write = { onRequest: [app.authenticate, app.requireRole(...WRITE_ROLES)] };

  /* ---- manutenção ---- */
  app.get('/maintenance/plan', read, async (req) => {
    const { analysis: A, ids } = await analyzeOrg(db, req.user.org);
    return A.plan.map((p) => ({ ...p, vehicleId: ids.vehicleByPlate.get(p.plate), vehicleName: A.vehicles.find((v) => v.plate === p.plate)?.name }));
  });

  app.post('/maintenance/plan', write, async (req, reply) => {
    const b = parse(z.object({ vehicleId: uuid, item: z.string().min(1), intervalKm: z.number().int().positive().nullable(), intervalMonths: z.number().int().positive().nullable(),
      lastKm: z.number().int().nullable().optional(), lastDate: isoDate.nullable().optional(), needsCheck: z.boolean().default(false) }), req.body);
    const [p] = await db.insert(maintenancePlan).values({ ...b, organizationId: req.user.org, source: 'Cadastrado no SGI' }).returning();
    await audit(db, req, 'create', 'maintenance_plan', p.id, b);
    return reply.code(201).send(p);
  });

  app.patch('/maintenance/plan/:id', write, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ item: z.string().min(1), intervalKm: z.number().int().positive().nullable(), intervalMonths: z.number().int().positive().nullable(),
      lastKm: z.number().int().nullable(), lastDate: isoDate.nullable(), needsCheck: z.boolean(), active: z.boolean() }).partial(), req.body);
    const [p] = await db.update(maintenancePlan).set(b).where(and(eq(maintenancePlan.id, id), eq(maintenancePlan.organizationId, req.user.org))).returning();
    if (!p) throw notFound('Item do plano');
    await audit(db, req, 'update', 'maintenance_plan', id, b);
    return p;
  });

  /**
   * Registrar serviço executado sem custo (ex.: confirmado por NF antiga). Grava histórico e reinicia o prazo.
   * O valor de um serviço é lançado em Custos, que também atualiza o plano: assim nada é lançado duas vezes.
   */
  app.post('/maintenance/plan/:id/records', write, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ km: z.number().int().nonnegative(), date: isoDate, supplier: z.string().nullable().optional(), invoice: z.string().nullable().optional(),
      notes: z.string().nullable().optional() }), req.body);
    const [p] = await db.select().from(maintenancePlan).where(and(eq(maintenancePlan.id, id), eq(maintenancePlan.organizationId, req.user.org)));
    if (!p) throw notFound('Item do plano');
    const rec = await db.transaction(async (tx) => {
      const [r] = await tx.insert(maintenanceRecords).values({ organizationId: req.user.org, planItemId: p.id, vehicleId: p.vehicleId, item: p.item, km: b.km, date: b.date,
        supplier: b.supplier ?? null, invoice: b.invoice ?? null, notes: b.notes ?? null, source: 'SGI', userId: req.user.sub }).returning();
      await tx.update(maintenancePlan).set({ lastKm: b.km, lastDate: b.date, needsCheck: false, source: `Registrado no SGI em ${brDate(b.date)}${b.supplier ? ' · ' + b.supplier : ''}` }).where(eq(maintenancePlan.id, p.id));
      return r;
    });
    await audit(db, req, 'record', 'maintenance', rec.id, b);
    return reply.code(201).send(rec);
  });

  app.get('/maintenance/records', read, async (req) =>
    db.select({ r: maintenanceRecords, vehicleName: vehicles.name }).from(maintenanceRecords).innerJoin(vehicles, eq(vehicles.id, maintenanceRecords.vehicleId))
      .where(eq(maintenanceRecords.organizationId, req.user.org)).orderBy(desc(maintenanceRecords.date), maintenanceRecords.item).then((rows) => rows.map((x) => ({ ...x.r, vehicleName: x.vehicleName }))));

  /* ---- documentos ---- */
  app.get('/documents', read, async (req) => {
    const { analysis: A, ids } = await analyzeOrg(db, req.user.org);
    return A.docs.map((d) => ({ ...d, vehicleId: ids.vehicleByPlate.get(d.plate), vehicleName: A.vehicles.find((v) => v.plate === d.plate)?.name }));
  });

  app.put('/documents/:id', write, async (req) => {
    const { id: vehicleId } = parse(idParam, req.params);
    const b = parse(z.object({ crlv: isoDate.nullable(), ipva: isoDate.nullable(), licensing: isoDate.nullable(), insurance: isoDate.nullable(),
      insurer: z.string().nullable().optional(), policy: z.string().nullable().optional(), confirmed: z.boolean() }), req.body);
    const [v] = await db.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.organizationId, req.user.org)));
    if (!v) throw notFound('Veículo');
    const [d] = await db.insert(vehicleDocuments).values({ ...b, vehicleId, organizationId: req.user.org })
      .onConflictDoUpdate({ target: vehicleDocuments.vehicleId, set: b }).returning();
    await audit(db, req, 'update', 'documents', vehicleId, b);
    return d;
  });

  /* ---- custos ---- */
  app.get('/costs', read, async (req) => {
    const [rows, links] = await Promise.all([
      db.select({ c: costs, vehicleName: vehicles.name }).from(costs).leftJoin(vehicles, eq(vehicles.id, costs.vehicleId))
        .where(eq(costs.organizationId, req.user.org)).orderBy(desc(costs.date)),
      db.select({ costId: maintenanceRecords.costId, planItemId: maintenanceRecords.planItemId, item: maintenanceRecords.item, km: maintenanceRecords.km }).from(maintenanceRecords)
        .where(and(eq(maintenanceRecords.organizationId, req.user.org), isNotNull(maintenanceRecords.costId))),
    ]);
    return rows.map((x) => {
      const l = links.filter((r) => r.costId === x.c.id);
      return { ...x.c, vehicleName: x.vehicleName, maintenance: l.length ? { km: l[0].km, planItemIds: l.flatMap((r) => (r.planItemId ? [r.planItemId] : [])), items: l.map((r) => r.item) } : null };
    });
  });
  app.get('/costs/categories', read, async () => costCategories);
  app.post('/costs', write, async (req, reply) => {
    const { maintenance, ...b } = parse(costBody, req.body);
    const c = await db.transaction(async (tx) => {
      const [c] = await tx.insert(costs).values({ ...b, organizationId: req.user.org, userId: req.user.sub }).returning();
      if (maintenance) await linkCostToPlan(tx as unknown as DB, c, maintenance, req.user.sub);
      return c;
    });
    await audit(db, req, 'create', 'cost', c.id, { ...b, maintenance });
    return reply.code(201).send(c);
  });
  app.patch('/costs/:id', write, async (req) => {
    const { id } = parse(idParam, req.params); const { maintenance, ...b } = parse(costBody.partial(), req.body);
    const c = await db.transaction(async (tx) => {
      const [c] = Object.keys(b).length
        ? await tx.update(costs).set(b).where(and(eq(costs.id, id), eq(costs.organizationId, req.user.org))).returning()
        : await tx.select().from(costs).where(and(eq(costs.id, id), eq(costs.organizationId, req.user.org)));
      if (!c) throw notFound('Custo');
      if (maintenance) await linkCostToPlan(tx as unknown as DB, c, maintenance, req.user.sub);
      return c;
    });
    await audit(db, req, 'update', 'cost', id, { ...b, maintenance });
    return c;
  });
  app.delete('/costs/:id', write, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const [c] = await db.delete(costs).where(and(eq(costs.id, id), eq(costs.organizationId, req.user.org))).returning();
    if (!c) throw notFound('Custo');
    await audit(db, req, 'delete', 'cost', id, c);
    return reply.code(204).send();
  });

  /* ---- pendências ---- */
  app.get('/tasks', read, async (req) => db.select().from(tasks).where(eq(tasks.organizationId, req.user.org)).orderBy(tasks.status, desc(tasks.createdAt)));
  app.post('/tasks', write, async (req, reply) => {
    const b = parse(z.object({ title: z.string().min(2), description: z.string().nullable().optional(), vehicleId: uuid.nullable().optional(), dueDate: isoDate.nullable().optional() }), req.body);
    const [t] = await db.insert(tasks).values({ ...b, organizationId: req.user.org }).returning();
    return reply.code(201).send(t);
  });
  app.patch('/tasks/:id', write, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ title: z.string().min(2), description: z.string().nullable(), status: z.enum(['ABERTO', 'RESOLVIDO', 'SUGESTAO']), dueDate: isoDate.nullable() }).partial(), req.body);
    if (!Object.keys(b).length) throw new HttpError(400, 'empty', 'Nada para alterar.');
    const [t] = await db.update(tasks).set({ ...b, ...(b.status ? { resolvedAt: b.status === 'RESOLVIDO' ? new Date() : null } : {}) })
      .where(and(eq(tasks.id, id), eq(tasks.organizationId, req.user.org))).returning();
    if (!t) throw notFound('Pendência');
    await audit(db, req, 'update', 'task', id, b);
    return t;
  });
}
