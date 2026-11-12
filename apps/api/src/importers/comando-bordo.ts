/**
 * Importação da planilha do Comando de Bordo (Google Forms/Sheets).
 * Abas: "Registros" (viagens), "Abastecimentos", "manutencao_diaria" (checklist).
 * As colunas são as mesmas do artefato original. A reimportação é idempotente:
 * cada linha recebe uma chave (hash de saída + placa + motorista) e é atualizada
 * se já existir (ex.: viagem que foi encerrada depois).
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { parseInstant, parseKm, parseNum } from '@sgi/core';
import type { DB } from '../db/client.js';
import { checklists, fuelings, trips } from '../db/schema.js';
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

export interface ComandoBordoData { trips: Row[]; fuel: Row[]; check: Row[] }

export async function importComandoBordo(db: DB, orgId: string, R: OrgResolver, data: ComandoBordoData, source: Source = 'COMANDO_BORDO') {
  const t = mapTrips(data.trips, orgId, R, source);
  const f = mapFuel(data.fuel, orgId, R, source);
  const c = mapChecklists(data.check, orgId, R, source);
  await db.transaction(async (tx) => {
    await upsert(tx as unknown as DB, trips, t, ['company', 'vehicle_id', 'driver_id', 'ended_at', 'location_end', 'km_end_raw', 'km_end', 'km_start', 'km_start_raw', 'open', 'notes', 'status', 'updated_at']);
    await upsert(tx as unknown as DB, fuelings, f, ['company', 'vehicle_id', 'driver_id', 'km', 'liters', 'total', 'station', 'fuel_type', 'full_tank', 'notes', 'updated_at']);
    await upsert(tx as unknown as DB, checklists, c, ['vehicle_id', 'driver_id', 'km', 'answers', 'notes']);
  });
  return { trips: t.length, fuel: f.length, checklists: c.length };
}
