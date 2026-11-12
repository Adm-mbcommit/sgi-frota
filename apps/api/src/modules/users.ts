import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '../db/schema.js';
import { notFound, parse, uuid } from '../plugins/http.js';
import { audit } from '../services/audit.js';

const role = z.enum(['ADMIN', 'GESTOR', 'MOTORISTA', 'LEITOR']);
const pub = { id: users.id, name: users.name, email: users.email, role: users.role, driverId: users.driverId, active: users.active, lastLoginAt: users.lastLoginAt };

export default async function userRoutes(app: FastifyInstance) {
  const { db } = app;
  const admin = { onRequest: [app.authenticate, app.requireRole('ADMIN')] };

  app.get('/users', admin, async (req) => db.select(pub).from(users).where(eq(users.organizationId, req.user.org)).orderBy(asc(users.name)));

  app.post('/users', admin, async (req, reply) => {
    const b = parse(z.object({ email: z.string().email(), name: z.string().min(2), password: z.string().min(10), role, driverId: uuid.nullable().optional() }), req.body);
    const [u] = await db.insert(users).values({ organizationId: req.user.org, email: b.email, name: b.name, role: b.role, driverId: b.driverId ?? null, passwordHash: await bcrypt.hash(b.password, 12) }).returning(pub);
    await audit(db, req, 'create', 'user', u.id, { email: b.email, role: b.role });
    return reply.code(201).send(u);
  });

  app.patch('/users/:id', admin, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({ name: z.string().min(2), role, active: z.boolean(), driverId: uuid.nullable(), password: z.string().min(10) }).partial(), req.body);
    const { password, ...rest } = b;
    const [u] = await db.update(users).set({ ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}) })
      .where(and(eq(users.id, id), eq(users.organizationId, req.user.org))).returning(pub);
    if (!u) throw notFound('Usuário');
    await audit(db, req, 'update', 'user', id, { ...rest, password: password ? '***' : undefined });
    return u;
  });
}
