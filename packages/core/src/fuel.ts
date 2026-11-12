import type { FleetConfig } from './config.js';
import type { FuelingInput, Problem, VehicleInput } from './types.js';

export interface AnalyzedFueling extends FuelingInput {
  vehicleName: string | null;
  pricePerLiter: number | null;
  /** Abastecimento válido para consumo e série de km. */
  valid: boolean;
  /** Km desde o abastecimento válido anterior do mesmo veículo. */
  kmSincePrev: number | null;
  kml: number | null;
  problems: Problem[];
}

export const FUEL_PROBLEMS = {
  OTHER_COMPANY: 'Outra empresa',
  UNKNOWN_PLATE: 'Placa desconhecida',
  LITERS_INVALID: 'Litros inválido',
  LITERS_TOO_HIGH: 'Litros acima do plausível',
  AMOUNT_INVALID: 'Valor inválido',
  PRICE_OUT_OF_RANGE: 'Preço/L fora da faixa (valor líquido de desconto ou digitação)',
  KM_OUT_OF_RANGE: 'KM fora da faixa do veículo',
  KM_INVALID: 'KM inválido',
  CONSUMPTION_OUT_OF_RANGE: 'Consumo fora da faixa plausível',
  NOTE_DISCOUNT: 'Observação cita desconto',
  UNKNOWN_STATION: 'Posto fora da lista',
} as const;
export type FuelProblemCode = keyof typeof FUEL_PROBLEMS;
const p = (code: FuelProblemCode): Problem => ({ code, label: FUEL_PROBLEMS[code] });

/** Valida abastecimentos e calcula preço/L e consumo entre abastecimentos válidos consecutivos. */
export function analyzeFuel(rows: FuelingInput[], vehicles: VehicleInput[], cfg: FleetConfig): AnalyzedFueling[] {
  const byPlate = new Map(vehicles.map((v) => [v.plate, v]));
  const sorted = [...rows].sort((a, b) => a.at - b.at);
  const run = new Map<string, number>();
  return sorted.map((f) => {
    const v = f.plate ? byPlate.get(f.plate) : undefined;
    const ref = v?.refKm ?? null;
    const own = f.company === cfg.empresa;
    const L = f.liters, V = f.total, T = f.km;
    const ppl = L != null && L > 0 && V != null ? V / L : null;
    const valid = own && !!v && T != null && L != null && ppl != null && ref != null &&
      L > 0 && L <= cfg.maxL && ppl >= cfg.pMin && ppl <= cfg.pMax && Math.abs(T - ref) <= cfg.win;
    const prev = valid && f.plate ? run.get(f.plate) : undefined;
    const kmSincePrev = valid && prev != null && prev > 0 ? T! - prev : null;
    if (valid && f.plate) run.set(f.plate, Math.max(run.get(f.plate) ?? 0, T!));
    const kml = kmSincePrev != null && kmSincePrev > 0 && L! > 0 && f.fullTank !== false ? kmSincePrev / L! : null;

    const problems: Problem[] = [];
    if (!own) problems.push(p('OTHER_COMPANY'));
    if (!v) problems.push(p('UNKNOWN_PLATE'));
    if (L == null) problems.push(p('LITERS_INVALID'));
    else if (L > cfg.maxL) problems.push(p('LITERS_TOO_HIGH'));
    if (V == null) problems.push(p('AMOUNT_INVALID'));
    if (ppl != null && (ppl < cfg.pMin || ppl > cfg.pMax)) problems.push(p('PRICE_OUT_OF_RANGE'));
    if (T != null && ref != null) { if (Math.abs(T - ref) > cfg.win) problems.push(p('KM_OUT_OF_RANGE')); }
    else problems.push(p('KM_INVALID'));
    if (kml != null && (kml < cfg.kmlMin || kml > cfg.kmlMax)) problems.push(p('CONSUMPTION_OUT_OF_RANGE'));
    if (/desconto/i.test(f.notes ?? '')) problems.push(p('NOTE_DISCOUNT'));
    if (!f.station || !cfg.postos.includes(f.station)) problems.push(p('UNKNOWN_STATION'));

    return { ...f, vehicleName: v?.name ?? null, pricePerLiter: ppl, valid, kmSincePrev, kml, problems };
  });
}
