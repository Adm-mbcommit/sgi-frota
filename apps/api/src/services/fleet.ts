/** Carrega os dados de uma empresa do banco e aplica as regras do @sgi/core. */
import { and, eq } from 'drizzle-orm';
import { DEFAULT_CONFIG, analyzeFleet, localDate, type FleetConfig, type FleetData, type Period } from '@sgi/core';
import type { DB } from '../db/client.js';
import * as s from '../db/schema.js';

export async function loadConfig(db: DB, orgId: string): Promise<FleetConfig> {
  const [o] = await db.select().from(s.organizations).where(eq(s.organizations.id, orgId));
  const st = await db.select().from(s.stations).where(and(eq(s.stations.organizationId, orgId), eq(s.stations.active, true)));
  // Chaves sync* são internas da sincronização (hash da chave etc.): não vão para a configuração.
  const settings = Object.fromEntries(Object.entries(o?.settings ?? {}).filter(([k]) => !k.startsWith('sync')));
  return { ...DEFAULT_CONFIG, ...settings, empresa: o?.companyLabel ?? DEFAULT_CONFIG.empresa, postos: st.map((x) => x.name) };
}

export interface LoadedFleet { data: FleetData; ids: { vehicleByPlate: Map<string, string>; plateById: Map<string, string>; driverByName: Map<string, string> } }

export async function loadFleetData(db: DB, orgId: string): Promise<LoadedFleet> {
  const [vs, ds, tr, fu, sp, pl, dc, cs, ck] = await Promise.all([
    db.select().from(s.vehicles).where(and(eq(s.vehicles.organizationId, orgId), eq(s.vehicles.active, true))),
    db.select().from(s.drivers).where(eq(s.drivers.organizationId, orgId)),
    db.select().from(s.trips).where(eq(s.trips.organizationId, orgId)),
    db.select().from(s.fuelings).where(eq(s.fuelings.organizationId, orgId)),
    db.select().from(s.speedEvents).where(eq(s.speedEvents.organizationId, orgId)),
    db.select().from(s.maintenancePlan).where(and(eq(s.maintenancePlan.organizationId, orgId), eq(s.maintenancePlan.active, true))),
    db.select().from(s.vehicleDocuments).where(eq(s.vehicleDocuments.organizationId, orgId)),
    db.select().from(s.costs).where(eq(s.costs.organizationId, orgId)),
    db.select({ at: s.checklists.at, driverId: s.checklists.driverId }).from(s.checklists).where(eq(s.checklists.organizationId, orgId)),
  ]);
  const plateById = new Map(vs.map((v) => [v.id, v.plate]));
  const nameById = new Map(ds.map((d) => [d.id, d.name]));
  const P = (id: string | null) => (id ? plateById.get(id) ?? null : null);
  const N = (id: string | null) => (id ? nameById.get(id) ?? null : null);
  const data: FleetData = {
    vehicles: vs.map((v) => ({ plate: v.plate, name: v.name, refKm: v.refKm, status: v.status })),
    trips: tr.map((t) => ({ id: t.id, company: t.company, plate: P(t.vehicleId), driver: N(t.driverId), driverRaw: t.driverRaw,
      startedAt: t.startedAt.getTime(), endedAt: t.endedAt?.getTime() ?? null, kmStart: t.kmStart, kmEnd: t.kmEnd, open: t.open, status: t.status })),
    fuel: fu.map((f) => ({ id: f.id, company: f.company, plate: P(f.vehicleId), driver: N(f.driverId), at: f.at.getTime(),
      km: f.km, liters: f.liters, total: f.total, station: f.station, fullTank: f.fullTank, notes: f.notes })),
    speed: sp.map((e) => ({ id: e.id, plate: P(e.vehicleId), startedAt: e.startedAt.getTime(), durationH: e.durationH, vmax: e.vmax, vavg: e.vavg, from: e.addressStart, to: e.addressEnd })),
    plan: pl.filter((p) => plateById.has(p.vehicleId)).map((p) => ({ id: p.id, plate: P(p.vehicleId)!, item: p.item, intervalKm: p.intervalKm, intervalMonths: p.intervalMonths,
      lastKm: p.lastKm, lastDate: p.lastDate, needsCheck: p.needsCheck, source: p.source })),
    docs: dc.filter((d) => plateById.has(d.vehicleId)).map((d) => ({ plate: P(d.vehicleId)!, crlv: d.crlv, ipva: d.ipva, licensing: d.licensing, insurance: d.insurance, confirmed: d.confirmed })),
    drivers: ds.filter((d) => d.active).map((d) => ({ name: d.name, cnhExpiry: d.cnhExpiry })),
    costs: cs.map((c) => ({ id: c.id, date: c.date, plate: P(c.vehicleId), category: c.category, description: c.description, supplier: c.supplier, amount: c.amount, notes: c.notes })),
    checklists: ck.map((c) => ({ at: c.at.getTime(), driver: N(c.driverId) })),
  };
  return { data, ids: { vehicleByPlate: new Map(vs.map((v) => [v.plate, v.id])), plateById, driverByName: new Map(ds.map((d) => [d.name, d.id])) } };
}

/** Período padrão: do dia 1 do mês anterior até hoje. */
export function defaultPeriod(now = Date.now()): Period {
  const today = localDate(now);
  const [y, m] = today.split('-').map(Number);
  const from = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
  return { from, to: today };
}

export async function analyzeOrg(db: DB, orgId: string, period?: Partial<Period>) {
  const [cfg, loaded] = await Promise.all([loadConfig(db, orgId), loadFleetData(db, orgId)]);
  const p = { ...defaultPeriod(), ...Object.fromEntries(Object.entries(period ?? {}).filter(([, v]) => v)) } as Period;
  return { cfg, ...loaded, analysis: analyzeFleet(loaded.data, cfg, p) };
}
