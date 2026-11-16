/**
 * Calendário: feriados nacionais do Brasil e aniversários.
 * Datas de calendário como string AAAA-MM-DD (sem fuso).
 */
export interface Holiday { date: string; name: string; /** Ponto facultativo (não é feriado obrigatório). */ optional: boolean }

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const addDays = (date: string, n: number) => {
  const t = new Date(date + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function easter(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

/**
 * Feriados nacionais (Leis 662/1949, 6.802/1980, 14.759/2023) e os pontos facultativos
 * mais comuns (Carnaval e Corpus Christi). Feriados estaduais e municipais não entram.
 */
export function nationalHolidays(year: number): Holiday[] {
  const p = easter(year);
  const list: Holiday[] = [
    { date: iso(year, 1, 1), name: 'Confraternização Universal', optional: false },
    { date: addDays(p, -48), name: 'Carnaval', optional: true },
    { date: addDays(p, -47), name: 'Carnaval', optional: true },
    { date: addDays(p, -2), name: 'Sexta-feira Santa', optional: false },
    { date: iso(year, 4, 21), name: 'Tiradentes', optional: false },
    { date: iso(year, 5, 1), name: 'Dia do Trabalho', optional: false },
    { date: addDays(p, 60), name: 'Corpus Christi', optional: true },
    { date: iso(year, 9, 7), name: 'Independência do Brasil', optional: false },
    { date: iso(year, 10, 12), name: 'Nossa Senhora Aparecida', optional: false },
    { date: iso(year, 11, 2), name: 'Finados', optional: false },
    { date: iso(year, 11, 15), name: 'Proclamação da República', optional: false },
    ...(year >= 2024 ? [{ date: iso(year, 11, 20), name: 'Consciência Negra', optional: false }] : []),
    { date: iso(year, 12, 25), name: 'Natal', optional: false },
  ];
  return list.sort((x, y) => x.date.localeCompare(y.date));
}

export interface BirthdayDate { day: number; month: number; year: number | null }

const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number) => [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/**
 * Lê uma data de aniversário: '1988-12-01' (ou com hora), '01/12/1988', '05/11/....', '05/11'.
 * Ano ausente ou incompleto vira null.
 */
export function parseBirthday(v: unknown): BirthdayDate | null {
  if (v instanceof Date) v = v.toISOString();
  const s = String(v ?? '').trim();
  let day: number, month: number, year: number | null = null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { year = +m[1]; month = +m[2]; day = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\S*))?$/))) {
    day = +m[1]; month = +m[2];
    const y = m[3]?.match(/^\d{4}$/) ? +m[3] : m[3]?.match(/^\d{2}$/) ? 1900 + +m[3] + (+m[3] < 30 ? 100 : 0) : null;
    year = y;
  } else return null;
  if (month < 1 || month > 12 || day < 1 || day > daysIn(2024, month)) return null;
  if (year != null && (year < 1900 || year > 2100)) year = null;
  return { day, month, year };
}

/** Próxima data (a partir de hoje, inclusive) em que cai o aniversário. 29/02 vira 28/02 em ano não bissexto. */
export function nextBirthday(b: { day: number; month: number }, today: string): string {
  const y = +today.slice(0, 4);
  for (const yy of [y, y + 1]) {
    const d = Math.min(b.day, daysIn(yy, b.month));
    const date = iso(yy, b.month, d);
    if (date >= today) return date;
  }
  return iso(y + 1, b.month, Math.min(b.day, daysIn(y + 1, b.month)));
}
