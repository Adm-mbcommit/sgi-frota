/** Manutenção, documentos, custos e pendências. */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { costCategories, costs, maintenancePlan, maintenanceRecords, tasks, vehicleDocuments, vehicles } from '../db/schema.js';
import { HttpError, isoDate, notFound, parse, uuid } from '../plugins/http.js';
import { WRITE_ROLES } from '../plugins/auth.js';
import { analyzeOrg } from '../services/fleet.js';
import { audit } from '../services/audit.js';

const idParam = z.object({ id: uuid });
const costBody = z.object({
  date: isoDate, vehicleId: uuid.nullable(), category: z.enum(costCategories), description: z.string().min(1), supplier: z.string().nullable().optional(),
  amount: z.number().nonnegative().nullable(), invoice: z.string().nullable().optional(), notes: z.string().nullable().optional(),
});

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

  /** Registrar serviço executado: grava histórico, reinicia o prazo e (opcional) lança o custo. */
  app.post('/maintenance/plan/:id/records', write, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ km: z.number().int().nonnegative(), date: isoDate, supplier: z.string().nullable().optional(), invoice: z.string().nullable().optional(),
      amount: z.number().nonnegative().nullable().optional(), notes: z.string().nullable().optional() }), req.body);
    const [p] = await db.select().from(maintenancePlan).where(and(eq(maintenancePlan.id, id), eq(maintenancePlan.organizationId, req.user.org)));
    if (!p) throw notFound('Item do plano');
    const rec = await db.transaction(async (tx) => {
      let costId: string | null = null;
      if (b.amount != null) {
        const [c] = await tx.insert(costs).values({ organizationId: req.user.org, vehicleId: p.vehicleId, date: b.date, category: 'Manutenção', description: p.item,
          supplier: b.supplier ?? null, amount: b.amount, invoice: b.invoice ?? null, notes: b.notes ?? null, userId: req.user.sub }).returning();
        costId = c.id;
      }
      const [r] = await tx.insert(maintenanceRecords).values({ organizationId: req.user.org, planItemId: p.id, vehicleId: p.vehicleId, item: p.item, km: b.km, date: b.date,
        supplier: b.supplier ?? null, invoice: b.invoice ?? null, notes: b.notes ?? null, costId, userId: req.user.sub }).returning();
      await tx.update(maintenancePlan).set({ lastKm: b.km, lastDate: b.date, needsCheck: false, source: `Registrado no SGI em ${b.date}${b.supplier ? ' · ' + b.supplier : ''}` }).where(eq(maintenancePlan.id, p.id));
      return r;
    });
    await audit(db, req, 'record', 'maintenance', rec.id, b);
    return reply.code(201).send(rec);
  });

  app.get('/maintenance/records', read, async (req) =>
    db.select({ r: maintenanceRecords, vehicleName: vehicles.name }).from(maintenanceRecords).innerJoin(vehicles, eq(vehicles.id, maintenanceRecords.vehicleId))
      .where(eq(maintenanceRecords.organizationId, req.user.org)).orderBy(desc(maintenanceRecords.date)).then((rows) => rows.map((x) => ({ ...x.r, vehicleName: x.vehicleName }))));

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
  app.get('/costs', read, async (req) =>
    db.select({ c: costs, vehicleName: vehicles.name }).from(costs).leftJoin(vehicles, eq(vehicles.id, costs.vehicleId))
      .where(eq(costs.organizationId, req.user.org)).orderBy(desc(costs.date)).then((rows) => rows.map((x) => ({ ...x.c, vehicleName: x.vehicleName }))));
  app.get('/costs/categories', read, async () => costCategories);
  app.post('/costs', write, async (req, reply) => {
    const b = parse(costBody, req.body);
    const [c] = await db.insert(costs).values({ ...b, organizationId: req.user.org, userId: req.user.sub }).returning();
    await audit(db, req, 'create', 'cost', c.id, b);
    return reply.code(201).send(c);
  });
  app.patch('/costs/:id', write, async (req) => {
    const { id } = parse(idParam, req.params); const b = parse(costBody.partial(), req.body);
    const [c] = await db.update(costs).set(b).where(and(eq(costs.id, id), eq(costs.organizationId, req.user.org))).returning();
    if (!c) throw notFound('Custo');
    await audit(db, req, 'update', 'cost', id, b);
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
