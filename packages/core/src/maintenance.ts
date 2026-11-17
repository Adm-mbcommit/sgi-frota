/**
 * Agenda de manutenção: quando cada revisão deve acontecer (o que vier primeiro:
 * km, data ou a previsão pelo ritmo de uso) e agrupamento dos itens que vencem juntos
 * (ex.: troca de óleo + filtro + revisão geral no mesmo km/data).
 */
import { addDays } from './dates.js';

export type DueStatus = 'VENCIDO' | 'ATENCAO' | 'CONFIRMAR' | 'SEM_DADO' | 'OK';

/** Campos de um item do plano já calculados (PlanItemStatus do fleet.ts). */
export interface DueItem {
  id?: string; plate: string; item: string; status: DueStatus;
  nextKm: number | null; kmLeft: number | null; dueDate: string | null; daysLeft: number | null; forecastDays: number | null;
}

export interface DueGroup {
  plate: string; status: DueStatus; items: string[]; ids: string[];
  nextKm: number | null; kmLeft: number | null; dueDate: string | null; daysLeft: number | null;
  /** Data prevista pelo ritmo de uso para chegar ao km. */
  forecastDate: string | null;
  /** Data em que a revisão deve ser feita: a mais cedo entre a data limite e a previsão pelo km. */
  expectedDate: string | null;
  /** O que define a data esperada. */
  by: 'km' | 'data' | null;
}

const RANK: Record<DueStatus, number> = { VENCIDO: 0, ATENCAO: 1, CONFIRMAR: 2, OK: 3, SEM_DADO: 4 };

/** Data esperada da revisão: km já vencido = hoje; senão a mais cedo entre a data limite e a previsão pelo uso. */
export function expectedDue(it: DueItem, today: string): { forecastDate: string | null; expectedDate: string | null; by: 'km' | 'data' | null } {
  const forecastDate = it.kmLeft != null && it.kmLeft <= 0 ? today
    : it.forecastDays != null ? addDays(today, Math.ceil(it.forecastDays)) : null;
  if (forecastDate && (!it.dueDate || forecastDate <= it.dueDate)) return { forecastDate, expectedDate: forecastDate, by: 'km' };
  if (it.dueDate) return { forecastDate, expectedDate: it.dueDate, by: 'data' };
  return { forecastDate: null, expectedDate: null, by: null };
}

/** Agrupa os itens de mesmo veículo, situação, km e data; ordena do mais urgente ao menos urgente. */
export function groupDue(items: DueItem[], today: string): DueGroup[] {
  const map = new Map<string, DueGroup>();
  for (const it of items) {
    const key = [it.plate, it.status, it.nextKm, it.dueDate].join('|');
    const g = map.get(key);
    if (g) { g.items.push(it.item); if (it.id) g.ids.push(it.id); continue; }
    map.set(key, {
      plate: it.plate, status: it.status, items: [it.item], ids: it.id ? [it.id] : [],
      nextKm: it.nextKm, kmLeft: it.kmLeft, dueDate: it.dueDate, daysLeft: it.daysLeft, ...expectedDue(it, today),
    });
  }
  return [...map.values()].sort((a, b) => RANK[a.status] - RANK[b.status]
    || (a.expectedDate ?? '9999').localeCompare(b.expectedDate ?? '9999') || (a.kmLeft ?? 1e12) - (b.kmLeft ?? 1e12));
}

/** Viagem mínima para estimar o hodômetro numa data. */
export interface KmTrip { plate: string | null; startedAt: number; kmStart: number | null; kmEnd: number | null; valid: boolean; startValid: boolean }

/**
 * Km aproximado do veículo numa data (fim do dia, horário de Brasília), pelas viagens com km plausível:
 * o km final da última viagem até esse dia; sem viagem antes, o km inicial da primeira depois.
 */
export function kmOnDate(trips: KmTrip[], plate: string, date: string): number | null {
  const end = Date.parse(date + 'T23:59:59-03:00');
  const ok = trips.filter((t) => t.plate === plate && (t.valid || t.startValid)).sort((a, b) => a.startedAt - b.startedAt);
  const before = ok.filter((t) => t.startedAt <= end).pop();
  if (before) return before.valid && before.kmEnd != null ? before.kmEnd : before.kmStart;
  return ok.find((t) => t.startedAt > end)?.kmStart ?? null;
}

/** Nível do aviso por quilometragem: 'VENCIDO', ou o menor degrau atingido (ex.: 500, 1000, 1500); null se ainda longe. */
export type KmLevel = 'VENCIDO' | number | null;
export function kmAlertLevel(kmLeft: number | null, cfg: { kmAlert: number; kmAlert2: number; kmAlert3: number }): KmLevel {
  if (kmLeft == null) return null;
  if (kmLeft < 0) return 'VENCIDO';
  const steps = [cfg.kmAlert3, cfg.kmAlert2, cfg.kmAlert].filter((x) => x > 0).sort((a, b) => a - b);
  return steps.find((s) => kmLeft <= s) ?? null;
}
