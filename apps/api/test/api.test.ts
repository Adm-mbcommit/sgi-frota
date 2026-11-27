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
    expect((await call('PUT', '/settings', admin, { kmAlert2: 2000 })).statusCode).toBe(400); // 2º maior que o 1º
    expect((await call('GET', '/settings', reader)).json()).toMatchObject({ kmAlert: 1500, kmAlert2: 1000, kmAlert3: 500 });
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
  it('serviços de Custos viram sugestão; lançar serviço antigo não mexe no prazo nem duplica o custo', async () => {
    const plan = (await call('GET', '/maintenance/plan', admin)).json().filter((p: { vehicleId: string }) => p.vehicleId === vehicleId);
    const item = plan[0];
    const cost = (await call('POST', '/costs', admin, { date: '2020-03-10', vehicleId, category: 'Manutenção', description: '4ª REVISÃO ', supplier: 'VIASERRA', amount: 2700, invoice: 'NF 188863' })).json();
    let hints = (await call('GET', '/maintenance/hints', reader)).json();
    expect(hints).toContainEqual(expect.objectContaining({ source: 'custos', costId: cost.id, description: '4ª REVISÃO', supplier: 'VIASERRA', date: '2020-03-10' }));
    const before = (await call('GET', '/costs', admin)).json().length;
    const r = await call('POST', `/maintenance/plan/${item.id}/records`, admin, { km: 1000, date: '2020-03-10', supplier: 'VIASERRA', costId: cost.id });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ updatedPlan: false, costId: cost.id });
    const after = (await call('GET', '/maintenance/plan', admin)).json().find((p: { id: string }) => p.id === item.id);
    expect(after).toMatchObject({ lastKm: item.lastKm, lastDate: item.lastDate });
    expect((await call('GET', '/costs', admin)).json()).toHaveLength(before);
    hints = (await call('GET', '/maintenance/hints', admin)).json();
    expect(hints.some((h: { costId: string }) => h.costId === cost.id)).toBe(false);
    expect((await call('GET', '/maintenance/records', admin)).json().some((x: { date: string }) => x.date === '2020-03-10')).toBe(true);
    const bat = (await call('POST', '/costs', admin, { date: '2020-06-01', vehicleId, category: 'Manutenção', description: 'Troca de bateria', amount: 399 })).json();
    expect((await call('GET', '/maintenance/hints', admin)).json().some((h: { costId: string }) => h.costId === bat.id)).toBe(true);
    expect((await call('POST', '/maintenance/hints/dismiss', reader, { key: 'c' + bat.id })).statusCode).toBe(403);
    expect((await call('POST', '/maintenance/hints/dismiss', admin, { key: 'c' + bat.id })).statusCode).toBe(204);
    expect((await call('GET', '/maintenance/hints', admin)).json().some((h: { costId: string }) => h.costId === bat.id)).toBe(false);
    expect(JSON.stringify((await call('GET', '/settings', admin)).json())).not.toContain('maintHints');
  });
  it('importa a planilha Gestão Frota: próxima revisão vira base do prazo e Custos sem duplicar', async () => {
    await call('POST', '/maintenance/plan', admin, { vehicleId, item: 'Revisão geral', intervalKm: 10000, intervalMonths: 12, lastKm: null, lastDate: null });
    const wb = new ExcelJS.Workbook();
    const m = wb.addWorksheet('Manutencoes');
    m.addRow(['Veículo', 'Placa', 'Data da manutenção', 'KM da manutenção', 'Serviço realizado', 'Oficina/fornecedor', 'Valor', 'Próxima manutenção', 'KM atual']);
    m.addRow(['SAVEIRO - 55', 'TPR0F55', null, null, null, null, null, 60263, 50270]);
    m.addRow(['CARRO X', 'ZZZ9Z99', null, null, null, null, null, 1000, 10]);
    const c = wb.addWorksheet('Custos');
    c.addRow(['Data', 'Veículo', 'Placa', 'Categoria', 'Descrição', 'Fornecedor', 'Valor', 'Observação']);
    c.addRow([new Date(Date.UTC(2026, 10, 9)), 'SAVEIR0 - 55', null, 'Manutenção', '5ª REVISÃO', 'VIASERRA', 1800, 'NF - 190001']);
    c.addRow([new Date(Date.UTC(2026, 9, 15)), 'SAVEIRO - 55', 'TPR0F55', 'Conserto', 'Troca de parabrisa', 'Biocar', 270, null]);
    const boundary = '----gestao';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="Gestao_frota_MATIAS.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from(await wb.xlsx.writeBuffer()), Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const up = () => app.inject({ method: 'POST', url: '/api/v1/imports/gestao-frota', headers: { authorization: 'Bearer ' + admin, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    const r1 = (await up()).json();
    expect(r1.costs).toMatchObject({ read: 2, created: 2 });
    expect(r1.revisions).toEqual([expect.objectContaining({ nextKm: 60263, lastDate: '2026-11-09' })]);
    expect(r1.notFound).toEqual(['CARRO X']);
    const plan = (await call('GET', '/maintenance/plan', admin)).json().find((p: { vehicleId: string; item: string }) => p.vehicleId === vehicleId && p.item === 'Revisão geral');
    expect(plan).toMatchObject({ lastKm: 50263, lastDate: '2026-11-09', nextKm: 60263 });
    const r2 = (await up()).json();
    expect(r2.costs).toMatchObject({ created: 0, existing: 2 });
    const recs = (await call('GET', '/maintenance/records', admin)).json().filter((x: { date: string; item: string }) => x.date === '2026-11-09' && x.item === 'Revisão geral');
    expect(recs).toHaveLength(1);
    expect((await call('GET', '/maintenance/hints', admin)).json().some((h: { date: string; vehicleId: string }) => h.date === '2026-11-09' && h.vehicleId === vehicleId)).toBe(false);
  });
  it('documentos guardam o link do PDF (CRLV) e quem consulta vê', async () => {
    const body = { crlv: '2027-05-31', ipva: null, licensing: null, insurance: null, confirmed: true, links: { crlv: 'https://drive.google.com/file/d/abc123/view' } };
    expect((await call('PUT', `/documents/${vehicleId}`, admin, { ...body, links: { crlv: 'javascript:alert(1)' } })).statusCode).toBe(400);
    expect((await call('PUT', `/documents/${vehicleId}`, admin, body)).statusCode).toBe(200);
    const d = (await call('GET', '/documents', reader)).json().find((x: { vehicleId: string }) => x.vehicleId === vehicleId);
    expect(d.links).toEqual({ crlv: 'https://drive.google.com/file/d/abc123/view' });
    await call('PUT', `/documents/${vehicleId}`, admin, { ...body, links: { insurance: 'https://drive.google.com/file/d/seg/view' } });
    expect((await call('GET', '/documents', admin)).json().find((x: { vehicleId: string }) => x.vehicleId === vehicleId).links).toMatchObject({ crlv: expect.any(String), insurance: expect.any(String) });
    await call('PUT', `/documents/${vehicleId}`, admin, { ...body, links: { crlv: '' } });
    expect((await call('GET', '/documents', admin)).json().find((x: { vehicleId: string }) => x.vehicleId === vehicleId).links.crlv).toBeUndefined();
  });
  it('importa o Chronos com a distância (reimportar completa o km) e calcula o uso dos veículos', async () => {
    const head = ['Unidade rastreada', 'Data inicial', 'Data final', 'Duração', 'Distância (km)', 'Vel. máxima', 'Vel. média', 'Endereço inicial', 'Endereço final'];
    const base = 'Rua Brasília, 201 - São Cristóvão, Lages - SC';
    const rows = [
      ['TPR0F55', '10/11/2026 07:00:00', '10/11/2026 07:30:00', '00:30:00', 12, 90, 40, base, 'Rua Israel, 50 - Vila Mariza, Lages - SC'],
      ['TPR0F55', '10/11/2026 12:00:00', '10/11/2026 12:30:00', '00:30:00', 12, 131, 50, 'Rua Israel, 50 - Vila Mariza, Lages - SC', 'Av. JK, 10 - Maria Luíza, Lages - SC'],
      ['TPR0F55', '11/11/2026 21:00:00', '11/11/2026 21:15:00', '00:15:00', 4, 60, 30, 'Av. JK, 10 - Maria Luíza, Lages - SC', base],
    ];
    const up = async (withKm: boolean) => {
      const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Relatório');
      ws.addRow(['Períodos de utilização']); ws.addRow(withKm ? head : head.filter((h) => h !== 'Distância (km)'));
      for (const r of rows) ws.addRow(withKm ? r : r.filter((_, i) => i !== 4));
      const boundary = '----ch';
      const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="Relatorio_Rastreamento.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        Buffer.from(await wb.xlsx.writeBuffer()), Buffer.from(`\r\n--${boundary}--\r\n`)]);
      return (await app.inject({ method: 'POST', url: '/api/v1/imports/chronos', headers: { authorization: 'Bearer ' + admin, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload })).json();
    };
    expect(await up(false)).toMatchObject({ read: 3, inserted: 3 });
    expect(await up(true)).toMatchObject({ read: 3, inserted: 0 });
    const u = (await call('GET', '/usage?from=2026-11-10&to=2026-11-11&plate=TPR0F55', reader)).json();
    expect(u.totals).toMatchObject({ trips: 3, km: 28, offTrips: 1, high: 1, nightsAway: 1 });
    expect(u.overnights[0]).toMatchObject({ place: 'Av. JK, 10 - Maria Luíza, Lages - SC', nights: 1, first: '2026-11-10' });
    expect(u.places[0].list[0]).toMatchObject({ place: 'Rua Israel, 50 - Vila Mariza, Lages - SC', atBase: false, stops: 1 });
    expect(u.places[0].list[0].hours).toBeCloseTo(4.5);
    expect(u.flagged).toHaveLength(2);
  });

  it('importa os pagamentos do Mais Controle: sem combustível, sem duplicar e substituindo o mesmo serviço lançado antes', async () => {
    const legacy = (await call('POST', '/costs', admin, { date: '2026-09-04', vehicleId, category: 'Manutenção', description: '4ª REVISÃO', supplier: 'VIASERRA', amount: 2700 })).json();
    const legacy2 = (await call('POST', '/costs', admin, { date: '2026-09-04', vehicleId, category: 'Manutenção', description: 'Peças da revisão', supplier: 'VIASERRA', amount: null })).json();
    const plan = (await call('GET', '/maintenance/plan', admin)).json().find((p: { vehicleId: string }) => p.vehicleId === vehicleId);
    const rec = (await call('POST', `/maintenance/plan/${plan.id}/records`, admin, { km: 40264, date: '2026-09-04', costId: legacy.id })).json();
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Pagamentos');
    ws.addRow(['Índice', 'Data de Competência', 'Data de Vencimento', 'Data de Pagamento', 'Valor da Parcela', 'Valor em Aberto', 'Valor Pago da Parcela', 'Juros / Multas', 'Descontos', 'Valor Total Pago', 'Fornecedor', 'CNPJ / CPF do Fornecedor', 'Dados Bancários do Fornecedor', 'Descrição', 'Número do Documento', 'Categoria']);
    ws.addRow(['1', '04/09/2026', '08/10/2026', '08/10/2026', 1350, 0, 1350, 0, 0, 1350, 'Auto Elite Ltda', '', null, 'Revisao TPR0F55 - Saveiro', '188863', 'Frota']);
    ws.addRow(['2', '04/09/2026', '10/11/2026', '', 1350, 1350, 0, 0, 0, 0, 'Auto Elite Ltda', '', null, 'Revisao TPR0F55 - Saveiro', '188863', 'Frota']);
    ws.addRow(['3', '07/10/2026', '11/12/2026', '', 231.61, 231.61, 0, 0, 0, 0, 'Posto Elefantinho', '', null, 'Combustível Placa TPR0F55 Saveiro', '218309', 'Frota']);
    ws.addRow(['4', '22/10/2026', '', '', 8.7, 8.7, 0, 0, 0, 0, 'Planalto Sul', '', null, 'Pedágio', 'Não tem NF', 'Frota']);
    const boundary = '----mc';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="Pagamentos.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from(await wb.xlsx.writeBuffer()), Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const up = () => app.inject({ method: 'POST', url: '/api/v1/imports/mais-controle', headers: { authorization: 'Bearer ' + admin, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    const r1 = (await up()).json();
    expect(r1).toMatchObject({ read: 3, created: 3, skippedFuel: 1, withoutVehicle: 1 });
    expect(r1.replaced.map((x: { description: string }) => x.description).sort()).toEqual(['4ª REVISÃO', 'Peças da revisão']);
    const all = (await call('GET', '/costs', admin)).json();
    expect(all.some((c: { id: string }) => c.id === legacy.id || c.id === legacy2.id)).toBe(false);
    const mc = all.filter((c: { invoice: string }) => c.invoice === '188863');
    expect(mc.map((c: { amount: number }) => c.amount)).toEqual([1350, 1350]);
    const recs = (await call('GET', '/maintenance/records', admin)).json();
    expect(mc.map((c: { id: string }) => c.id)).toContain(recs.find((x: { id: string }) => x.id === rec.id).costId);
    const r2 = (await up()).json();
    expect(r2).toMatchObject({ created: 0, existing: 3, replaced: [] });
  });
  it('certidões (CNDs): cadastra empresa, grava e renova a certidão, calcula o alerta e bloqueia o leitor', async () => {
    const co = await call('POST', '/companies', admin, { shortName: 'Matias 26', name: 'MATIAS BRASIL ENGENHARIA LTDA', cnpj: '26951857000180' });
    expect(co.statusCode).toBe(201);
    expect(co.json().cnpj).toBe('26.951.857/0001-80');
    const companyId = co.json().id;
    expect((await call('POST', '/companies', reader, { shortName: 'X', name: 'X LTDA', cnpj: '11.111.111/0001-11' })).statusCode).toBe(403);
    const put = (body: object, token = admin) => call('PUT', '/certificates', token, { companyId, ...body });
    expect((await put({ kind: 'FGTS', expiresOn: '2000-01-01' })).statusCode).toBe(200);
    // falência sem vencimento: 90 dias da emissão, marcado como estimado
    const fal = (await put({ kind: 'FALENCIA', issuedOn: '2026-11-09', link: 'https://drive.google.com/file/d/abc/view' })).json();
    expect(fal).toMatchObject({ expiresOn: '2027-02-07', expiryEstimated: true });
    expect((await put({ kind: 'FGTS', expiresOn: '2000-01-01', link: 'javascript:alert(1)' })).statusCode).toBe(400);
    expect((await put({ kind: 'FGTS', expiresOn: '2000-01-01' }, reader)).statusCode).toBe(403);
    let list = (await call('GET', '/certificates', reader)).json();
    let c = list.companies.find((x: { id: string }) => x.id === companyId);
    expect(c.certificates).toHaveLength(6);
    const fgts = () => c.certificates.find((x: { kind: string }) => x.kind === 'FGTS');
    expect(fgts().status).toBe('VENCIDO');
    expect(c.certificates.find((x: { kind: string }) => x.kind === 'FEDERAL').status).toBe('SEM_DADO');
    // renovar substitui a mesma linha
    const today = list.today as string;
    const soon = new Date(Date.parse(today) + 5 * 86_400_000).toISOString().slice(0, 10);
    await put({ kind: 'FGTS', expiresOn: soon });
    list = (await call('GET', '/certificates', admin)).json();
    c = list.companies.find((x: { id: string }) => x.id === companyId);
    expect(fgts()).toMatchObject({ status: 'ATENCAO', days: 5, alertDays: 7 });
    await put({ kind: 'FGTS', expiresOn: soon, alertDays: 3 });
    c = (await call('GET', '/certificates', admin)).json().companies.find((x: { id: string }) => x.id === companyId);
    expect(fgts()).toMatchObject({ status: 'OK', alertDays: 3, customAlert: true });
    expect((await call('DELETE', '/certificates/' + fgts().id, admin)).statusCode).toBe(204);
  });
  it('certidões: leitura automática da pasta do Drive (nome do arquivo e texto do PDF), sem voltar para uma mais antiga', async () => {
    // PDF mínimo com o texto da certidão de falência do TJSC
    const pdf = (text: string) => {
      const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        `<< /Length ${text.length + 37} >>\nstream\nBT /F1 10 Tf 20 700 Td (${text}) Tj ET\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
      let out = '%PDF-1.4\n'; const offs: number[] = [];
      objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
      const x = out.length;
      out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
      return Buffer.from(out + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`, 'latin1').toString('base64');
    };
    const co = (await call('POST', '/companies', admin, { shortName: 'Matias 44', name: 'MATIAS 44 LTDA', cnpj: '44.801.324/0001-02', driveFolder: 'https://drive.google.com/drive/folders/1Fsu7pnp8qMXWgKf566cX2zDlxmwdCviE' })).json();
    expect((await call('POST', '/certificates/sync/token', reader)).statusCode).toBe(403);
    const { token } = (await call('POST', '/certificates/sync/token', admin)).json();
    const sync = (body: object, t = token) => app.inject({ method: 'POST', url: '/api/v1/certificates/sync', headers: { 'x-sync-token': t }, payload: body });
    expect((await sync({ files: [] }, 'chave-errada-com-mais-de-20-letras')).statusCode).toBe(401);
    const folders = (await app.inject({ method: 'GET', url: '/api/v1/certificates/sync/folders', headers: { 'x-sync-token': token } })).json();
    expect(folders).toContainEqual({ companyId: co.id, shortName: 'Matias 44', folderId: '1Fsu7pnp8qMXWgKf566cX2zDlxmwdCviE' });
    const url = (id: string) => `https://drive.google.com/file/d/${id}/view`;
    const files = [
      { companyId: co.id, fileId: 'fgtsAntigo0001', name: 'CND FGTS - VAL 10.11.2026.pdf', url: url('fgtsAntigo0001') },
      { companyId: co.id, fileId: 'fgtsNovo000001', name: 'CND FGTS - VAL 09.12.26.pdf', url: url('fgtsNovo000001') },
      { companyId: co.id, fileId: 'falencia000001', name: 'FALENCIA.pdf', url: url('falencia000001') },
      { companyId: co.id, fileId: 'balanco0000001', name: 'Balanço Patrimonial ECD 2025.pdf', url: url('balanco0000001') },
    ];
    const r1 = (await sync({ files })).json();
    expect(r1.need).toEqual(['falencia000001']);
    expect(r1.updated.map((u: { kind: string; expiresOn: string }) => [u.kind, u.expiresOn])).toEqual([['FGTS', '2026-12-09']]);
    const r2 = (await sync({ files, contents: { falencia000001: pdf('Certidao emitida as 09:06 de 09/11/2026.') } })).json();
    expect(r2).toMatchObject({ need: [], unreadable: [] });
    expect(r2.updated).toEqual([expect.objectContaining({ kind: 'FALENCIA', expiresOn: '2027-02-07' })]);
    // já lido: não pede o PDF de novo e não muda nada
    expect((await sync({ files })).json()).toMatchObject({ need: [], updated: [] });
    // um arquivo mais antigo não substitui a certidão digitada na tela
    await call('PUT', '/certificates', admin, { companyId: co.id, kind: 'MUNICIPAL', expiresOn: '2026-12-31' });
    expect((await sync({ files: [{ companyId: co.id, fileId: 'munAntigo00001', name: 'CND MUNICIPAL - VAL 08.11.2026', url: url('munAntigo00001') }] })).json().updated).toEqual([]);
    const c = (await call('GET', '/certificates', admin)).json().companies.find((x: { id: string }) => x.id === co.id);
    const k = (kind: string) => c.certificates.find((x: { kind: string }) => x.kind === kind);
    expect(k('FALENCIA')).toMatchObject({ issuedOn: '2026-11-09', expiryEstimated: true, link: url('falencia000001') });
    expect(k('FGTS').link).toBe(url('fgtsNovo000001'));
    expect(k('MUNICIPAL').expiresOn).toBe('2026-12-31');
    expect((await call('GET', '/certificates/sync', admin)).json()).toMatchObject({ configured: true });
  });
  it('checklist periódico: grava a vistoria, abre pendência do problema, guarda e devolve a foto', async () => {
    const tpl = (await call('GET', '/inspections/template', admin)).json();
    expect(tpl.intervalDays).toBe(15);
    let board = (await call('GET', '/inspections/board', admin)).json();
    expect(board.vehicles.find((v: { vehicleId: string }) => v.vehicleId === vehicleId).status).toBe('NUNCA');
    const today = board.today as string;
    const items = [{ key: 'pneus', status: 'PROBLEMA', note: 'Dianteiro esquerdo careca' }, { key: 'farois', status: 'OK' }, { key: 'extra1', label: 'Adesivo da empresa', status: 'ATENCAO' }];
    expect((await call('POST', '/inspections', reader, { vehicleId, date: today, items })).statusCode).toBe(403);
    expect((await call('POST', '/inspections', admin, { vehicleId, date: '2999-01-01', items })).statusCode).toBe(400);
    const r = await call('POST', '/inspections', admin, { vehicleId, date: today, km: 46000, fuelLevel: '1/2', items });
    expect(r.statusCode).toBe(201);
    const insp = r.json();
    expect(insp.tasksCreated).toBe(1);
    const t = (await call('GET', '/tasks', admin)).json().find((x: { title: string }) => x.title.endsWith('Pneus (desgaste e calibragem)'));
    expect(t).toMatchObject({ vehicleId, status: 'ABERTO' });
    expect(t.description).toContain('Dianteiro esquerdo careca');
    // editar sem mudar o problema não duplica a pendência
    expect((await call('PATCH', '/inspections/' + insp.id, admin, { items, notes: 'ok' })).json().tasksCreated).toBe(0);

    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
    const b = '----sgi' + Date.now();
    const payload = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="f.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), jpeg, Buffer.from(`\r\n--${b}--\r\n`)]);
    const up = (slot: string, token = admin) => app.inject({ method: 'POST', url: `/api/v1/inspections/${insp.id}/photos?slot=${slot}`, headers: { authorization: 'Bearer ' + token, 'content-type': 'multipart/form-data; boundary=' + b }, payload });
    expect((await up('frente', reader)).statusCode).toBe(403);
    expect((await up('teto')).statusCode).toBe(400);
    const ph = await up('frente');
    expect(ph.statusCode).toBe(201);
    const img = await call('GET', '/inspection-photos/' + ph.json().id, reader);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(img.rawPayload.equals(jpeg)).toBe(true);

    const det = (await call('GET', '/inspections/' + insp.id, reader)).json();
    expect(det).toMatchObject({ km: 46000, fuelLevel: '1/2', userName: 'Admin', photos: [{ slot: 'frente' }] });
    expect(det.items.find((i: { key: string }) => i.key === 'extra1')).toMatchObject({ label: 'Adesivo da empresa', group: 'Outros' });
    board = (await call('GET', '/inspections/board', reader)).json();
    expect(board.vehicles.find((v: { vehicleId: string }) => v.vehicleId === vehicleId)).toMatchObject({ status: 'EM_DIA', days: 15, last: { problems: 1, attention: 1, ok: 1, photoId: ph.json().id } });
    expect((await call('GET', '/inspections', reader)).json()[0]).toMatchObject({ id: insp.id, photos: 1, problems: 1 });
    expect((await call('PUT', '/settings', admin, { inspectionDays: 3, inspectionAlertDays: 3 })).statusCode).toBe(400);
    expect((await call('DELETE', '/inspections/' + insp.id, admin)).statusCode).toBe(204);
    expect((await call('GET', '/inspection-photos/' + ph.json().id, admin)).statusCode).toBe(404);
  });
});
