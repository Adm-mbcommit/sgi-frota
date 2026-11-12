/**
 * Carga inicial a partir do snapshot do artefato original (legacy/snapshot.json).
 * Uso: npm run db:seed            (não faz nada se a empresa já existir)
 *      npm run db:seed -- --reset (apaga a empresa e recria; use só em desenvolvimento)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { DEFAULT_CONFIG, LEGACY_DRIVER_ALIASES, LEGACY_VEHICLES, parseDate, parseNum, type LegacySnapshot } from '@sgi/core';
import { createDb } from './client.js';
import * as s from './schema.js';
import { loadResolver } from '../services/resolver.js';
import { importComandoBordo } from '../importers/comando-bordo.js';
import { importChronos, mapChronos } from '../importers/chronos.js';

const ORG_NAME = 'Matias Brasil Engenharia';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não definida');
const { db, pool } = createDb(url);
const snap = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../legacy/snapshot.json', import.meta.url)), 'utf8')) as LegacySnapshot;

const [existing] = await db.select().from(s.organizations).where(eq(s.organizations.name, ORG_NAME));
if (existing && !process.argv.includes('--reset')) {
  console.log('Empresa já existe; nada a fazer. Use --reset para recriar.');
  await pool.end();
  process.exit(0);
}
if (existing) await db.delete(s.organizations).where(eq(s.organizations.id, existing.id));

const { empresa: _e, postos: _p, ...settings } = DEFAULT_CONFIG;
const [o] = await db.insert(s.organizations).values({ name: ORG_NAME, companyLabel: DEFAULT_CONFIG.empresa, settings }).returning();
const orgId = o.id;

await db.insert(s.stations).values(DEFAULT_CONFIG.postos.map((name) => ({ organizationId: orgId, name })));
const vs = await db.insert(s.vehicles).values(LEGACY_VEHICLES.map((v) => ({ organizationId: orgId, plate: v.plate, name: v.name, model: v.model, refKm: v.refKm, status: v.status, aliases: v.aliases }))).returning();
await db.insert(s.drivers).values(snap.drivers.map((name) => ({ organizationId: orgId, name, aliases: LEGACY_DRIVER_ALIASES[name] ?? [] })));
const vId = new Map(vs.map((v) => [v.plate, v.id]));

const R = await loadResolver(db, orgId);
const cb = await importComandoBordo(db, orgId, R, { trips: snap.trips, fuel: snap.fuel, check: snap.check }, 'LEGADO');
const ch = await importChronos(db, mapChronos([['Unidade rastreada', 'Data inicial', 'Duração', 'Vel. máxima', 'Vel. média', 'Endereço inicial', 'Endereço final'], ...snap.chronos], orgId, R, null));

await db.insert(s.maintenancePlan).values(snap.plan.map((b) => ({
  organizationId: orgId, vehicleId: vId.get(String(b[0]))!, item: String(b[1]), intervalKm: parseNum(b[2]), lastKm: parseNum(b[3]),
  lastDate: parseDate(b[4]), intervalMonths: parseNum(b[5]), needsCheck: b[6] === 'Sim', source: (b[7] as string) ?? null,
})));
await db.insert(s.vehicleDocuments).values(snap.docs.map((d) => ({
  organizationId: orgId, vehicleId: vId.get(String(d[0]))!, crlv: parseDate(d[1]), ipva: parseDate(d[2]), licensing: parseDate(d[3]), insurance: parseDate(d[4]), confirmed: d[5] === 'Conferido',
})));
await db.insert(s.costs).values(snap.costs.map((c) => ({
  organizationId: orgId, date: parseDate(c[0])!, vehicleId: vId.get(String(c[1])) ?? null, category: String(c[2] ?? 'Outros'),
  description: String(c[3] ?? '').trim(), supplier: (c[4] as string) ?? null, amount: parseNum(c[5]), notes: (c[6] as string) ?? null, source: 'LEGADO' as const,
})));
const tStatus = (x: unknown) => (x === 'Resolvido' ? 'RESOLVIDO' : x === 'Sugestão' ? 'SUGESTAO' : 'ABERTO') as 'ABERTO';
await db.insert(s.tasks).values(snap.todo.map((t) => ({ organizationId: orgId, title: String(t[0]), status: tStatus(t[1]), description: (t[2] as string) ?? null })));

const email = process.env.SEED_ADMIN_EMAIL, pass = process.env.SEED_ADMIN_PASSWORD;
if (email && pass) {
  await db.insert(s.users).values({ organizationId: orgId, email, name: 'Administrador', role: 'ADMIN', passwordHash: await bcrypt.hash(pass, 12) });
  console.log(`Administrador criado: ${email}`);
} else console.log('SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD não definidos: crie o primeiro usuário com npm run user:create.');

await db.insert(s.imports).values({ organizationId: orgId, kind: 'LEGADO', fileName: 'legacy/snapshot.json', stats: { ...cb, speed: ch } });
console.log('Seed concluído:', { veiculos: vs.length, motoristas: snap.drivers.length, ...cb, chronos: ch.inserted, plano: snap.plan.length, custos: snap.costs.length, pendencias: snap.todo.length });
await pool.end();
