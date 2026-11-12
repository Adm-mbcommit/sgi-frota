/**
 * Cria (ou redefine a senha de) um usuário.
 * Uso: npm run user:create -- email@dominio "Nome" SENHA [ADMIN|GESTOR|MOTORISTA|LEITOR]
 */
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { createDb } from './client.js';
import * as s from './schema.js';

const [email, name, password, role = 'LEITOR'] = process.argv.slice(2);
if (!email || !name || !password) { console.error('Uso: npm run user:create -- email "Nome" senha [papel]'); process.exit(1); }
if (password.length < 10) { console.error('A senha precisa de ao menos 10 caracteres.'); process.exit(1); }
const { db, pool } = createDb(process.env.DATABASE_URL!);
const [o] = await db.select().from(s.organizations).limit(1);
if (!o) { console.error('Nenhuma empresa cadastrada. Rode o seed antes.'); process.exit(1); }
const passwordHash = await bcrypt.hash(password, 12);
await db.insert(s.users).values({ organizationId: o.id, email, name, passwordHash, role: role as 'LEITOR' })
  .onConflictDoUpdate({ target: sql`lower(${s.users.email})` as never, set: { passwordHash, name, role: role as 'LEITOR', active: true } });
console.log(`Usuário ${email} (${role}) salvo na empresa ${o.name}.`);
await pool.end();
