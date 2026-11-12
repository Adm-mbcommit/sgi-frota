/**
 * Datas: instantes são guardados em UTC (epoch ms). Datas de calendário
 * (vencimentos, data de serviço) são strings 'YYYY-MM-DD'. A operação é em
 * America/Sao_Paulo; "hoje" e os filtros de período usam o calendário local.
 */
export const DAY_MS = 86_400_000;
export const TZ = 'America/Sao_Paulo';

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Data de calendário local (São Paulo) de um instante. */
export function localDate(instant: number): string {
  return fmt.format(new Date(instant));
}

/** Converte 'YYYY-MM-DD' em um número de dia (dias desde 1970-01-01), para contas de diferença. */
export function dayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return dayNumber(toIso) - dayNumber(fromIso);
}

export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, d));
  return t.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  return new Date((dayNumber(isoDate) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** Período fechado [from, to] em datas locais. */
export interface Period { from: string; to: string }

export function inPeriod(instant: number | null | undefined, p: Period): boolean {
  if (instant == null) return false;
  const d = localDate(instant);
  return d >= p.from && d <= p.to;
}

export function inPeriodDate(isoDate: string | null | undefined, p: Period): boolean {
  if (!isoDate) return false;
  const d = isoDate.slice(0, 10);
  return d >= p.from && d <= p.to;
}
