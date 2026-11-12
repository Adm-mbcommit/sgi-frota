/**
 * Importação da planilha do Comando de Bordo (Google Forms/Sheets).
 * Abas: "Registros" (viagens), "Abastecimentos", "manutencao_diaria" (checklist) e
 * "Manutencao" (última manutenção por veículo e item, que os motoristas atualizam).
 * As colunas são as mesmas do artefato original. A reimportação é idempotente:
 * cada linha recebe uma chave (hash de saída + placa + motorista) e é atualizada
 * se já existir (ex.: viagem que foi encerrada depois).
 */
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { parseDate, parseInstant, parseKm, parseNum } from '@sgi/core';
import type { DB } from '../db/client.js';
import { checklists, fuelings, maintenancePlan, maintenanceRecords, trips } from '../db/schema.js';
import { applyToPlan, brDate, itemKey } from '../services/maintenance.js';
import type { OrgResolver } from '../services/resolver.js';

type Row = unknown[];
type Source = 'LEGADO' | 'COMANDO_BORDO';
const txt = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const key = (...parts: unknown[]) => createHash('sha1').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex');
const date = (t: number | null) => (t == null ? null : new Date(t));

export function mapTrips(rows: Row[], orgId: string, R: OrgResolver, source: Source) {
  return rows.filter((r) => parseInstant(r[0]) != null).map((r) => ({
    organizationId: orgId, source,
    externalKey: key('trip', r[0], r[3], r[4]),
    company: txt(r[1]) ?? '', vehicleId: R.vehicleId(r[3]), driverId: R.driverId(r[4]),
    plateRaw: txt(r[3]), driverRaw: txt(r[4]),
    startedAt: date(parseInstant(r[0]))!, endedAt: date(parseInstant(r[7])),
    locationStart: txt(r[5]), kmStartRaw: txt(r[6]), kmStart: parseKm(r[6]),
    locationEnd: txt(r[8]), kmEndRaw: txt(r[9]), kmEnd: parseKm(r[9]),
    open: r[9] == null || r[9] === '', notes: txt(r[10]), status: txt(r[11]),
  }));
}

export function mapFuel(rows: Row[], orgId: string, R: OrgResolver, source: Source) {
  return rows.filter((r) => parseInstant(r[0]) != null).map((r) => ({
    organizationId: orgId, source,
    externalKey: key('fuel', r[0], r[3], r[4]),
    company: txt(r[1]) ?? '', vehicleId: R.vehicleId(r[3]), driverId: R.driverId(r[4]),
    plateRaw: txt(r[3]), driverRaw: txt(r[4]), at: date(parseInstant(r[0]))!,
    km: parseKm(r[5]), liters: parseNum(r[6]), total: parseNum(r[7]), station: txt(r[9]), fuelType: txt(r[10]),
    fullTank: r[14] === 'Não' ? false : r[14] === 'Sim' ? true : null, notes: txt(r[15]),
  }));
}

export function mapChecklists(rows: Row[], orgId: string, R: OrgResolver, source: Source) {
  return rows.filter((r) => parseInstant(r[0]) != null).map((r) => ({
    organizationId: orgId, source,
    externalKey: key('check', r[0], r[3], r[4]),
    vehicleId: R.vehicleId(r[3]), driverId: R.driverId(r[4]), plateRaw: txt(r[3]), driverRaw: txt(r[4]),
    at: date(parseInstant(r[0]))!, km: parseKm(r[5]), answers: r.slice(6, -1), notes: txt(r[r.length - 1]),
  }));
}

const excluded = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, sql.raw(`excluded."${c}"`)]));
const CHUNK = 500;

async function upsert<T extends Record<string, unknown>>(db: DB, table: typeof trips | typeof fuelings | typeof checklists, rows: T[], updateCols: string[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(table).values(rows.slice(i, i + CHUNK) as never)
      .onConflictDoUpdate({ target: [table.organizationId, table.externalKey], set: excluded(updateCols) as never });
  }
}

/**
 * Aba "Manutencao": Empresa | Veículo | Placa | KM Atual | Item | Última Manutenção KM | Intervalo KM |
 * Próxima KM | KM Restante | Status | Data da última Manutenção. Linhas sem km e sem data são ignoradas.
 */
export function mapMaintenanceTab(rows: Row[], R: OrgResolver) {
  return rows.filter((r) => txt(r[2]) && txt(r[4])).map((r) => ({
    plateRaw: txt(r[2])!, vehicleId: R.vehicleId(r[2]), item: txt(r[4])!,
    km: parseKm(r[5]), intervalKm: parseKm(r[6]), date: parseDate(r[10]),
  })).filter((m) => m.km != null || m.date != null);
}

/**
 * Leva a aba "Manutencao" para o plano: cada item com serviço mais recente que o do SGI
 * atualiza o prazo e entra no histórico (origem Comando de Bordo). Itens mais antigos são ignorados,
 * para não desfazer o que foi lançado em Custos ou registrado no SGI.
 */
async function importMaintenanceTab(db: DB, orgId: string, rows: ReturnType<typeof mapMaintenanceTab>) {
  const stats = { atualizados: 0, semMudanca: 0, semVeiculo: 0, novosItens: 0 };
  const plan = await db.select().from(maintenancePlan).where(eq(maintenancePlan.organizationId, orgId));
  for (const m of rows) {
    if (!m.vehicleId) { stats.semVeiculo++; continue; }
    let p = plan.find((x) => x.vehicleId === m.vehicleId && itemKey(x.item) === itemKey(m.item));
    if (!p) {
      [p] = await db.insert(maintenancePlan).values({ organizationId: orgId, vehicleId: m.vehicleId, item: m.item, intervalKm: m.intervalKm, source: 'Comando de Bordo (aba Manutencao)' }).returning();
      plan.push(p); stats.novosItens++;
    }
    const where = [m.km != null ? `${m.km.toLocaleString('pt-BR')} km` : null, m.date ? brDate(m.date) : null].filter(Boolean).join(', ');
    if (!(await applyToPlan(db, p, m.km, m.date, `Comando de Bordo (aba Manutencao): última em ${where}.`))) { stats.semMudanca++; continue; }
    await db.insert(maintenanceRecords).values({
      organizationId: orgId, planItemId: p.id, vehicleId: m.vehicleId, item: p.item, km: m.km, date: m.date ?? new Date().toISOString().slice(0, 10),
      source: 'COMANDO_BORDO', externalKey: key('maint', m.plateRaw, itemKey(m.item), m.km, m.date), notes: 'Importado da aba Manutencao do Comando de Bordo',
    }).onConflictDoNothing();
    stats.atualizados++;
  }
  return stats;
}

export interface ComandoBordoData { trips: Row[]; fuel: Row[]; check: Row[]; maint?: Row[] }

export async function importComandoBordo(db: DB, orgId: string, R: OrgResolver, data: ComandoBordoData, source: Source = 'COMANDO_BORDO') {
  const t = mapTrips(data.trips, orgId, R, source);
  const f = mapFuel(data.fuel, orgId, R, source);
  const c = mapChecklists(data.check, orgId, R, source);
  const m = data.maint ? mapMaintenanceTab(data.maint, R) : null;
  let manutencao: Awaited<ReturnType<typeof importMaintenanceTab>> | undefined;
  await db.transaction(async (tx) => {
    if (m) manutencao = await importMaintenanceTab(tx as unknown as DB, orgId, m);
    await upsert(tx as unknown as DB, trips, t, ['company', 'vehicle_id', 'driver_id', 'ended_at', 'location_end', 'km_end_raw', 'km_end', 'km_start', 'km_start_raw', 'open', 'notes', 'status', 'updated_at']);
    await upsert(tx as unknown as DB, fuelings, f, ['company', 'vehicle_id', 'driver_id', 'km', 'liters', 'total', 'station', 'fuel_type', 'full_tank', 'notes', 'updated_at']);
    await upsert(tx as unknown as DB, checklists, c, ['vehicle_id', 'driver_id', 'km', 'answers', 'notes']);
  });
  return { trips: t.length, fuel: f.length, checklists: c.length, ...(manutencao ? { manutencao } : {}) };
}
