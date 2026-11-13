/** Cadastros: veículos, motoristas, postos e parâmetros. */
import type { FastifyInstance } from 'fastify';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DEFAULT_CONFIG } from '@sgi/core';
import { drivers, organizations, stations, vehicles } from '../db/schema.js';
import { HttpError, isoDate, notFound, parse, uuid } from '../plugins/http.js';
import { WRITE_ROLES } from '../plugins/auth.js';
import { audit } from '../services/audit.js';
import { loadConfig } from '../services/fleet.js';

const vehicleBody = z.object({
  plate: z.string().min(7).max(8).transform((s) => s.toUpperCase().replace(/[\s-]/g, '')),
  name: z.string().min(1), model: z.string().nullable().optional(), refKm: z.number().int().nonnegative(),
  status: z.enum(['ATIVO', 'PARALISADO', 'INATIVO']).default('ATIVO'), aliases: z.array(z.string()).default([]), active: z.boolean().default(true),
});
const driverBody = z.object({
  name: z.string().min(2), aliases: z.array(z.string()).default([]), cnhNumber: z.string().nullable().optional(),
  cnhCategory: z.string().nullable().optional(), cnhExpiry: isoDate.nullable().optional(), active: z.boolean().default(true),
});

export default async function registryRoutes(app: FastifyInstance) {
  const { db } = app;
  const read = { onRequest: [app.authenticate] };
  const write = { onRequest: [app.authenticate, app.requireRole(...WRITE_ROLES)] };
  const idp = (p: unknown) => parse(z.object({ id: uuid }), p).id;

  app.get('/vehicles', read, async (req) => db.select().from(vehicles).where(eq(vehicles.organizationId, req.user.org)).orderBy(asc(vehicles.name)));
  app.post('/vehicles', write, async (req, reply) => {
    const b = parse(vehicleBody, req.body);
    const [v] = await db.insert(vehicles).values({ ...b, organizationId: req.user.org }).returning();
    await audit(db, req, 'create', 'vehicle', v.id, b);
    return reply.code(201).send(v);
  });
  app.patch('/vehicles/:id', write, async (req) => {
    const id = idp(req.params); const b = parse(vehicleBody.partial(), req.body);
    const [v] = await db.update(vehicles).set(b).where(and(eq(vehicles.id, id), eq(vehicles.organizationId, req.user.org))).returning();
    if (!v) throw notFound('Veículo');
    await audit(db, req, 'update', 'vehicle', id, b);
    return v;
  });

  app.get('/drivers', read, async (req) => db.select().from(drivers).where(eq(drivers.organizationId, req.user.org)).orderBy(asc(drivers.name)));
  app.post('/drivers', write, async (req, reply) => {
    const b = parse(driverBody, req.body);
    const [d] = await db.insert(drivers).values({ ...b, organizationId: req.user.org }).returning();
    await audit(db, req, 'create', 'driver', d.id, b);
    return reply.code(201).send(d);
  });
  app.patch('/drivers/:id', write, async (req) => {
    const id = idp(req.params); const b = parse(driverBody.partial(), req.body);
    const [d] = await db.update(drivers).set(b).where(and(eq(drivers.id, id), eq(drivers.organizationId, req.user.org))).returning();
    if (!d) throw notFound('Motorista');
    await audit(db, req, 'update', 'driver', id, b);
    return d;
  });

  app.get('/stations', read, async (req) => db.select().from(stations).where(eq(stations.organizationId, req.user.org)).orderBy(asc(stations.name)));
  app.post('/stations', write, async (req, reply) => {
    const b = parse(z.object({ name: z.string().min(1) }), req.body);
    const [s] = await db.insert(stations).values({ organizationId: req.user.org, name: b.name.trim() }).returning();
    return reply.code(201).send(s);
  });

  app.get('/settings', read, async (req) => loadConfig(db, req.user.org));
  app.put('/settings', { onRequest: [app.authenticate, app.requireRole('ADMIN')] }, async (req) => {
    const num = z.number().nonnegative();
    const b = parse(z.object(Object.fromEntries(Object.keys(DEFAULT_CONFIG).filter((k) => k !== 'empresa' && k !== 'postos').map((k) => [k, num])) as Record<string, typeof num>).partial().strict(), req.body);
    const cur = { ...(await loadConfig(db, req.user.org)), ...b };
    if (cur.pMin >= cur.pMax) throw new HttpError(400, 'invalid_range', 'O preço mínimo por litro precisa ser menor que o máximo.');
    if (cur.kmlMin >= cur.kmlMax) throw new HttpError(400, 'invalid_range', 'O consumo mínimo (km/L) precisa ser menor que o máximo.');
    // merge no próprio banco, para não apagar campos gravados ao mesmo tempo (ex.: sincronização)
    await db.update(organizations).set({ settings: sql`${organizations.settings} || ${JSON.stringify(b)}::jsonb` }).where(eq(organizations.id, req.user.org));
    await audit(db, req, 'update', 'settings', req.user.org, b);
    return loadConfig(db, req.user.org);
  });
}
