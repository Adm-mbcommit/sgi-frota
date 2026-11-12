/** Registros operacionais: painel, viagens, abastecimentos, velocidade, qualidade dos dados. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { inPeriod } from '@sgi/core';
import { fuelings, trips, tasks } from '../db/schema.js';
import { HttpError, notFound, parse, periodQuery, uuid } from '../plugins/http.js';
import { WRITE_ROLES } from '../plugins/auth.js';
import { analyzeOrg } from '../services/fleet.js';
import { audit } from '../services/audit.js';

const iso = (t: number | null | undefined) => (t == null ? null : new Date(t).toISOString());
const listQuery = periodQuery.extend({ plate: z.string().optional(), problems: z.enum(['1', '0']).optional() });

export default async function operationsRoutes(app: FastifyInstance) {
  const { db } = app;
  const read = { onRequest: [app.authenticate] };
  const write = { onRequest: [app.authenticate, app.requireRole(...WRITE_ROLES)] };
  const canRegister = { onRequest: [app.authenticate, app.requireRole('ADMIN', 'GESTOR', 'MOTORISTA')] };
  const run = (req: FastifyRequest) => analyzeOrg(db, req.user.org, parse(periodQuery, req.query));

  app.get('/dashboard', read, async (req) => {
    const { analysis: A, cfg } = await run(req);
    const openTasks = await db.select().from(tasks).where(and(eq(tasks.organizationId, req.user.org), eq(tasks.status, 'ABERTO')));
    const speedByDriver: Record<string, number> = {};
    for (const e of A.speed) if (inPeriod(e.startedAt, A.period) && e.vmax > cfg.speed) speedByDriver[e.driver ?? 'Sem registro'] = (speedByDriver[e.driver ?? 'Sem registro'] ?? 0) + 1;
    return {
      period: A.period, today: A.today, config: { speed: cfg.speed },
      kpis: A.kpis,
      vehicles: A.vehicles.map((v) => ({ ...v, lastUse: iso(v.lastUse) })),
      alerts: A.alerts.slice(0, 10).map((a) => ({ ...a, vehicleName: A.vehicles.find((v) => v.plate === a.plate)?.name ?? a.plate })),
      openTasks: openTasks.slice(0, 6),
      monthlyFuel: A.monthlyFuel,
      speedByDriver: Object.entries(speedByDriver).sort((a, b) => b[1] - a[1]).map(([driver, count]) => ({ driver, count })),
      lastTripAt: iso(A.trips.length ? Math.max(...A.trips.map((t) => t.startedAt)) : null),
      lastSpeedAt: iso(A.speed.length ? Math.max(...A.speed.map((e) => e.startedAt)) : null),
    };
  });

  app.get('/trips', read, async (req) => {
    const q = parse(listQuery, req.query);
    const { analysis: A, cfg } = await run(req);
    return A.trips
      .filter((t) => t.company === cfg.empresa && inPeriod(t.startedAt, A.period) && (!q.plate || t.plate === q.plate) && (q.problems !== '1' || t.problems.length))
      .reverse()
      .map((t) => ({ ...t, startedAt: iso(t.startedAt), endedAt: iso(t.endedAt), effectiveEnd: undefined }));
  });

  app.post('/trips', canRegister, async (req, reply) => {
    const b = parse(z.object({ vehicleId: uuid, driverId: uuid.optional(), startedAt: z.string().datetime({ offset: true }), kmStart: z.number().nonnegative(), notes: z.string().optional() }), req.body);
    const driverId = req.user.role === 'MOTORISTA' ? req.user.driverId : b.driverId;
    if (!driverId) throw new HttpError(400, 'driver_required', 'Informe o motorista.');
    const { cfg } = await analyzeOrg(db, req.user.org);
    const [t] = await db.insert(trips).values({ organizationId: req.user.org, source: 'SGI', company: cfg.empresa, vehicleId: b.vehicleId, driverId,
      startedAt: new Date(b.startedAt), kmStart: b.kmStart, kmStartRaw: String(b.kmStart), open: true, status: 'Em uso', notes: b.notes }).returning();
    await audit(db, req, 'create', 'trip', t.id, b);
    return reply.code(201).send(t);
  });

  /** Encerrar viagem (o motorista só encerra as próprias). */
  app.post('/trips/:id/close', canRegister, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ endedAt: z.string().datetime({ offset: true }), kmEnd: z.number().nonnegative(), notes: z.string().optional() }), req.body);
    const own = req.user.role === 'MOTORISTA' ? [eq(trips.driverId, req.user.driverId ?? '00000000-0000-0000-0000-000000000000')] : [];
    const [t] = await db.update(trips).set({ endedAt: new Date(b.endedAt), kmEnd: b.kmEnd, kmEndRaw: String(b.kmEnd), open: false, status: 'Finalizado', ...(b.notes ? { notes: b.notes } : {}) })
      .where(and(eq(trips.id, id), eq(trips.organizationId, req.user.org), ...own)).returning();
    if (!t) throw notFound('Viagem');
    await audit(db, req, 'close', 'trip', id, b);
    return t;
  });

  /** Correção de um registro (gestor). O texto original fica em *_raw. */
  app.patch('/trips/:id', write, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ kmStart: z.number().nullable(), kmEnd: z.number().nullable(), endedAt: z.string().datetime({ offset: true }).nullable(),
      vehicleId: uuid.nullable(), driverId: uuid.nullable(), notes: z.string().nullable(), open: z.boolean() }).partial(), req.body);
    const { endedAt, ...rest } = b;
    const [t] = await db.update(trips).set({ ...rest, ...(endedAt !== undefined ? { endedAt: endedAt ? new Date(endedAt) : null } : {}) })
      .where(and(eq(trips.id, id), eq(trips.organizationId, req.user.org))).returning();
    if (!t) throw notFound('Viagem');
    await audit(db, req, 'correct', 'trip', id, b);
    return t;
  });

  app.get('/fuelings', read, async (req) => {
    const q = parse(listQuery, req.query);
    const { analysis: A, cfg } = await run(req);
    return A.fuel
      .filter((f) => f.company === cfg.empresa && inPeriod(f.at, A.period) && (!q.plate || f.plate === q.plate) && (q.problems !== '1' || f.problems.length))
      .reverse().map((f) => ({ ...f, at: iso(f.at) }));
  });

  app.post('/fuelings', canRegister, async (req, reply) => {
    const b = parse(z.object({ vehicleId: uuid, driverId: uuid.optional(), at: z.string().datetime({ offset: true }), km: z.number().nonnegative(),
      liters: z.number().positive().max(200), total: z.number().nonnegative(), station: z.string().min(1), fuelType: z.string().optional(), fullTank: z.boolean().default(true), notes: z.string().optional() }), req.body);
    const driverId = req.user.role === 'MOTORISTA' ? req.user.driverId : b.driverId ?? null;
    const { cfg } = await analyzeOrg(db, req.user.org);
    const [f] = await db.insert(fuelings).values({ organizationId: req.user.org, source: 'SGI', company: cfg.empresa, ...b, driverId, at: new Date(b.at) }).returning();
    await audit(db, req, 'create', 'fueling', f.id, b);
    return reply.code(201).send(f);
  });

  app.get('/speed-events', read, async (req) => {
    const q = parse(listQuery.extend({ all: z.enum(['1', '0']).optional() }), req.query);
    const { analysis: A, cfg } = await run(req);
    return A.speed.filter((e) => inPeriod(e.startedAt, A.period) && (q.all === '1' || e.vmax > cfg.speed) && (!q.plate || e.plate === q.plate))
      .reverse().map((e) => ({ ...e, startedAt: iso(e.startedAt), vehicleName: A.vehicles.find((v) => v.plate === e.plate)?.name ?? null }));
  });

  app.get('/drivers/summary', read, async (req) => (await run(req)).analysis.drivers);
  app.get('/quality', read, async (req) => (await run(req)).analysis.quality);
}
