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

  it('sincroniza a planilha com a chave gerada pelo admin, sem reimportar o que não mudou', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Registros').addRow(['Saída']);
    wb.getWorksheet('Registros')!.addRow([new Date(Date.UTC(2026, 8, 3, 8, 0)), 'Matias Brasil', 'Saveiro', 'TPR - 0F55', 'Alvino', null, 44000, null, null, null, null, 'Em uso']);
    wb.addWorksheet('Abastecimentos').addRow(['Data']);
    const boundary = '----sync';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="comando-bordo.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from(await wb.xlsx.writeBuffer()), Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const push = (token?: string) => app.inject({ method: 'POST', url: '/api/v1/imports/comando-bordo/sync', headers: { ...(token ? { 'x-sync-token': token } : {}), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });

    expect((await push()).statusCode).toBe(401);
    expect((await push('sgi_chave-que-nao-existe-123456')).statusCode).toBe(401);
    expect((await call('POST', '/imports/sync/token', reader)).statusCode).toBe(403);
    expect((await call('GET', '/imports/sync', admin)).json()).toMatchObject({ configured: false });

    const { token } = (await call('POST', '/imports/sync/token', admin)).json();
    const r1 = await push(token);
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ trips: 1 });
    expect((await push(token)).json()).toEqual({ unchanged: true });
    const st = (await call('GET', '/imports/sync', admin)).json();
    expect(st).toMatchObject({ configured: true });
    expect(st.lastImportAt).toBeTruthy();
    // A chave nunca aparece nos parâmetros nem fica guardada em texto.
    expect(JSON.stringify((await call('GET', '/settings', reader)).json())).not.toMatch(/sync/);
    const [org] = await db.select().from(s.organizations);
    expect(JSON.stringify(org.settings)).not.toContain(token);

    const novo = (await call('POST', '/imports/sync/token', admin)).json().token;
    expect((await push(token)).statusCode).toBe(401); // a chave antiga deixou de valer
    expect((await push(novo)).statusCode).toBe(200);
    expect((await call('DELETE', '/imports/sync/token', admin)).statusCode).toBe(204);
    expect((await push(novo)).statusCode).toBe(401);
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
  it('altera parâmetros (só admin) sem apagar os dados da sincronização', async () => {
    expect((await call('PUT', '/settings', reader, { speed: 90 })).statusCode).toBe(403);
    expect((await call('PUT', '/settings', admin, { pMin: 12 })).statusCode).toBe(400); // mínimo > máximo
    expect((await call('PUT', '/settings', admin, { inexistente: 1 })).statusCode).toBe(400);
    await call('POST', '/imports/sync/token', admin);
    const r = await call('PUT', '/settings', admin, { speed: 90, kmAlert: 2000 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ speed: 90, kmAlert: 2000, dayAlert: 30 });
    expect((await call('GET', '/imports/sync', admin)).json()).toMatchObject({ configured: true });
  });

  it('troca a própria senha conferindo a atual', async () => {
    expect((await call('POST', '/auth/change-password', reader, { current: 'errada', next: 'outra-senha-forte' })).statusCode).toBe(400);
    expect((await call('POST', '/auth/change-password', reader, { current: 'senha-forte-123', next: 'curta' })).statusCode).toBe(400);
    expect((await call('POST', '/auth/change-password', reader, { current: 'senha-forte-123', next: 'senha-forte-123' })).statusCode).toBe(400);
    expect((await call('POST', '/auth/change-password', reader, { current: 'senha-forte-123', next: 'outra-senha-forte' })).statusCode).toBe(204);
    expect((await call('POST', '/auth/login', undefined, { email: 'leitor@teste.com', password: 'senha-forte-123' })).statusCode).toBe(401);
    expect((await call('POST', '/auth/login', undefined, { email: 'leitor@teste.com', password: 'outra-senha-forte' })).statusCode).toBe(200);
    const [a] = await db.select().from(s.auditLog).where(sql`${s.auditLog.action} = 'change_password'`);
    expect(JSON.stringify(a)).not.toContain('outra-senha-forte');
  });
  it('tarefas pessoais e rotina: cada usuário vê só as suas', async () => {
    const t = await call('POST', '/my/tasks', admin, { title: 'Fazer ordem de compra', person: 'Diego', dueDate: '2026-11-20' });
    expect(t.statusCode).toBe(201);
    const id = t.json().id;
    expect((await call('POST', '/my/tasks', admin, { title: '   ' })).statusCode).toBe(400);
    expect((await call('GET', '/my/tasks', admin)).json()).toHaveLength(1);
    // outro usuário não vê nem altera
    expect((await call('GET', '/my/tasks', reader)).json()).toHaveLength(0);
    expect((await call('PATCH', `/my/tasks/${id}`, reader, { status: 'FEITA' })).statusCode).toBe(404);
    expect((await call('DELETE', `/my/tasks/${id}`, reader)).statusCode).toBe(404);
    const w = (await call('PATCH', `/my/tasks/${id}`, admin, { status: 'AGUARDANDO', details: 'entrada protocolo' })).json();
    expect(w).toMatchObject({ status: 'AGUARDANDO', details: 'entrada protocolo', doneAt: null });
    expect((await call('PATCH', `/my/tasks/${id}`, admin, { status: 'FEITA' })).json().doneAt).toBeTruthy();

    const r = (await call('POST', '/my/routine', admin, { title: 'Conferir prazos' })).json();
    let rot = (await call('GET', '/my/routine', admin)).json();
    expect(rot.items).toEqual([{ id: r.id, title: 'Conferir prazos', checked: false }]);
    expect((await call('PUT', `/my/routine/${r.id}/check`, reader, { checked: true })).statusCode).toBe(404);
    await call('PUT', `/my/routine/${r.id}/check`, admin, { checked: true });
    await call('PUT', `/my/routine/${r.id}/check`, admin, { checked: true }); // repetir não duplica
    rot = (await call('GET', '/my/routine', admin)).json();
    expect(rot.items[0].checked).toBe(true);
    expect((await call('GET', '/my/routine', reader)).json().items).toHaveLength(0);
    expect((await call('DELETE', `/my/routine/${r.id}`, admin)).statusCode).toBe(204);
    expect((await call('GET', '/my/routine', admin)).json().items).toHaveLength(0);
    expect((await call('DELETE', `/my/tasks/${id}`, admin)).statusCode).toBe(204);

    const bulk = await call('POST', '/my/tasks/bulk', admin, { tasks: [
      { title: 'Ver com João sobre as mesas', details: 'calços', person: 'João' },
      { title: 'Confraternização', person: 'Diego', status: 'AGUARDANDO' },
      { title: 'Mouse pad', status: 'FEITA' },
      { title: 'Películas', status: 'EM_ANDAMENTO' },
    ] });
    expect(bulk.json()).toEqual({ created: 4 });
    const mineNow = (await call('GET', '/my/tasks', admin)).json();
    expect(mineNow.map((t: { status: string }) => t.status).sort()).toEqual(['AGUARDANDO', 'A_FAZER', 'EM_ANDAMENTO', 'FEITA']);
    expect(mineNow.find((t: { status: string }) => t.status === 'FEITA').doneAt).toBeTruthy();
    expect((await call('GET', '/my/tasks', reader)).json()).toHaveLength(0);
    expect((await call('POST', '/my/tasks/bulk', admin, { tasks: [] })).statusCode).toBe(400);
  });
  it('aniversários: importa a planilha, atualiza sem duplicar e esconde o ano de quem só consulta', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Planilha1');
    ws.addRow([null, null, 'ANIVERSARIANTES', 'DATA']);
    ws.addRow([null, null, 'Diego Rafael Brasil', new Date(Date.UTC(1988, 7, 12))]);
    ws.addRow([null, null, 'Noêmia Soares Guimarães', '05/11/....']);
    ws.addRow([null, null, 'Sem data', null]);
    const boundary = '----aniv';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="Aniversarios.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from(await wb.xlsx.writeBuffer()), Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const up = (token: string) => app.inject({ method: 'POST', url: '/api/v1/birthdays/import', headers: { authorization: 'Bearer ' + token, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    expect((await up(reader)).statusCode).toBe(403);
    expect((await up(admin)).json()).toEqual({ created: 2, updated: 0 });
    expect((await up(admin)).json()).toEqual({ created: 0, updated: 2 });
    const list = (await call('GET', '/birthdays', admin)).json();
    expect(list).toEqual([
      { id: expect.any(String), name: 'Diego Rafael Brasil', day: 12, month: 8, year: 1988 },
      { id: expect.any(String), name: 'Noêmia Soares Guimarães', day: 5, month: 11, year: null },
    ]);
    expect((await call('GET', '/birthdays', reader)).json()[0]).not.toHaveProperty('year');
    expect((await call('POST', '/birthdays', admin, { name: 'X', day: 31, month: 2 })).statusCode).toBe(400);
    const n = await call('POST', '/birthdays', admin, { name: 'Suyane Vernizze', day: 1, month: 12 });
    expect(n.statusCode).toBe(201);
    expect((await call('POST', '/birthdays', admin, { name: 'suyane vernizze', day: 2, month: 12 })).statusCode).toBe(409);
    expect((await call('PATCH', `/birthdays/${n.json().id}`, admin, { name: 'Suyane Vernizze', day: 2, month: 12 })).json().day).toBe(2);
    expect((await call('DELETE', `/birthdays/${n.json().id}`, reader)).statusCode).toBe(403);
    expect((await call('DELETE', `/birthdays/${n.json().id}`, admin)).statusCode).toBe(204);
  });
  it('compromissos: pessoais por padrão, da equipe quando marcados; só o dono altera', async () => {
    const mineA = await call('POST', '/appointments', admin, { date: '2026-11-20', time: '09:30', title: 'Reunião com o Diego' });
    expect(mineA.statusCode).toBe(201);
    const team = await call('POST', '/appointments', admin, { date: '2026-11-21', title: 'Confraternização', shared: true });
    expect((await call('POST', '/appointments', admin, { date: '2026-11-20', time: '25:00', title: 'x' })).statusCode).toBe(400);
    const range = '?from=2026-11-01&to=2026-11-30';
    expect((await call('GET', '/appointments' + range, admin)).json().map((a: { title: string }) => a.title)).toEqual(['Reunião com o Diego', 'Confraternização']);
    const seen = (await call('GET', '/appointments' + range, reader)).json();
    expect(seen).toEqual([expect.objectContaining({ title: 'Confraternização', mine: false, owner: 'Admin' })]);
    expect((await call('PATCH', `/appointments/${team.json().id}`, reader, { date: '2026-11-21', title: 'hack' })).statusCode).toBe(404);
    expect((await call('DELETE', `/appointments/${mineA.json().id}`, reader)).statusCode).toBe(404);
    expect((await call('PATCH', `/appointments/${mineA.json().id}`, admin, { date: '2026-11-20', time: '10:00', title: 'Reunião', notes: 'sala 2' })).json()).toMatchObject({ time: '10:00', notes: 'sala 2', shared: false });
    expect((await call('GET', '/appointments?from=2026-12-01&to=2026-12-31', admin)).json()).toHaveLength(0);
    expect((await call('DELETE', `/appointments/${mineA.json().id}`, admin)).statusCode).toBe(204);
  });
  it('copia o plano de manutenção para outro veículo', async () => {
    const v2 = (await call('POST', '/vehicles', admin, { plate: 'MFS7D92', name: 'UNO', refKm: 227000 })).json();
    const r = await call('POST', '/maintenance/plan/copy', admin, { fromVehicleId: vehicleId, toVehicleId: v2.id, lastKm: 220000, lastDate: '2026-08-01' });
    expect(r.statusCode).toBe(201);
    expect(r.json().created).toBeGreaterThan(0);
    expect((await call('POST', '/maintenance/plan/copy', admin, { fromVehicleId: vehicleId, toVehicleId: v2.id })).json()).toMatchObject({ created: 0 });
    expect((await call('POST', '/maintenance/plan/copy', reader, { fromVehicleId: vehicleId, toVehicleId: v2.id })).statusCode).toBe(403);
    expect((await call('POST', '/maintenance/plan/copy', admin, { fromVehicleId: v2.id, toVehicleId: v2.id })).statusCode).toBe(400);
    const plan = (await call('GET', '/maintenance/plan', admin)).json().filter((p: { vehicleId: string }) => p.vehicleId === v2.id);
    expect(plan[0]).toMatchObject({ lastKm: 220000, lastDate: '2026-08-01', nextKm: 230000 });
  });
});
