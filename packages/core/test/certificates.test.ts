import { describe, expect, it } from 'vitest';
import { CERT_KIND_INFO, certificateStatus, suggestedExpiry } from '../src/certificates.js';

describe('certidões (CNDs)', () => {
  const today = '2026-11-19';
  it('classifica o vencimento pela antecedência do alerta', () => {
    expect(certificateStatus('2026-11-10', today, 7)).toEqual({ days: -9, status: 'VENCIDO' });
    expect(certificateStatus('2026-11-19', today, 7)).toEqual({ days: 0, status: 'ATENCAO' });
    expect(certificateStatus('2026-11-22', today, 7)).toEqual({ days: 3, status: 'ATENCAO' });
    expect(certificateStatus('2026-11-27', today, 7)).toEqual({ days: 8, status: 'OK' });
    expect(certificateStatus(null, today, 7)).toEqual({ days: null, status: 'SEM_DADO' });
  });
  it('sugere o vencimento da falência (TJSC) em 90 dias da emissão', () => {
    expect(suggestedExpiry('FALENCIA', '2026-11-09')).toBe('2027-02-07');
    expect(CERT_KIND_INFO.FGTS.alertDays).toBeLessThan(CERT_KIND_INFO.FGTS.validityDays);
  });
});
