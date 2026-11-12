/**
 * Entrada da API como Função Serverless da Vercel.
 * O vercel.json reescreve /api/<caminho> para /api?__path=<caminho>; aqui o URL original é refeito
 * e a requisição é entregue ao Fastify. A instância é reaproveitada entre invocações quentes.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv } from './env.js';
import { createDb } from './db/client.js';
import { buildApp } from './app.js';

let ready: Promise<Awaited<ReturnType<typeof buildApp>>> | null = null;

function getApp() {
  if (!ready) {
    const env = loadEnv();
    // poucas conexões por instância: cada função serverless tem o seu próprio pool
    const { db } = createDb(env.DATABASE_URL, { max: 3 });
    ready = buildApp(env, db).then(async (app) => { await app.ready(); return app; });
    ready.catch(() => { ready = null; });
  }
  return ready;
}

export function restoreUrl(url: string): string {
  const u = new URL(url, 'http://x');
  const p = u.searchParams.get('__path');
  if (p == null) return url;
  u.searchParams.delete('__path');
  const qs = u.searchParams.toString();
  return '/api/' + p.replace(/^\/+/, '') + (qs ? '?' + qs : '');
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  req.url = restoreUrl(req.url ?? '/');
  const app = await getApp();
  app.server.emit('request', req, res);
}
