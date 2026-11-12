/**
 * Paridade com o artefato original: extrai o compute() do HTML legado, roda sobre o mesmo
 * snapshot e compara com o @sgi/core. Diferenças conhecidas estão em docs/REGRAS-DE-NEGOCIO.md.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, analyzeFleet, fromLegacy, type LegacySnapshot } from '../src/index.js';

const root = (p: string) => fileURLToPath(new URL('../../../' + p, import.meta.url));
const html = readFileSync(root('legacy/sgi-frota-artefato-original.html'), 'utf8');
const snap = JSON.parse(readFileSync(root('legacy/snapshot.json'), 'utf8')) as LegacySnapshot;
const NOW = Date.parse('2026-11-11T10:49:43-03:00');
const PERIOD = { from: '2026-09-01', to: '2026-11-11' };

function runOriginal() {
  const start = html.indexOf('const DRIVE_FILE');
  const end = html.indexOf('function recompute()');
  const code = html.slice(start, end);
  const real = Date.now; Date.now = () => NOW;
  try {
    // eslint-disable-next-line no-new-func
    return new Function('SNAP', 'document', code + '\nSNAP.chronosThrough=0; return compute();')(structuredClone(snap), { querySelector: () => null });
  } finally { Date.now = real; }
}

describe('paridade com o artefato original', () => {
  const O = runOriginal();
  const A = analyzeFleet(fromLegacy(snap), DEFAULT_CONFIG, PERIOD, NOW);

  it('KPIs do período', () => {
    expect(A.kpis.km).toBe(O.kpi.km);
    expect(A.kpis.trips).toBe(O.kpi.viagens);
    expect(A.kpis.fuel).toBeCloseTo(O.kpi.comb, 2);
    expect(A.kpis.otherCosts).toBeCloseTo(O.kpi.outros, 2);
    expect(A.kpis.speedEvents).toBe(O.kpi.occ);
    expect(A.alerts.length).toBe(O.alerts.length);
  });

  it('indicadores por veículo', () => {
    for (const v of O.vehicles) {
      const n = A.vehicles.find((x) => x.plate === v.p)!;
      expect(n.currentKm).toBe(v.kmAtual);
      expect(n.km).toBe(v.km);
      expect(n.fuelCost).toBeCloseTo(v.gasto, 2);
      expect(n.kmPerDay).toBeCloseTo(v.kmDia, 6);
      expect(n.kml ?? null).toBe(v.kml ?? null);
      expect(n.maintenance.replace('_', ' ')).toBe(v.manut);
    }
  });

  it('status de cada item do plano e dos documentos', () => {
    const map: Record<string, string> = { ATENCAO: 'ATENÇÃO', SEM_DADO: 'SEM DADO' };
    expect(A.plan.map((p) => map[p.status] ?? p.status)).toEqual(O.plan.map((p: { st: string }) => p.st));
    expect(A.docs.map((d) => d.days)).toEqual(O.docs.map((d: { dias: number }) => d.dias));
  });

  it('verificação dos dados (exceto o defeito corrigido de "desconto")', () => {
    O.review.forEach((r: [string, number], i: number) => {
      if (/desconto/.test(r[0])) expect(A.quality[i].count).toBe(3); // original contava 4 por engano
      else expect(A.quality[i].count).toBe(r[1]);
    });
  });

  it('atividade por motorista', () => {
    expect(A.drivers.map((d) => [d.name, d.trips, d.speedEvents, d.km])).toEqual(O.drivers.map((d: { n: string; viagens: number; occ: number; km: number }) => [d.n, d.viagens, d.occ, d.km]));
  });
});
