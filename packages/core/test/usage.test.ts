import { describe, expect, it } from 'vitest';
import { analyzeUsage, isOffHours, placeLabel, USAGE_BASE } from '../src/index.js';

const at = (s: string) => Date.parse(s + '-03:00');
const O = { workStart: 6.5, workEnd: 19.5, base: USAGE_BASE };
const BASE = 'Rua Brasília, 201 - São Cristóvão, Lages - SC, 88509-000';
const ev = (start: string, h: number, km: number, vmax: number, from: string, to: string) => ({ plate: 'AAA1A11', startedAt: at(start), durationH: h, distanceKm: km, vmax, from, to });

describe('uso dos veículos (rastreador)', () => {
  it('fora do expediente: antes das 06h30, a partir das 19h30 e fim de semana', () => {
    expect(isOffHours(at('2026-11-10T06:29:00'), O)).toBe(true);
    expect(isOffHours(at('2026-11-10T06:30:00'), O)).toBe(false);
    expect(isOffHours(at('2026-11-10T19:30:00'), O)).toBe(true);
    expect(isOffHours(at('2026-11-14T10:00:00'), O)).toBe(true); // sábado
  });

  it('paradas por local, pernoite fora da base e velocidade', () => {
    const U = analyzeUsage([
      ev('2026-11-10T07:00:00', 0.5, 10, 80, BASE, 'Rua Israel, 50 - Vila Mariza, Lages - SC'),
      ev('2026-11-10T11:00:00', 0.5, 10, 125, 'Rua Israel, 50 - Vila Mariza, Lages - SC', BASE),
      ev('2026-11-10T20:00:00', 0.25, 5, 60, BASE, 'Av. Juscelino Kubitschek, 10 - Maria Luíza, Lages - SC'),
      ev('2026-11-11T07:00:00', 0.25, 5, 60, 'Av. Juscelino Kubitschek, 10 - Maria Luíza, Lages - SC', BASE),
    ], { from: '2026-11-10', to: '2026-11-11' }, 100, O);
    const v = U.vehicles[0];
    expect(v.trips).toBe(4); expect(v.km).toBe(30); expect(v.offTrips).toBe(1); expect(v.high).toBe(1); expect(v.over).toBe(1);
    const israel = U.places.AAA1A11.find((p) => p.place.startsWith('Rua Israel'))!;
    expect(israel.hours).toBeCloseTo(3.5); expect(israel.atBase).toBe(false);
    const base = U.places.AAA1A11.find((p) => p.atBase)!;
    expect(base.hours).toBeCloseTo(8.5); expect(base.inHours).toBeCloseTo(8)  ; expect(base.offHours).toBeCloseTo(0.5);
    expect(U.longStops).toHaveLength(1);
    expect(U.overnights).toEqual([expect.objectContaining({ nights: 1, first: '2026-11-10', place: 'Av. Juscelino Kubitschek, 10 - Maria Luíza, Lages - SC' })]);
    expect(v.idleWorkdays).toBe(0);
  });

  it('endereço sem CEP e país', () => {
    expect(placeLabel('Rua X, 1 - Centro, Lages - SC, 88501-000, Brasil')).toBe('Rua X, 1 - Centro, Lages - SC');
    expect(placeLabel('Rua Brasilia, 201, São Cristóvão, Lages, SC, Brasil, 88509-200')).toBe('Rua Brasilia, 201, São Cristóvão, Lages, SC');
  });
});
