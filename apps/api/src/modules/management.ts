/** Manutenção, documentos, custos e pendências. */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { checklists, organizations, costCategories, costs, maintenancePlan, maintenanceRecords, tasks, vehicleDocuments, vehicles } from '../db/schema.js';
import { daysBetween, kmOnDate } from '@sgi/core';
import { HttpError, isoDate, notFound, parse, uuid } from '../plugins/http.js';
import { WRITE_ROLES } from '../plugins/auth.js';
import { analyzeOrg } from '../services/fleet.js';
import { audit } from '../services/audit.js';

const idParam = z.object({ id: uuid });
/** Palavras que indicam um serviço feito, nas observações dos checklists. */
const SERVICE_WORDS = '(revis[aã]o|troca d[eo] [óo]leo|oficina|nota fiscal|\\mNF\\M|alinhamento|balanceamento|pastilha|correia|pneus? novos?)';
const dateSP = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
/** O serviço é mais recente que o último registrado no item do plano? (data primeiro; km desempata ou vale quando não há data) */
export function isNewerService(p: { lastKm: number | null; lastDate: string | null }, b: { km: number; date: string }) {
  if (p.lastDate == null && p.lastKm == null) return true;
  if (p.lastDate != null && b.date !== p.lastDate) return b.date > p.lastDate;
  return p.lastKm == null || b.km >= p.lastKm;
}
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

  /**
   * Copia o plano de manutenção de um veículo para outro (mesmos itens e intervalos).
   * Km e data da última revisão do veículo de destino valem para todos os itens; sem eles, os itens
   * ficam marcados para conferir. Itens que o destino já tem são mantidos.
   */
  app.post('/maintenance/plan/copy', write, async (req, reply) => {
    const b = parse(z.object({ fromVehicleId: uuid, toVehicleId: uuid, lastKm: z.number().int().nonnegative().nullable().optional(), lastDate: isoDate.nullable().optional() })
      .refine((x) => x.fromVehicleId !== x.toVehicleId, { message: 'Escolha dois veículos diferentes.' }), req.body);
    const vs = await db.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.organizationId, req.user.org), inArray(vehicles.id, [b.fromVehicleId, b.toVehicleId])));
    if (vs.length !== 2) throw notFound('Veículo');
    const src = await db.select().from(maintenancePlan).where(and(eq(maintenancePlan.organizationId, req.user.org), eq(maintenancePlan.vehicleId, b.fromVehicleId), eq(maintenancePlan.active, true)));
    if (!src.length) throw new HttpError(400, 'empty_plan', 'O veículo de origem não tem plano de manutenção.');
    const have = new Set((await db.select({ item: maintenancePlan.item }).from(maintenancePlan).where(eq(maintenancePlan.vehicleId, b.toVehicleId))).map((x) => x.item.toLowerCase()));
    const rows = src.filter((x) => !have.has(x.item.toLowerCase())).map((x) => ({
      organizationId: req.user.org, vehicleId: b.toVehicleId, item: x.item, intervalKm: x.intervalKm, intervalMonths: x.intervalMonths,
      lastKm: b.lastKm ?? null, lastDate: b.lastDate ?? null, needsCheck: b.lastKm == null, source: 'Copiado no SGI de outro veículo',
    }));
    if (rows.length) await db.insert(maintenancePlan).values(rows);
    await audit(db, req, 'copy', 'maintenance_plan', b.toVehicleId, { ...b, created: rows.length });
    return reply.code(201).send({ created: rows.length, skipped: src.length - rows.length });
  });

  /** Registrar serviço executado: grava histórico, reinicia o prazo e (opcional) lança o custo. */
  app.post('/maintenance/plan/:id/records', write, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ km: z.number().int().nonnegative(), date: isoDate, supplier: z.string().nullable().optional(), invoice: z.string().nullable().optional(),
      amount: z.number().nonnegative().nullable().optional(), notes: z.string().nullable().optional(), costId: uuid.nullable().optional() }), req.body);
    const [p] = await db.select().from(maintenancePlan).where(and(eq(maintenancePlan.id, id), eq(maintenancePlan.organizationId, req.user.org)));
    if (!p) throw notFound('Item do plano');
    const rec = await db.transaction(async (tx) => {
      let costId: string | null = null;
      if (b.costId) {
        // serviço que já está em Custos: só liga o registro ao custo existente
        const [c] = await tx.select({ id: costs.id }).from(costs).where(and(eq(costs.id, b.costId), eq(costs.organizationId, req.user.org), eq(costs.vehicleId, p.vehicleId)));
        if (!c) throw notFound('Custo');
        costId = c.id;
      } else if (b.amount != null) {
        const [c] = await tx.insert(costs).values({ organizationId: req.user.org, vehicleId: p.vehicleId, date: b.date, category: 'Manutenção', description: p.item,
          supplier: b.supplier ?? null, amount: b.amount, invoice: b.invoice ?? null, notes: b.notes ?? null, userId: req.user.sub }).returning();
        costId = c.id;
      }
      const [r] = await tx.insert(maintenanceRecords).values({ organizationId: req.user.org, planItemId: p.id, vehicleId: p.vehicleId, item: p.item, km: b.km, date: b.date,
        supplier: b.supplier ?? null, invoice: b.invoice ?? null, notes: b.notes ?? null, costId, userId: req.user.sub }).returning();
      // serviço antigo (anterior ao último registrado) entra só no histórico, sem mexer no prazo
      if (isNewerService(p, b)) {
        await tx.update(maintenancePlan).set({ lastKm: b.km, lastDate: b.date, needsCheck: false, source: `Registrado no SGI: serviço de ${b.date}${b.supplier ? ' · ' + b.supplier : ''}${b.invoice ? ' · NF ' + b.invoice : ''}` }).where(eq(maintenancePlan.id, p.id));
        return { ...r, updatedPlan: true };
      }
      return { ...r, updatedPlan: false };
    });
    await audit(db, req, 'record', 'maintenance', rec.id, { ...b, updatedPlan: rec.updatedPlan });
    return reply.code(201).send(rec);
  });

  /**
   * Serviços já feitos que ainda não estão no histórico de manutenção, para lançar no plano:
   * - custos da categoria Manutenção (tela Custos; ex.: "4ª REVISÃO · VIASERRA");
   * - checklists do Comando de Bordo que citam um serviço (ex.: "Foi feita revisão na Viaserra NF 188863").
   * O km vem do checklist ou é estimado pelas viagens daquele dia. Mesmo veículo e data (±3 dias) contam uma vez só.
   */
  app.get('/maintenance/hints', read, async (req) => {
    const org = req.user.org;
    const [costRows, checkRows, recs, { analysis: A }] = await Promise.all([
      db.select({ c: costs, vehicleName: vehicles.name, plate: vehicles.plate }).from(costs).innerJoin(vehicles, eq(vehicles.id, costs.vehicleId))
        .where(and(eq(costs.organizationId, org), eq(costs.category, 'Manutenção'))).orderBy(desc(costs.date)),
      db.select({ c: checklists, vehicleName: vehicles.name, plate: vehicles.plate }).from(checklists).innerJoin(vehicles, eq(vehicles.id, checklists.vehicleId))
        .where(and(eq(checklists.organizationId, org), sql`${checklists.notes} ~* ${SERVICE_WORDS}`)).orderBy(desc(checklists.at)),
      db.select({ vehicleId: maintenanceRecords.vehicleId, date: maintenanceRecords.date, costId: maintenanceRecords.costId }).from(maintenanceRecords).where(eq(maintenanceRecords.organizationId, org)),
      analyzeOrg(db, org),
    ]);
    const linkedCosts = new Set(recs.map((r) => r.costId).filter(Boolean));
    const done = (vehicleId: string, date: string) => recs.some((r) => r.vehicleId === vehicleId && Math.abs(daysBetween(r.date, date)) <= 3);
    const out: { key: string; keys: string[]; source: 'custos' | 'checklist'; vehicleId: string; vehicleName: string; date: string; km: number | null; kmEstimated: boolean;
      description: string; supplier: string | null; invoice: string | null; amount: number | null; costId: string | null }[] = [];
    for (const { c, vehicleName, plate } of costRows) {
      if (linkedCosts.has(c.id) || done(c.vehicleId!, c.date)) continue;
      const nfText = c.invoice ?? (c.notes && /N\s*F/i.test(c.notes) ? c.notes : null);
      // custos do mesmo veículo e dia (ex.: serviço + peças) viram uma sugestão só
      const same = out.find((h) => h.source === 'custos' && h.vehicleId === c.vehicleId && h.date === c.date);
      if (same) {
        same.keys.push('c' + c.id);
        same.description = `${same.description} + ${c.description.trim()}`;
        same.supplier ??= c.supplier;
        if (nfText) same.invoice = same.invoice ? `${same.invoice}; ${nfText}` : nfText;
        if (c.amount != null) same.amount = (same.amount ?? 0) + c.amount;
        continue;
      }
      const km = kmOnDate(A.trips, plate, c.date);
      out.push({ key: 'c' + c.id, keys: ['c' + c.id], source: 'custos', vehicleId: c.vehicleId!, vehicleName, date: c.date, km: km != null ? Math.round(km) : null, kmEstimated: true,
        description: c.description.trim(), supplier: c.supplier, invoice: nfText, amount: c.amount, costId: c.id });
    }
    for (const { c, vehicleName, plate } of checkRows) {
      const date = dateSP(c.at);
      if (done(c.vehicleId!, date) || out.some((h) => h.vehicleId === c.vehicleId && Math.abs(daysBetween(h.date, date)) <= 3)) continue;
      const km = c.km ?? kmOnDate(A.trips, plate, date);
      out.push({ key: 'k' + c.id, keys: ['k' + c.id], source: 'checklist', vehicleId: c.vehicleId!, vehicleName, date, km: km != null ? Math.round(km) : null, kmEstimated: c.km == null,
        description: c.notes ?? '', supplier: null, invoice: null, amount: null, costId: null });
    }
    const [o] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, org));
    const dismissed = new Set((o?.settings?.maintHintsDismissed as string[] | undefined) ?? []);
    return out.filter((h) => !h.keys.some((k) => dismissed.has(k))).sort((a, b) => b.date.localeCompare(a.date));
  });

  /** Tirar uma sugestão da lista (ex.: troca de bateria, que não é item do plano). */
  app.post('/maintenance/hints/dismiss', write, async (req, reply) => {
    const { key } = parse(z.object({ key: z.string().regex(/^[ck][0-9a-f-]{36}$/) }), req.body);
    await db.update(organizations).set({ settings: sql`jsonb_set(${organizations.settings}, '{maintHintsDismissed}', coalesce(${organizations.settings}->'maintHintsDismissed', '[]'::jsonb) || ${JSON.stringify([key])}::jsonb)` })
      .where(eq(organizations.id, req.user.org));
    await audit(db, req, 'dismiss', 'maintenance_hint', null, { key });
    return reply.code(204).send();
  });

  app.get('/maintenance/records', read, async (req) =>
    db.select({ r: maintenanceRecords, vehicleName: vehicles.name }).from(maintenanceRecords).innerJoin(vehicles, eq(vehicles.id, maintenanceRecords.vehicleId))
      .where(eq(maintenanceRecords.organizationId, req.user.org)).orderBy(desc(maintenanceRecords.date)).then((rows) => rows.map((x) => ({ ...x.r, vehicleName: x.vehicleName }))));

  /* ---- documentos ---- */
  app.get('/documents', read, async (req) => {
    const [{ analysis: A, ids }, rows] = await Promise.all([analyzeOrg(db, req.user.org),
      db.select({ vehicleId: vehicleDocuments.vehicleId, links: vehicleDocuments.links }).from(vehicleDocuments).where(eq(vehicleDocuments.organizationId, req.user.org))]);
    const links = new Map(rows.map((r) => [r.vehicleId, r.links ?? {}]));
    return A.docs.map((d) => {
      const vehicleId = ids.vehicleByPlate.get(d.plate);
      return { ...d, vehicleId, vehicleName: A.vehicles.find((v) => v.plate === d.plate)?.name, links: (vehicleId && links.get(vehicleId)) || {} };
    });
  });

  app.put('/documents/:id', write, async (req) => {
    const { id: vehicleId } = parse(idParam, req.params);
    const b = parse(z.object({ crlv: isoDate.nullable(), ipva: isoDate.nullable(), licensing: isoDate.nullable(), insurance: isoDate.nullable(),
      insurer: z.string().nullable().optional(), policy: z.string().nullable().optional(), confirmed: z.boolean(),
      // links dos PDFs (Google Drive); vazio apaga o link
      links: z.object(Object.fromEntries(['crlv', 'ipva', 'licensing', 'insurance'].map((k) => [k, z.union([z.literal(''), z.string().url().regex(/^https:\/\//, 'Use um link https')]).nullable().optional()]))).optional() }), req.body);
    const [v] = await db.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.organizationId, req.user.org)));
    if (!v) throw notFound('Veículo');
    const [cur] = await db.select({ links: vehicleDocuments.links }).from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
    const links = { ...(cur?.links ?? {}) } as Record<string, string>;
    for (const [k, url] of Object.entries(b.links ?? {})) { if (url) links[k] = url as string; else if (url === '' || url === null) delete links[k]; }
    const set = { ...b, links };
    const [d] = await db.insert(vehicleDocuments).values({ ...set, vehicleId, organizationId: req.user.org })
      .onConflictDoUpdate({ target: vehicleDocuments.vehicleId, set }).returning();
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
