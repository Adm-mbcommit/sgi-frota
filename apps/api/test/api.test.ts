/**
 * Testes de integração contra um PostgreSQL real.
 * Requer TEST_DATABASE_URL (banco descartável: é limpo a cada execução).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../src/db/client.js';
import * as s from '../src/db/schema.js';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('API', () => {
  const { db, pool } = createDb(url!);
  let app: Awaited<ReturnType<typeof buildApp>>;
  let admin = '', reader = '';
  let vehicleId = '';

  const call = (method: string, path: string, token?: string, body?: unknown) =>
    app.inject({ method: method as 'GET', url: '/api/v1' + path, headers: token ? { authorization: 'Bearer ' + token } : {}, payload: body as object });

  beforeAll(async () => {
    await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
    const [o] = await db.insert(s.organizations).values({ name: 'Empresa Teste', companyLabel: 'Matias Brasil' }).returning();
    await db.insert(s.stations).values({ organizationId: o.id, name: 'Elefantinho' });
    const h = await bcrypt.hash('senha-forte-123', 4);
    await db.insert(s.users).values([
      { organizationId: o.id, email: 'admin@teste.com', name: 'Admin', role: 'ADMIN', passwordHash: h },
      { organizationId: o.id, email: 'leitor@teste.com', name: 'Leitor', role: 'LEITOR', passwordHash: h },
    ]);
    app = await buildApp(loadEnv({ NODE_ENV: 'test', DATABASE_URL: url, JWT_SECRET: 'x'.repeat(40) }), db);
    admin = (await call('POST', '/auth/login', undefined, { email: 'ADMIN@teste.com', password: 'senha-forte-123' })).json().token;
    reader = (await call('POST', '/auth/login', undefined, { email: 'leitor@teste.com', password: 'senha-forte-123' })).json().token;
  });
  afterAll(async () => { await app?.close(); await pool.end(); });

  it('rejeita senha errada e requisição sem token', async () => {
    expect((await call('POST', '/auth/login', undefined, { email: 'admin@teste.com', password: 'errada' })).statusCode).toBe(401);
    expect((await call('GET', '/vehicles')).statusCode).toBe(401);
    expect(admin).toBeTruthy();
  });

  it('cadastra veículo e motorista (admin) e bloqueia o leitor', async () => {
    const v = await call('POST', '/vehicles', admin, { plate: 'tpr-0f55', name: 'SAVEIRO - 55', refKm: 45000, aliases: ['TRP0F55'] });
    expect(v.statusCode).toBe(201);
    expect(v.json().plate).toBe('TPR0F55');
    vehicleId = v.json().id;
    expect((await call('POST', '/drivers', admin, { name: 'Alvino', aliases: ['Alvino Rusche Junior'] })).statusCode).toBe(201);
    expect((await call('POST', '/vehicles', reader, { plate: 'AAA1234', name: 'X', refKm: 1 })).statusCode).toBe(403);
    expect((await call('POST', '/vehicles', admin, { plate: 'TPR0F55', name: 'dup', refKm: 1 })).statusCode).toBe(409);
    expect((await call('POST', '/vehicles', admin, { plate: 'x', name: '', refKm: -1 })).statusCode).toBe(400);
  });

  it('importa a planilha do Comando de Bordo de forma idempotente', async () => {
    const wb = new ExcelJS.Workbook();
    const reg = wb.addWorksheet('Registros');
    reg.addRow(['Saída', 'Empresa', 'Modelo', 'Placa', 'Motorista', 'Local', 'Km inicial', 'Chegada', 'Local', 'Km final', 'Obs', 'Status']);
    reg.addRow([new Date(Date.UTC(2026, 9, 1, 8, 0)), 'Matias Brasil', 'Saveiro', 'TPR - 0F55', 'Alvino Rusche Junior', null, 45000, new Date(Date.UTC(2026, 9, 1, 17, 0)), null, 45120, null, 'Finalizado']);
    reg.addRow([new Date(Date.UTC(2026, 9, 2, 8, 0)), 'Matias Brasil', 'Saveiro', 'TPR - 0F55', 'Alvino', null, 45120, null, null, null, null, 'Em uso']);
    const ab = wb.addWorksheet('Abastecimentos');
    ab.addRow(['Data', 'Empresa', 'Modelo', 'Placa', 'Motorista', 'Km', 'Litros', 'Valor']);
    ab.addRow([new Date(Date.UTC(2026, 9, 1, 12, 0)), 'Matias Brasil', 'Saveiro', 'TRP0F55', 'Alvino', 45060, 40, 280, 7, 'Elefantinho', 'Gasolina', null, null, null, 'Sim', null]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const boundary = '----sgi';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cb.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
      buf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const up = () => app.inject({ method: 'POST', url: '/api/v1/imports/comando-bordo', headers: { authorization: 'Bearer ' + admin, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    const r1 = await up();
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ trips: 2, fuel: 1 });
    await up();
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from trips`)).rows as { n: number }[];
    expect(n).toBe(2);

    const trips = (await call('GET', '/trips?from=2026-10-01&to=2026-10-31', reader)).json();
    expect(trips).toHaveLength(2);
    const closed = trips.find((t: { open: boolean }) => !t.open);
    expect(closed).toMatchObject({ plate: 'TPR0F55', driver: 'Alvino', km: 120, valid: true });
    expect(closed.startedAt).toBe('2026-10-01T11:00:00.000Z'); // 08:00 em São Paulo
  });

  it('calcula o painel e registra manutenção reiniciando o prazo', async () => {
    const plan = await call('POST', '/maintenance/plan', admin, { vehicleId, item: 'Troca do óleo', intervalKm: 10000, intervalMonths: 12, lastKm: 35000, lastDate: '2025-10-01' });
    expect(plan.statusCode).toBe(201);
    let items = (await call('GET', '/maintenance/plan', reader)).json();
    expect(items[0].status).toBe('VENCIDO');
    const rec = await call('POST', `/maintenance/plan/${plan.json().id}/records`, admin, { km: 45120, date: '2026-10-02', supplier: 'VIASERRA', amount: 350 });
    expect(rec.statusCode).toBe(201);
    items = (await call('GET', '/maintenance/plan', reader)).json();
    expect(items[0]).toMatchObject({ status: 'OK', lastKm: 45120, nextKm: 55120 });

    const dash = (await call('GET', '/dashboard?from=2026-10-01&to=2026-10-31', reader)).json();
    expect(dash.kpis).toMatchObject({ km: 120, fuel: 280, otherCosts: 350, total: 630 });
    expect(dash.vehicles[0].currentKm).toBe(45120);
  });

  it('restringe usuários e auditoria ao administrador', async () => {
    expect((await call('GET', '/users', reader)).statusCode).toBe(403);
    expect((await call('GET', '/users', admin)).json()).toHaveLength(2);
    const audit = (await call('GET', '/audit', admin)).json();
    expect(audit.some((a: { entity: string }) => a.entity === 'maintenance')).toBe(true);
  });
});
