import { describe, expect, it } from 'vitest';
import { easter, nationalHolidays, nextBirthday, parseBirthday } from '../src/calendar.js';
import { daysBetween } from '../src/dates.js';

describe('feriados', () => {
  it('calcula a Páscoa', () => {
    expect(easter(2024)).toBe('2024-03-31');
    expect(easter(2025)).toBe('2025-04-20');
    expect(easter(2026)).toBe('2026-04-05');
    expect(easter(2027)).toBe('2027-03-28');
  });
  it('lista os feriados nacionais de 2026', () => {
    const h = nationalHolidays(2026);
    const byDate = Object.fromEntries(h.map((x) => [x.date, x]));
    expect(byDate['2026-02-16'].name).toBe('Carnaval');
    expect(byDate['2026-02-17'].optional).toBe(true);
    expect(byDate['2026-04-03'].name).toBe('Sexta-feira Santa');
    expect(byDate['2026-06-04'].name).toBe('Corpus Christi');
    expect(byDate['2026-11-20'].name).toBe('Consciência Negra');
    expect(h.filter((x) => !x.optional)).toHaveLength(10);
    expect(nationalHolidays(2023).some((x) => x.name === 'Consciência Negra')).toBe(false);
  });
});

describe('aniversários', () => {
  it('lê datas em vários formatos', () => {
    expect(parseBirthday('1988-12-01T00:00:00')).toEqual({ day: 1, month: 12, year: 1988 });
    expect(parseBirthday('05/11/....')).toEqual({ day: 5, month: 11, year: null });
    expect(parseBirthday('19/03/1991')).toEqual({ day: 19, month: 3, year: 1991 });
    expect(parseBirthday('29/02')).toEqual({ day: 29, month: 2, year: null });
    expect(parseBirthday('31/02/2000')).toBeNull();
    expect(parseBirthday('abc')).toBeNull();
  });
  it('acha o próximo aniversário', () => {
    expect(nextBirthday({ day: 1, month: 12 }, '2026-11-16')).toBe('2026-12-01');
    expect(nextBirthday({ day: 16, month: 11 }, '2026-11-16')).toBe('2026-11-16');
    expect(nextBirthday({ day: 19, month: 3 }, '2026-11-16')).toBe('2027-03-19');
    expect(nextBirthday({ day: 29, month: 2 }, '2026-11-16')).toBe('2027-02-28');
    expect(daysBetween('2026-11-16', '2026-12-01')).toBe(15);
  });
});
