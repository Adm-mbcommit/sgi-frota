import type { FleetConfig } from './config.js';
import type { CostInput, DriverInput, PlanItemInput, SpeedEventInput, VehicleDocsInput, VehicleInput } from './types.js';
import type { AnalyzedTrip } from './trips.js';
import type { AnalyzedFueling } from './fuel.js';
import { DAY_MS, addMonths, daysBetween, inPeriod, inPeriodDate, localDate, type Period } from './dates.js';

/* ---------------- estado do veículo ---------------- */

export interface VehicleState {
  plate: string;
  /** Maior km confiável: km final das viagens válidas ou inicial das viagens com início válido. */
  currentKm: number;
  lastUse: number | null;
  /** Média de km/dia nas viagens válidas dos últimos `paceDays` dias. */
  kmPerDay: number;
}

export function vehicleStates(vehicles: VehicleInput[], trips: AnalyzedTrip[], cfg: FleetConfig, now: number): Map<string, VehicleState> {
  const since = now - cfg.paceDays * DAY_MS;
  const out = new Map<string, VehicleState>();
  for (const v of vehicles) {
    const tv = trips.filter((t) => t.plate === v.plate);
    const tw = tv.filter((t) => t.startValid);
    const tx = tv.filter((t) => t.valid);
    const currentKm = Math.max(0, ...tx.map((t) => t.kmEnd!), ...tw.map((t) => t.kmStart!));
    const lastUse = tw.length ? Math.max(...tw.map((t) => t.startedAt)) : null;
    const kmPerDay = tx.filter((t) => t.startedAt >= since).reduce((a, t) => a + t.km!, 0) / cfg.paceDays;
    out.set(v.plate, { plate: v.plate, currentKm, lastUse, kmPerDay });
  }
  return out;
}

/* ---------------- velocidade ---------------- */

export interface AttributedSpeedEvent extends SpeedEventInput {
  /** Motorista da viagem em andamento no horário do evento, ou null. */
  driver: string | null;
}

/** Atribui cada evento do rastreador ao motorista da viagem (da empresa) em andamento naquele horário. */
export function attributeSpeedEvents(events: SpeedEventInput[], trips: AnalyzedTrip[], cfg: FleetConfig): AttributedSpeedEvent[] {
  const own = trips.filter((t) => t.company === cfg.empresa);
  return [...events].sort((a, b) => a.startedAt - b.startedAt).map((e) => {
    const t = own.find((t) => t.plate === e.plate && t.startedAt <= e.startedAt && t.effectiveEnd >= e.startedAt);
    return { ...e, driver: t?.driver ?? null };
  });
}

/* ---------------- manutenção ---------------- */

export type MaintStatus = 'VENCIDO' | 'ATENCAO' | 'CONFIRMAR' | 'SEM_DADO' | 'OK';
export const MAINT_STATUS_ORDER: MaintStatus[] = ['VENCIDO', 'ATENCAO', 'CONFIRMAR', 'SEM_DADO', 'OK'];

export interface PlanItemStatus extends PlanItemInput {
  nextKm: number | null;
  dueDate: string | null;
  kmLeft: number | null;
  daysLeft: number | null;
  /** Dias previstos até o km da próxima, pelo ritmo de uso. */
  forecastDays: number | null;
  currentKm: number | null;
  status: MaintStatus;
}

export function maintenanceStatus(items: PlanItemInput[], states: Map<string, VehicleState>, cfg: FleetConfig, today: string): PlanItemStatus[] {
  return items.map((it) => {
    const st = states.get(it.plate);
    const nextKm = it.intervalKm != null && it.lastKm != null ? it.lastKm + it.intervalKm : null;
    const dueDate = it.intervalMonths != null && it.lastDate ? addMonths(it.lastDate, it.intervalMonths) : null;
    const kmLeft = nextKm != null && st ? nextKm - st.currentKm : null;
    const daysLeft = dueDate ? daysBetween(today, dueDate) : null;
    const forecastDays = kmLeft != null && kmLeft > 0 && st && st.kmPerDay > 0 ? kmLeft / st.kmPerDay : null;
    let status: MaintStatus;
    if (it.needsCheck) status = 'CONFIRMAR';
    else if (nextKm == null && dueDate == null) status = 'SEM_DADO';
    else if ((kmLeft != null && kmLeft < 0) || (daysLeft != null && daysLeft < 0)) status = 'VENCIDO';
    else if ((kmLeft != null && kmLeft <= cfg.kmAlert) || (daysLeft != null && daysLeft <= cfg.dayAlert) || (forecastDays != null && forecastDays <= cfg.dayAlert)) status = 'ATENCAO';
    else status = 'OK';
    return { ...it, nextKm, dueDate, kmLeft, daysLeft, forecastDays, currentKm: st?.currentKm ?? null, status };
  });
}

/** Itens que exigem ação, do mais grave ao menos grave. */
export function maintenanceAlerts(plan: PlanItemStatus[]): PlanItemStatus[] {
  const rank: Partial<Record<MaintStatus, number>> = { VENCIDO: 0, ATENCAO: 1, CONFIRMAR: 2 };
  return plan.filter((x) => x.status in rank).sort((a, b) => rank[a.status]! - rank[b.status]!);
}

export function worstMaintenance(plan: PlanItemStatus[], plate: string): MaintStatus {
  const it = plan.filter((x) => x.plate === plate);
  return MAINT_STATUS_ORDER.find((s) => s !== 'OK' && it.some((x) => x.status === s)) ?? 'OK';
}

/* ---------------- documentos e CNH ---------------- */

export type DeadlineStatus = 'ATRASADO' | 'PROXIMO' | 'OK' | 'SEM_DADO';

export function deadlineStatus(date: string | null, today: string, cfg: FleetConfig): { days: number | null; status: DeadlineStatus } {
  if (!date) return { days: null, status: 'SEM_DADO' };
  const days = daysBetween(today, date);
  return { days, status: days < 0 ? 'ATRASADO' : days <= cfg.docDays ? 'PROXIMO' : 'OK' };
}

export interface DocsStatus extends VehicleDocsInput { next: string | null; days: number | null; status: DeadlineStatus }

export function documentsStatus(docs: VehicleDocsInput[], today: string, cfg: FleetConfig): DocsStatus[] {
  return docs.map((d) => {
    const dates = [d.crlv, d.ipva, d.licensing, d.insurance].filter((x): x is string => !!x).sort();
    const next = dates[0] ?? null;
    return { ...d, next, ...deadlineStatus(next, today, cfg) };
  });
}

/* ---------------- painel ---------------- */

export interface VehicleSummary extends VehicleInput, VehicleState {
  trips: number;
  km: number;
  liters: number;
  fuelCost: number;
  kml: number | null;
  fuelCostPerKm: number | null;
  speedEvents: number;
  maxSpeed: number;
  maintenance: MaintStatus;
  docs: DeadlineStatus | null;
}

export interface DriverSummary extends DriverInput {
  cnhStatus: DeadlineStatus;
  cnhDays: number | null;
  trips: number;
  km: number;
  speedEvents: number;
  maxSpeed: number;
  fuelings: number;
  checklists: number;
}

export interface Kpis {
  trips: number; km: number; fuel: number; otherCosts: number; total: number;
  costPerKm: number | null; speedEvents: number; openTrips: number; checklists: number; maintenanceAlerts: number;
}

export interface FleetInputs {
  vehicles: VehicleInput[];
  trips: AnalyzedTrip[];
  fuel: AnalyzedFueling[];
  speed: AttributedSpeedEvent[];
  plan: PlanItemStatus[];
  docs: DocsStatus[];
  drivers: DriverInput[];
  costs: CostInput[];
  checklists: { at: number; driver: string | null }[];
}

export function summarizeVehicles(i: FleetInputs, states: Map<string, VehicleState>, period: Period, cfg: FleetConfig): VehicleSummary[] {
  return i.vehicles.map((v) => {
    const tp = i.trips.filter((t) => t.plate === v.plate && t.company === cfg.empresa && inPeriod(t.startedAt, period));
    const fp = i.fuel.filter((f) => f.plate === v.plate && f.company === cfg.empresa && inPeriod(f.at, period));
    const km = tp.filter((t) => t.valid).reduce((a, t) => a + t.km!, 0);
    const liters = fp.reduce((a, f) => a + (f.liters ?? 0), 0);
    const fuelCost = fp.reduce((a, f) => a + (f.total ?? 0), 0);
    const fk = fp.filter((f) => f.kml != null && f.kml > 0);
    const kml = fk.length ? fk.reduce((a, f) => a + f.kmSincePrev!, 0) / fk.reduce((a, f) => a + f.liters!, 0) : null;
    const ev = i.speed.filter((e) => e.plate === v.plate && inPeriod(e.startedAt, period) && e.vmax > cfg.speed);
    return {
      ...v, ...states.get(v.plate)!, trips: tp.length, km, liters, fuelCost, kml,
      fuelCostPerKm: km > 0 ? fuelCost / km : null, speedEvents: ev.length,
      maxSpeed: ev.length ? Math.max(...ev.map((e) => e.vmax)) : 0,
      maintenance: worstMaintenance(i.plan, v.plate),
      docs: i.docs.find((d) => d.plate === v.plate)?.status ?? null,
    };
  });
}

export function summarizeDrivers(i: FleetInputs, period: Period, today: string, cfg: FleetConfig): DriverSummary[] {
  return i.drivers.map((d) => {
    const tr = i.trips.filter((t) => t.driver === d.name && t.company === cfg.empresa && inPeriod(t.startedAt, period));
    const ev = i.speed.filter((e) => e.driver === d.name && inPeriod(e.startedAt, period) && e.vmax > cfg.speed);
    const cnh = deadlineStatus(d.cnhExpiry, today, cfg);
    return {
      ...d, cnhStatus: cnh.status, cnhDays: cnh.days, trips: tr.length,
      km: tr.filter((t) => t.valid).reduce((a, t) => a + t.km!, 0),
      speedEvents: ev.length, maxSpeed: ev.length ? Math.max(...ev.map((e) => e.vmax)) : 0,
      fuelings: i.fuel.filter((f) => f.driver === d.name && inPeriod(f.at, period)).length,
      checklists: i.checklists.filter((c) => c.driver === d.name && inPeriod(c.at, period)).length,
    };
  });
}

export function kpis(i: FleetInputs, vs: VehicleSummary[], period: Period, cfg: FleetConfig): Kpis {
  const fuel = i.fuel.filter((f) => f.company === cfg.empresa && inPeriod(f.at, period)).reduce((a, f) => a + (f.total ?? 0), 0);
  const otherCosts = i.costs.filter((c) => c.amount != null && inPeriodDate(c.date, period)).reduce((a, c) => a + c.amount!, 0);
  const km = vs.reduce((a, v) => a + v.km, 0);
  const total = fuel + otherCosts;
  return {
    trips: vs.reduce((a, v) => a + v.trips, 0), km, fuel, otherCosts, total,
    costPerKm: km > 0 ? total / km : null,
    speedEvents: i.speed.filter((e) => inPeriod(e.startedAt, period) && e.vmax > cfg.speed).length,
    openTrips: i.trips.filter((t) => t.company === cfg.empresa && t.open).length,
    checklists: i.checklists.filter((c) => inPeriod(c.at, period)).length,
    maintenanceAlerts: maintenanceAlerts(i.plan).length,
  };
}

/** Gasto com combustível por mês (YYYY-MM) e veículo, do primeiro abastecimento até o mês de `now`. */
export function monthlyFuel(i: FleetInputs, cfg: FleetConfig, now: number): { month: string; byVehicle: Record<string, number> }[] {
  const own = i.fuel.filter((f) => f.company === cfg.empresa);
  if (!own.length) return [];
  const first = localDate(Math.min(...own.map((f) => f.at))).slice(0, 7);
  const last = localDate(now).slice(0, 7);
  const out: { month: string; byVehicle: Record<string, number> }[] = [];
  for (let m = first; m <= last; m = addMonths(m + '-01', 1).slice(0, 7)) {
    const byVehicle: Record<string, number> = {};
    for (const v of i.vehicles) byVehicle[v.plate] = own.filter((f) => f.plate === v.plate && localDate(f.at).startsWith(m)).reduce((a, f) => a + (f.total ?? 0), 0);
    out.push({ month: m, byVehicle });
  }
  return out;
}

/* ---------------- qualidade dos dados ---------------- */

export function qualityReport(trips: AnalyzedTrip[], fuel: AnalyzedFueling[], cfg: FleetConfig): { label: string; count: number; level: 0 | 1 }[] {
  const tm = trips.filter((t) => t.company === cfg.empresa);
  const fm = fuel.filter((f) => f.company === cfg.empresa);
  const has = (arr: { problems: { code: string }[] }[], code: string) => arr.filter((x) => x.problems.some((p) => p.code === code)).length;
  return [
    { label: 'Viagens com algum problema', count: tm.filter((t) => t.problems.length).length, level: 0 },
    { label: 'KM inicial zerado', count: has(tm, 'KM_START_ZERO'), level: 1 },
    { label: 'KM fora da faixa do veículo', count: tm.filter((t) => t.problems.some((p) => p.code === 'KM_START_OUT_OF_RANGE' || p.code === 'KM_END_OUT_OF_RANGE')).length, level: 1 },
    { label: 'KM final menor que o inicial', count: has(tm, 'KM_END_LOWER'), level: 1 },
    { label: 'KM rodados acima do plausível', count: has(tm, 'KM_TOO_HIGH'), level: 1 },
    { label: 'Viagem não encerrada', count: has(tm, 'NOT_CLOSED'), level: 1 },
    { label: 'Duração acima do limite', count: has(tm, 'DURATION_TOO_LONG'), level: 1 },
    { label: 'Salto de odômetro entre viagens', count: has(tm, 'ODOMETER_JUMP'), level: 1 },
    { label: 'Viagens excluídas dos cálculos de km', count: tm.filter((t) => !t.valid).length, level: 0 },
    { label: 'Abastecimentos com algum problema', count: fm.filter((f) => f.problems.length).length, level: 0 },
    { label: 'Preço/L fora da faixa', count: has(fm, 'PRICE_OUT_OF_RANGE'), level: 1 },
    { label: `Consumo fora de ${cfg.kmlMin} a ${cfg.kmlMax} km/L`, count: has(fm, 'CONSUMPTION_OUT_OF_RANGE'), level: 1 },
    { label: 'Observação cita desconto', count: has(fm, 'NOTE_DISCOUNT'), level: 1 },
    { label: 'Posto fora da lista', count: has(fm, 'UNKNOWN_STATION'), level: 1 },
    { label: 'Motoristas com grafia não cadastrada', count: tm.filter((t) => !t.driver).length, level: 0 },
    { label: 'Placas não reconhecidas', count: tm.filter((t) => !t.plate).length, level: 0 },
  ];
}
