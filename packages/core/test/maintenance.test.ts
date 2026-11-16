import { describe, expect, it } from 'vitest';
import { expectedDue, groupDue, type DueItem } from '../src/maintenance.js';

const base = (o: Partial<DueItem>): DueItem => ({ plate: 'QXI9C75', item: 'Troca do óleo', status: 'OK', nextKm: 149126, kmLeft: 2415, dueDate: '2027-06-30', daysLeft: 226, forecastDays: 40.2, ...o });

describe('agenda de manutenção', () => {
  it('usa o que vier primeiro: km (pelo ritmo de uso) ou data', () => {
    expect(expectedDue(base({}), '2026-11-16')).toEqual({ forecastDate: '2026-12-27', expectedDate: '2026-12-27', by: 'km' });
    expect(expectedDue(base({ forecastDays: 400 }), '2026-11-16')).toMatchObject({ expectedDate: '2027-06-30', by: 'data' });
    expect(expectedDue(base({ kmLeft: -3766, forecastDays: null }), '2026-11-16')).toMatchObject({ expectedDate: '2026-11-16', by: 'km' });
    expect(expectedDue(base({ forecastDays: null, dueDate: null }), '2026-11-16')).toEqual({ forecastDate: null, expectedDate: null, by: null });
  });
  it('agrupa itens que vencem juntos e põe o mais urgente primeiro', () => {
    const g = groupDue([
      base({ id: 'a' }), base({ id: 'b', item: 'Filtro do óleo' }), base({ id: 'c', item: 'Pneus', nextKm: 179126, kmLeft: 32415, dueDate: null, forecastDays: 540 }),
      base({ id: 'd', plate: 'TPX8A21', item: 'Troca do óleo', status: 'VENCIDO', nextKm: 20000, kmLeft: -3766, dueDate: '2027-06-15', forecastDays: null }),
    ], '2026-11-16');
    expect(g.map((x) => [x.plate, x.status, x.items])).toEqual([
      ['TPX8A21', 'VENCIDO', ['Troca do óleo']],
      ['QXI9C75', 'OK', ['Troca do óleo', 'Filtro do óleo']],
      ['QXI9C75', 'OK', ['Pneus']],
    ]);
    expect(g[1].ids).toEqual(['a', 'b']);
  });
});
