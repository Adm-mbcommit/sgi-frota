/**
 * Build na Vercel:
 * 1. compila core, API e front;
 * 2. em produção (VERCEL_ENV=production), aplica as migrações do banco;
 * 3. se SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD estiverem definidos, faz a carga inicial
 *    (não faz nada se a empresa já existir).
 * Previews não tocam no banco, a menos que MIGRATE_ON_PREVIEW=1 (use um banco separado para isso).
 */
import { execSync } from 'node:child_process';

const run = (cmd) => { console.log('> ' + cmd); execSync(cmd, { stdio: 'inherit' }); };

run('npm run build -w @sgi/core');
run('npm run build -w @sgi/api');
run('npm run build -w @sgi/web');

const prod = process.env.VERCEL_ENV === 'production' || process.env.MIGRATE_ON_PREVIEW === '1';
if (!process.env.DATABASE_URL) {
  console.warn('DATABASE_URL não definida: migrações ignoradas. Conecte um banco Postgres ao projeto na Vercel.');
} else if (prod) {
  run('node apps/api/dist/db/migrate.js');
  if (process.env.SEED_ADMIN_EMAIL && process.env.SEED_ADMIN_PASSWORD) run('node apps/api/dist/db/seed.js');
} else {
  console.log('Deploy de preview: migrações não aplicadas.');
}
