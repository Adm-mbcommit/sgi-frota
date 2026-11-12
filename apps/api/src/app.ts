import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import type { Env } from './env.js';
import type { DB } from './db/client.js';
import authPlugin from './plugins/auth.js';
import { errorHandler } from './plugins/http.js';
import authRoutes from './modules/auth.js';
import userRoutes from './modules/users.js';
import registryRoutes from './modules/registry.js';
import operationsRoutes from './modules/operations.js';
import managementRoutes from './modules/management.js';
import importRoutes from './modules/imports.js';

declare module 'fastify' { interface FastifyInstance { db: DB } }

export async function buildApp(env: Env, db: DB, opts: FastifyServerOptions = {}) {
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: env.NODE_ENV === 'production' ? 'info' : 'debug', redact: ['req.headers.authorization', 'body.password'] },
    trustProxy: true,
    ...opts,
  });
  app.decorate('db', db);
  app.setErrorHandler(errorHandler);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
  await app.register(authPlugin, { env });

  const health = async () => { await db.execute(sql`select 1`); return { status: 'ok' }; };
  app.get('/health', health);
  app.get('/api/health', health);

  await app.register(async (api) => {
    for (const r of [authRoutes, userRoutes, registryRoutes, operationsRoutes, managementRoutes, importRoutes]) await api.register(r);
  }, { prefix: '/api/v1' });

  return app;
}
