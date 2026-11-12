import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type DB = NodePgDatabase<typeof schema>;

export function createDb(url: string, opts: { max?: number } = {}): { db: DB; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 10, idleTimeoutMillis: 10_000 });
  // `date` volta como string 'YYYY-MM-DD' (sem conversão de fuso)
  pg.types.setTypeParser(1082, (v) => v);
  return { db: drizzle(pool, { schema }), pool };
}
