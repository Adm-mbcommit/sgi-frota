import { describe, expect, it } from 'vitest';
import { INSPECTION_ITEMS, INSPECTION_PHOTOS, inspectionStatus, inspectionSummary } from '../src/inspections.js';

describe('checklist periódico (vistoria)', () => {
  const today = '2026-11-27';
  it('calcula a próxima vistoria quinzenal e a situação', () => {
    expect(inspectionStatus(null, today, 15, 3)).toEqual({ next: null, days: null, status: 'NUNCA' });
    expect(inspectionStatus('2026-11-20', today, 15, 3)).toEqual({ next: '2026-12-05', days: 8, status: 'EM_DIA' });
    expect(inspectionStatus('2026-11-15', today, 15, 3)).toEqual({ next: '2026-11-30', days: 3, status: 'VENCENDO' });
    expect(inspectionStatus('2026-11-12', today, 15, 3)).toEqual({ next: '2026-11-27', days: 0, status: 'VENCENDO' });
    expect(inspectionStatus('2026-11-01', today, 15, 3)).toEqual({ next: '2026-11-16', days: -11, status: 'ATRASADO' });
  });
  it('conta as respostas e tem chaves únicas', () => {
    expect(inspectionSummary([{ status: 'OK' }, { status: 'PROBLEMA' }, { status: 'ATENCAO' }, { status: 'NA' }, { status: 'OK' }]))
      .toEqual({ ok: 2, attention: 1, problems: 1 });
    expect(new Set(INSPECTION_ITEMS.map((i) => i.key)).size).toBe(INSPECTION_ITEMS.length);
    expect(new Set(INSPECTION_PHOTOS.map((i) => i.key)).size).toBe(INSPECTION_PHOTOS.length);
  });
});
