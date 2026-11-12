/**
 * Conversão do formato do artefato original (SGI Frota Matias, snapshot de
 * 11/11/2026) para as entradas tipadas. Usado pelo seed do banco e pelos testes
 * de paridade. As colunas seguem as abas da planilha do Comando de Bordo.
 */
import type { FleetData } from './analyze.js';
import { makeResolver, parseDate, parseInstant, parseKm, parseNum } from './normalize.js';

export const LEGACY_VEHICLES = [
  { plate: 'QXI9C75', name: 'SAVEIRO - 75', model: 'Saveiro', refKm: 146000, status: 'ATIVO' as const, aliases: ['QXI9675', 'SAVEIRO75', 'SAVEIROQXI9C75'] },
  { plate: 'TPR0F55', name: 'SAVEIRO - 55', model: 'Saveiro', refKm: 45000, status: 'ATIVO' as const, aliases: ['TRP0F55', 'SAVEIRO55', 'SAVEIROTPR0F55'] },
  { plate: 'TPX8A21', name: 'SAVEIRO - 21', model: 'Saveiro', refKm: 18500, status: 'ATIVO' as const, aliases: ['SAVEIRO21', 'SAVEIR021', 'SAVEIROTPX8A21'] },
  { plate: 'MFS7D92', name: 'UNO', model: 'Uno', refKm: 228000, status: 'ATIVO' as const, aliases: ['UNO', 'UNOMFS7D92'] },
];

export const LEGACY_DRIVER_ALIASES: Record<string, string[]> = {
  'João Vitor': ['joao vitor'],
  Enzo: ['enzo manfredi'],
  Alvino: ['alvino rusche junior', 'alvino rusche júnior'],
  Kayo: [], Efraim: [], Kleberson: [], Viviane: [],
  Leonardo: ['leonardo duarte'],
};

type Row = unknown[];
export interface LegacySnapshot {
  asof: string;
  trips: Row[]; fuel: Row[]; check: Row[]; chronos: Row[];
  plan: Row[]; docs: Row[]; costs: Row[]; todo: Row[]; drivers: string[];
}

const s = (v: unknown) => (v == null || v === '' ? null : String(v).trim());

export function legacyResolver(drivers: string[]) {
  return makeResolver(
    LEGACY_VEHICLES.map((v) => ({ plate: v.plate, aliases: v.aliases })),
    drivers.map((n) => ({ name: n, aliases: LEGACY_DRIVER_ALIASES[n] ?? [] })),
  );
}

export function fromLegacy(snap: LegacySnapshot): FleetData & { tasks: { title: string; status: string; description: string }[] } {
  const R = legacyResolver(snap.drivers);
  return {
    vehicles: LEGACY_VEHICLES.map(({ plate, name, refKm, status }) => ({ plate, name, refKm, status })),
    trips: snap.trips.map((r, i) => ({
      id: 'trip-' + i, company: String(r[1] ?? ''), plate: R.plate(r[3]), driver: R.driver(r[4]), driverRaw: s(r[4]),
      startedAt: parseInstant(r[0])!, endedAt: parseInstant(r[7]), kmStart: parseKm(r[6]), kmEnd: parseKm(r[9]),
      open: r[9] == null || r[9] === '', status: s(r[11]),
    })).filter((t) => t.startedAt != null),
    fuel: snap.fuel.map((r, i) => ({
      id: 'fuel-' + i, company: String(r[1] ?? ''), plate: R.plate(r[3]), driver: R.driver(r[4]), at: parseInstant(r[0])!,
      km: parseKm(r[5]), liters: parseNum(r[6]), total: parseNum(r[7]), station: s(r[9]),
      fullTank: r[14] === 'Não' ? false : r[14] === 'Sim' ? true : null, notes: s(r[15]),
    })).filter((f) => f.at != null),
    speed: snap.chronos.map((e, i) => ({
      id: 'spd-' + i, plate: R.plate(e[0]), startedAt: parseInstant(e[1])!, durationH: parseNum(e[2]),
      vmax: parseNum(e[3])!, vavg: parseNum(e[4]), from: s(e[5]), to: s(e[6]),
    })).filter((e) => e.startedAt != null && e.vmax != null),
    plan: snap.plan.map((b, i) => ({
      id: 'plan-' + i, plate: String(b[0]), item: String(b[1]), intervalKm: parseNum(b[2]), lastKm: parseNum(b[3]),
      lastDate: parseDate(b[4]), intervalMonths: parseNum(b[5]), needsCheck: b[6] === 'Sim', source: s(b[7]),
    })),
    docs: snap.docs.map((d) => ({
      plate: String(d[0]), crlv: parseDate(d[1]), ipva: parseDate(d[2]), licensing: parseDate(d[3]), insurance: parseDate(d[4]),
      confirmed: d[5] === 'Conferido',
    })),
    drivers: snap.drivers.map((n) => ({ name: n, cnhExpiry: null })),
    costs: snap.costs.map((c, i) => ({
      id: 'cost-' + i, date: parseDate(c[0])!, plate: s(c[1]), category: String(c[2] ?? 'Outros'), description: String(c[3] ?? '').trim(),
      supplier: s(c[4]), amount: parseNum(c[5]), notes: s(c[6]),
    })),
    checklists: snap.check.map((r) => ({ at: parseInstant(r[0])!, driver: R.driver(r[4]) })).filter((c) => c.at != null),
    tasks: snap.todo.map((t) => ({ title: String(t[0]), status: String(t[1]), description: String(t[2] ?? '') })),
  };
}
