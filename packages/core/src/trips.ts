import type { FleetConfig } from './config.js';
import type { Problem, TripInput, VehicleInput } from './types.js';
import { DAY_MS } from './dates.js';

export interface AnalyzedTrip extends TripInput {
  vehicleName: string | null;
  durationH: number | null;
  /** Km rodados (final − inicial), quando os dois existem. */
  km: number | null;
  /** Km inicial plausível para o veículo. */
  startValid: boolean;
  /** Viagem válida para os cálculos de km. */
  valid: boolean;
  /** Diferença entre o km inicial e o maior km final válido anterior do mesmo veículo. */
  jump: number | null;
  /** Fim efetivo (chegada ou saída + 24 h), usado para atribuir eventos de velocidade. */
  effectiveEnd: number;
  problems: Problem[];
}

export const TRIP_PROBLEMS = {
  OTHER_COMPANY: 'Outra empresa',
  UNKNOWN_PLATE: 'Placa desconhecida',
  KM_START_INVALID: 'KM inicial inválido',
  KM_START_ZERO: 'KM inicial zerado',
  KM_START_OUT_OF_RANGE: 'KM inicial fora da faixa do veículo',
  NOT_CLOSED: 'Viagem não encerrada',
  KM_END_INVALID: 'KM final inválido',
  KM_END_LOWER: 'KM final menor que o inicial',
  KM_TOO_HIGH: 'KM rodados acima do plausível',
  KM_END_OUT_OF_RANGE: 'KM final fora da faixa do veículo',
  DURATION_TOO_LONG: 'Duração acima do limite',
  ODOMETER_JUMP: 'Salto de odômetro',
} as const;
export type TripProblemCode = keyof typeof TRIP_PROBLEMS;

const p = (code: TripProblemCode, extra?: string): Problem => ({ code, label: TRIP_PROBLEMS[code] + (extra ?? '') });

/**
 * Valida as viagens em ordem cronológica. Regras idênticas ao artefato original:
 * - km inicial precisa estar a até `win` km do km de referência do veículo;
 * - viagem válida exige km final ≥ inicial, até `maxTrip` km rodados e km final também na faixa;
 * - salto de odômetro compara o km inicial com o maior km final válido anterior do veículo.
 */
export function analyzeTrips(trips: TripInput[], vehicles: VehicleInput[], cfg: FleetConfig): AnalyzedTrip[] {
  const byPlate = new Map(vehicles.map((v) => [v.plate, v]));
  const sorted = [...trips].sort((a, b) => a.startedAt - b.startedAt);
  const run = new Map<string, number>();
  return sorted.map((t) => {
    const v = t.plate ? byPlate.get(t.plate) : undefined;
    const ref = v?.refKm ?? null;
    const own = t.company === cfg.empresa;
    const P = t.kmStart, Q = t.kmEnd;
    const km = P != null && Q != null ? Q - P : null;
    const durationH = t.endedAt != null ? (t.endedAt - t.startedAt) / 3_600_000 : null;
    const startValid = own && P != null && ref != null && P > 0 && Math.abs(P - ref) <= cfg.win;
    const valid = startValid && Q != null && km != null && km >= 0 && km <= cfg.maxTrip && Math.abs(Q - ref!) <= cfg.win;
    const prev = t.plate ? run.get(t.plate) : undefined;
    const jump = valid && prev != null && prev > 0 ? P! - prev : null;
    if (valid && t.plate) run.set(t.plate, Math.max(prev ?? 0, Q!));

    const problems: Problem[] = [];
    if (!own) problems.push(p('OTHER_COMPANY'));
    if (!v) problems.push(p('UNKNOWN_PLATE'));
    if (P == null) problems.push(p('KM_START_INVALID'));
    else if (P === 0) problems.push(p('KM_START_ZERO'));
    else if (!startValid && own && v) problems.push(p('KM_START_OUT_OF_RANGE'));
    if (t.open) problems.push(p('NOT_CLOSED'));
    else if (Q == null) problems.push(p('KM_END_INVALID'));
    else if (km != null && km < 0) problems.push(p('KM_END_LOWER'));
    else {
      if (km != null && km > cfg.maxTrip) problems.push(p('KM_TOO_HIGH'));
      if (ref != null && Math.abs(Q - ref) > cfg.win) problems.push(p('KM_END_OUT_OF_RANGE'));
    }
    if (durationH != null && durationH > cfg.tripH) problems.push(p('DURATION_TOO_LONG'));
    if (jump != null && Math.abs(jump) > cfg.jump) problems.push(p('ODOMETER_JUMP', ` (${Math.round(jump)} km)`));

    return {
      ...t, vehicleName: v?.name ?? null, durationH, km, startValid, valid, jump,
      effectiveEnd: t.endedAt ?? t.startedAt + DAY_MS, problems,
    };
  });
}
