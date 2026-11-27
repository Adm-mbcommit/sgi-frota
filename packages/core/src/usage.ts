/**
 * Uso dos veículos pelo rastreador (relatório "Períodos de utilização" do Chronos).
 * Cada linha do relatório é um período de motor ligado (uma "viagem" do rastreador).
 * A partir delas calculamos: viagens fora do expediente, velocidade, paradas por local
 * (tempo entre desligar e religar no mesmo dia) e pernoites fora da base.
 */
import { addDays, dayNumber, localDate, type Period } from './dates.js';

export interface UsageEvent {
  plate: string | null;
  startedAt: number;
  durationH: number | null;
  vmax: number;
  distanceKm?: number | null;
  from?: string | null;
  to?: string | null;
}

export interface UsageOptions {
  /** Início do expediente, em horas (6,5 = 06h30). */
  workStart: number;
  /** Fim do expediente, em horas (19,5 = 19h30). */
  workEnd: number;
  /** Trechos de endereço que identificam a base (comparação sem acento e sem maiúsculas). */
  base: string[];
  /** Quantos locais de parada mostrar por veículo. */
  topPlaces?: number;
  /** Parada longa fora da base, em horas. */
  longStopH?: number;
}

/** O rastreador às vezes grava a base sem o número: "Rua Brasília, São Cristóvão, Lages…". */
export const USAGE_BASE = ['brasilia, 201', 'rua brasilia, sao cristovao'];
export const SPEED_HIGH = 120;
export const SPEED_SEVERE = 140;

const H = 3_600_000;
/** Hora local de São Paulo (UTC−3, sem horário de verão). */
const local = (t: number) => new Date(t - 3 * H);
const minutesOfDay = (t: number) => { const d = local(t); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const isWeekend = (t: number) => { const w = local(t).getUTCDay(); return w === 0 || w === 6; };
const isWeekendDate = (iso: string) => { const w = new Date(dayNumber(iso) * 86_400_000).getUTCDay(); return w === 0 || w === 6; };

export const normAddress = (s: string | null | undefined) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Endereço para exibição e agrupamento: sem CEP, país e espaços repetidos. */
export function placeLabel(s: string | null | undefined): string {
  const t = String(s ?? '').replace(/\b\d{5}-?\d{3}\b/g, '').replace(/[\s,-]+$/, '');
  return t.replace(/,?\s*(Brasil|Brazil)\s*$/i, '').replace(/,\s*(Brasil|Brazil)\s*,/gi, ',')
    .replace(/\s+/g, ' ').replace(/[\s,-]+$/, '').trim() || 'Endereço não informado';
}

export function isOffHours(t: number, o: UsageOptions): boolean {
  if (isWeekend(t)) return true;
  const m = minutesOfDay(t);
  return m < o.workStart * 60 || m >= o.workEnd * 60;
}

/** Horas de [a, b] (mesmo dia local) dentro e fora do expediente. */
function splitHours(a: number, b: number, o: UsageOptions) {
  const total = Math.max(0, b - a) / H;
  if (isWeekend(a)) return { inH: 0, offH: total };
  const day0 = dayNumber(localDate(a)) * 86_400_000 + 3 * H; // 00h00 local
  const ws = day0 + o.workStart * H, we = day0 + o.workEnd * H;
  const inH = Math.max(0, Math.min(b, we) - Math.max(a, ws)) / H;
  return { inH, offH: total - inH };
}

export interface UsageTrip { plate: string; startedAt: number; endedAt: number; durationH: number; km: number | null; vmax: number; from: string | null; to: string | null; offHours: boolean }
export interface UsagePlace { place: string; atBase: boolean; hours: number; inHours: number; offHours: number; stops: number; longest: { at: number; hours: number } }
export interface UsageOvernight { plate: string; place: string; nights: number; first: string; last: string; dates: string[] }
export interface UsageStop { plate: string; place: string; from: number; to: number; hours: number }
export interface UsageVehicle {
  plate: string; trips: number; km: number; hours: number; offTrips: number; offKm: number; offHoursDriving: number;
  over: number; high: number; severe: number; maxSpeed: number; maxSpeedAt: number | null;
  idleWorkdays: number; stopHours: number; baseStopHours: number; nightsAway: number;
}

export interface UsageResult {
  period: Period;
  options: { workStart: number; workEnd: number; speed: number; high: number; severe: number; longStopH: number };
  totals: Omit<UsageVehicle, 'plate' | 'idleWorkdays' | 'maxSpeedAt'> & { withKm: number };
  vehicles: UsageVehicle[];
  monthly: { month: string; byVehicle: Record<string, { km: number; hours: number; offTrips: number; high: number }> }[];
  daily: { date: string; km: number; offKm: number; trips: number }[];
  places: Record<string, UsagePlace[]>;
  overnights: UsageOvernight[];
  longStops: UsageStop[];
  flagged: (UsageTrip & { reasons: string[] })[];
}

/**
 * Analisa o uso no período. `speed` é o limite configurado (Parâmetros); também contamos
 * acima de 120 e de 140 km/h. Pernoite: última viagem de um dia e primeira do dia seguinte
 * (o local é o endereço final da última viagem). Parada: intervalo entre viagens no mesmo dia.
 */
export function analyzeUsage(events: UsageEvent[], period: Period, speed: number, o: UsageOptions): UsageResult {
  const top = o.topPlaces ?? 8, longStopH = o.longStopH ?? 3;
  const base = o.base.map(normAddress).filter(Boolean);
  const atBase = (a: string | null | undefined) => { const n = normAddress(a); return !!n && base.some((b) => n.includes(b)); };
  const inP = (t: number) => { const d = localDate(t); return d >= period.from && d <= period.to; };

  const byPlate = new Map<string, UsageTrip[]>();
  for (const e of events) {
    if (!e.plate) continue;
    const dur = e.durationH ?? 0;
    const t: UsageTrip = { plate: e.plate, startedAt: e.startedAt, endedAt: e.startedAt + dur * H, durationH: dur, km: e.distanceKm ?? null,
      vmax: e.vmax, from: e.from ?? null, to: e.to ?? null, offHours: isOffHours(e.startedAt, o) };
    (byPlate.get(e.plate) ?? byPlate.set(e.plate, []).get(e.plate)!).push(t);
  }

  const vehicles: UsageVehicle[] = []; const places: Record<string, UsagePlace[]> = {};
  const overnights: UsageOvernight[] = []; const longStops: UsageStop[] = []; const flagged: UsageResult['flagged'] = [];
  const monthly = new Map<string, Record<string, { km: number; hours: number; offTrips: number; high: number }>>();
  const daily = new Map<string, { km: number; offKm: number; trips: number }>();
  for (let d = period.from; d <= period.to; d = addDays(d, 1)) daily.set(d, { km: 0, offKm: 0, trips: 0 });

  for (const [plate, all] of [...byPlate].sort((a, b) => a[0].localeCompare(b[0]))) {
    all.sort((a, b) => a.startedAt - b.startedAt);
    const v: UsageVehicle = { plate, trips: 0, km: 0, hours: 0, offTrips: 0, offKm: 0, offHoursDriving: 0, over: 0, high: 0, severe: 0,
      maxSpeed: 0, maxSpeedAt: null, idleWorkdays: 0, stopHours: 0, baseStopHours: 0, nightsAway: 0 };
    const usedDays = new Set<string>(); const pl = new Map<string, UsagePlace>(); const nights = new Map<string, string[]>();
    all.forEach((t, i) => {
      if (!inP(t.startedAt)) return;
      const day = localDate(t.startedAt); usedDays.add(day);
      v.trips++; v.hours += t.durationH; v.km += t.km ?? 0;
      if (t.vmax > v.maxSpeed) { v.maxSpeed = t.vmax; v.maxSpeedAt = t.startedAt; }
      const reasons: string[] = [];
      if (t.vmax > speed) v.over++;
      if (t.vmax > SPEED_HIGH) { v.high++; reasons.push(`Acima de ${SPEED_HIGH} km/h`); }
      if (t.vmax > SPEED_SEVERE) v.severe++;
      if (t.offHours) { v.offTrips++; v.offKm += t.km ?? 0; v.offHoursDriving += t.durationH; reasons.push(isWeekend(t.startedAt) ? 'Fim de semana' : 'Fora do horário'); }
      if (reasons.length) flagged.push({ ...t, reasons });
      const dd = daily.get(day); if (dd) { dd.km += t.km ?? 0; dd.trips++; if (t.offHours) dd.offKm += t.km ?? 0; }
      const m = day.slice(0, 7); const mm = monthly.get(m) ?? monthly.set(m, {}).get(m)!;
      const mv = mm[plate] ?? (mm[plate] = { km: 0, hours: 0, offTrips: 0, high: 0 });
      mv.km += t.km ?? 0; mv.hours += t.durationH; if (t.offHours) mv.offTrips++; if (t.vmax > SPEED_HIGH) mv.high++;

      const next = all[i + 1]; if (!next) return;
      const place = placeLabel(t.to); const nextDay = localDate(next.startedAt);
      if (nextDay === day) {
        const hours = Math.max(0, next.startedAt - t.endedAt) / H; if (hours <= 0) return;
        const { inH, offH } = splitHours(t.endedAt, next.startedAt, o);
        const p = pl.get(place) ?? pl.set(place, { place, atBase: atBase(t.to), hours: 0, inHours: 0, offHours: 0, stops: 0, longest: { at: t.endedAt, hours: 0 } }).get(place)!;
        p.hours += hours; p.inHours += inH; p.offHours += offH; p.stops++;
        if (hours > p.longest.hours) p.longest = { at: t.endedAt, hours };
        v.stopHours += hours; if (p.atBase) v.baseStopHours += hours;
        if (!p.atBase && hours >= longStopH) longStops.push({ plate, place, from: t.endedAt, to: next.startedAt, hours });
      } else if (!atBase(t.to)) {
        // uma noite por dia de calendário entre o fim desta viagem e o início da próxima
        const n = Math.max(1, dayNumber(nextDay) - dayNumber(day));
        const list = nights.get(place) ?? nights.set(place, []).get(place)!;
        for (let k = 0; k < n; k++) { const d = addDays(day, k); if (d <= period.to) list.push(d); }
      }
    });
    for (let d = period.from; d <= period.to; d = addDays(d, 1)) if (!isWeekendDate(d) && !usedDays.has(d)) v.idleWorkdays++;
    for (const [place, dates] of nights) if (dates.length) {
      v.nightsAway += dates.length;
      overnights.push({ plate, place, nights: dates.length, first: dates[0], last: dates[dates.length - 1], dates });
    }
    places[plate] = [...pl.values()].sort((a, b) => b.hours - a.hours).slice(0, top);
    vehicles.push(v);
  }

  const sum = (k: keyof UsageVehicle) => vehicles.reduce((a, v) => a + (v[k] as number), 0);
  const withKm = [...byPlate.values()].flat().filter((t) => inP(t.startedAt) && t.km != null).length;
  return {
    period,
    options: { workStart: o.workStart, workEnd: o.workEnd, speed, high: SPEED_HIGH, severe: SPEED_SEVERE, longStopH },
    totals: { trips: sum('trips'), km: sum('km'), hours: sum('hours'), offTrips: sum('offTrips'), offKm: sum('offKm'), offHoursDriving: sum('offHoursDriving'),
      over: sum('over'), high: sum('high'), severe: sum('severe'), maxSpeed: Math.max(0, ...vehicles.map((v) => v.maxSpeed)),
      stopHours: sum('stopHours'), baseStopHours: sum('baseStopHours'), nightsAway: sum('nightsAway'), withKm },
    vehicles,
    monthly: [...monthly].sort((a, b) => a[0].localeCompare(b[0])).map(([month, byVehicle]) => ({ month, byVehicle })),
    daily: [...daily].map(([date, d]) => ({ date, ...d })),
    places,
    overnights: overnights.sort((a, b) => b.nights - a.nights),
    longStops: longStops.sort((a, b) => b.hours - a.hours),
    flagged: flagged.sort((a, b) => b.startedAt - a.startedAt),
  };
}
