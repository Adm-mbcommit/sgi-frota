import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { createDb } from './client.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não definida');
const { db, pool } = createDb(url);
await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
console.log('Migrações aplicadas.');
await pool.end();
