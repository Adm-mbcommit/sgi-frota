import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CONFIG, analyzeFleet, analyzeTrips, fromLegacy, makeResolver, parseInstant, parseKm, addMonths, localDate,
  type LegacySnapshot,
} from '../src/index.js';

const snap = JSON.parse(readFileSync(fileURLToPath(new URL('../../../legacy/snapshot.json', import.meta.url)), 'utf8')) as LegacySnapshot;
const data = fromLegacy(snap);
const NOW = Date.parse('2026-11-11T10:49:43-03:00');
const A = analyzeFleet(data, DEFAULT_CONFIG, { from: '2026-09-01', to: '2026-11-11' }, NOW);

describe('normalização', () => {
  it('interpreta km digitado com texto', () => {
    expect(parseKm('34.789km')).toBe(34789);
    expect(parseKm('16.628 km')).toBe(16628);
    expect(parseKm(139535)).toBe(139535);
    expect(parseKm('')).toBeNull();
  });
  it('trata horário sem fuso como hora de São Paulo', () => {
    expect(parseInstant('2026-07-13T08:26:43')).toBe(Date.parse('2026-07-13T11:26:43Z'));
    expect(parseInstant('13/07/2026 08:26')).toBe(Date.parse('2026-07-13T11:26:00Z'));
    expect(localDate(Date.parse('2026-07-14T02:00:00Z'))).toBe('2026-07-13');
  });
  it('resolve apelidos de placa e grafias de motorista', () => {
    const r = makeResolver([{ plate: 'QXI9C75', aliases: ['QXI9675'] }], [{ name: 'Alvino', aliases: ['Alvino Rusche Junior'] }]);
    expect(r.plate('QXI - 9675')).toBe('QXI9C75');
    expect(r.plate('Saveiro QXI9C75')).toBe('QXI9C75');
    expect(r.plate('ABC1234')).toBeNull();
    expect(r.driver('alvino rusche  junior')).toBe('Alvino');
    expect(r.driver('Fulano')).toBeNull();
  });
  it('soma meses em datas de calendário', () => {
    expect(addMonths('2026-06-30', 12)).toBe('2027-06-30');
  });
});

describe('regras de viagem', () => {
  const veh = [{ plate: 'AAA', name: 'A', refKm: 1000, status: 'ATIVO' as const }];
  const base = { company: 'Matias Brasil', plate: 'AAA', driver: 'X', open: false };
  it('aceita viagem normal e detecta salto de odômetro', () => {
    const t = analyzeTrips([
      { ...base, id: '1', startedAt: 1, endedAt: 2, kmStart: 1000, kmEnd: 1050 },
      { ...base, id: '2', startedAt: 3, endedAt: 4, kmStart: 1080, kmEnd: 1100 },
    ], veh, DEFAULT_CONFIG);
    expect(t[0].valid).toBe(true);
    expect(t[0].km).toBe(50);
    expect(t[1].jump).toBe(30);
    expect(t[1].problems.map((p) => p.code)).toContain('ODOMETER_JUMP');
  });
  it('rejeita km zerado, km final menor e viagem aberta', () => {
    const t = analyzeTrips([
      { ...base, id: '1', startedAt: 1, endedAt: 2, kmStart: 0, kmEnd: 1050 },
      { ...base, id: '2', startedAt: 3, endedAt: 4, kmStart: 1100, kmEnd: 1090 },
      { ...base, id: '3', startedAt: 5, endedAt: null, kmStart: 1100, kmEnd: null, open: true },
    ], veh, DEFAULT_CONFIG);
    expect(t.map((x) => x.valid)).toEqual([false, false, false]);
    expect(t[0].problems[0].code).toBe('KM_START_ZERO');
    expect(t[1].problems[0].code).toBe('KM_END_LOWER');
    expect(t[2].problems[0].code).toBe('NOT_CLOSED');
  });
});

describe('paridade com o snapshot do artefato (11/11/2026)', () => {
  it('carrega todos os registros', () => {
    expect(data.trips.length).toBe(snap.trips.length);
    expect(data.fuel.length).toBe(snap.fuel.length);
    expect(data.plan.length).toBe(44);
    expect(A.vehicles).toHaveLength(4);
  });
  it('todas as placas do snapshot são reconhecidas', () => {
    expect(A.trips.filter((t) => !t.plate)).toHaveLength(0);
  });
  it('produz km atual coerente com o km de referência de cada veículo', () => {
    for (const v of A.vehicles) expect(Math.abs(v.currentKm - v.refKm)).toBeLessThanOrEqual(DEFAULT_CONFIG.win);
  });
  it('gera relatório de qualidade e alertas', () => {
    expect(A.quality[0].count).toBeGreaterThan(0);
    expect(A.alerts.every((a) => ['VENCIDO', 'ATENCAO', 'CONFIRMAR'].includes(a.status))).toBe(true);
    expect(A.kpis.km).toBeGreaterThan(0);
    expect(A.kpis.costPerKm).toBeGreaterThan(0);
  });
});
