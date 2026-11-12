import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { users, organizations } from '../db/schema.js';
import { HttpError, parse } from '../plugins/http.js';
import type { Role } from '../plugins/auth.js';

export default async function authRoutes(app: FastifyInstance) {
  const { db } = app;

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
    const [u] = await db.select().from(users).where(and(sql`lower(${users.email}) = lower(${b.email})`, eq(users.active, true)));
    // compara mesmo quando o usuário não existe, para não revelar e-mails cadastrados pelo tempo de resposta
    const ok = await bcrypt.compare(b.password, u?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
    if (!u || !ok) throw new HttpError(401, 'invalid_credentials', 'E-mail ou senha incorretos.');
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
    const token = app.jwt.sign({ sub: u.id, org: u.organizationId, role: u.role as Role, name: u.name, driverId: u.driverId });
    return { token, user: { id: u.id, name: u.name, email: u.email, role: u.role } };
  });

  app.get('/auth/me', { onRequest: [app.authenticate] }, async (req) => {
    const [u] = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, driverId: users.driverId }).from(users).where(eq(users.id, req.user.sub));
    const [o] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, req.user.org));
    return { user: u, organization: o };
  });

  app.post('/auth/change-password', { onRequest: [app.authenticate] }, async (req, reply) => {
    const b = parse(z.object({ current: z.string(), next: z.string().min(10, 'Mínimo de 10 caracteres') }), req.body);
    const [u] = await db.select().from(users).where(eq(users.id, req.user.sub));
    if (!u || !(await bcrypt.compare(b.current, u.passwordHash))) throw new HttpError(400, 'invalid_password', 'Senha atual incorreta.');
    await db.update(users).set({ passwordHash: await bcrypt.hash(b.next, 12) }).where(eq(users.id, u.id));
    return reply.code(204).send();
  });
}
