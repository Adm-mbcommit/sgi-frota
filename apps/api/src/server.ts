import { loadEnv } from './env.js';
import { createDb } from './db/client.js';
import { buildApp } from './app.js';

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const app = await buildApp(env, db);

const shutdown = async (sig: string) => {
  app.log.info(`${sig} recebido, encerrando…`);
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: env.PORT, host: env.HOST });
