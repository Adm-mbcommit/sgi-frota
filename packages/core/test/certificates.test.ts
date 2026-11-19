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

import { parseCertificateName, parseCertificateText } from '../src/certificates.js';

describe('leitura das CNDs do Drive', () => {
  it('lê tipo e validade do nome do arquivo', () => {
    expect(parseCertificateName('CND FGTS - VAL 22.11.26.pdf')).toEqual({ kind: 'FGTS', expiresOn: '2026-11-22' });
    expect(parseCertificateName('CND MUNICIPAL - VAL 08.11.2026')).toEqual({ kind: 'MUNICIPAL', expiresOn: '2026-11-08' });
    expect(parseCertificateName('CND FEDERAL -  VAL 24.01.27.pdf')).toEqual({ kind: 'FEDERAL', expiresOn: '2027-01-24' });
    expect(parseCertificateName('CND TRABALHISTA 28.11.2026.pdf')).toEqual({ kind: 'TRABALHISTA', expiresOn: '2026-11-28' });
    expect(parseCertificateName('CND_Falencia.pdf')).toEqual({ kind: 'FALENCIA', expiresOn: null });
    expect(parseCertificateName('FALENCIA.pdf')).toEqual({ kind: 'FALENCIA', expiresOn: null });
    expect(parseCertificateName('Balanço Patrimonial ECD 2025.pdf')).toBeNull();
    expect(parseCertificateName('Cartão CNPJ.pdf')).toBeNull();
  });
  it('lê emissão e validade do texto dos PDFs', () => {
    expect(parseCertificateText('FALENCIA', 'NÃO CONSTAM ... Certidão emitida às 09:06 de 09/11/2026. A confirmação de autenticidade estará disponível pelo prazo de 90 dias'))
      .toEqual({ issuedOn: '2026-11-09', expiresOn: '2027-02-07', expiryEstimated: true });
    expect(parseCertificateText('FGTS', 'Validade: 12/10/2026 a 10/11/2026 Certificação Número: 1 Informação obtida em 09/11/2026 08:58:00'))
      .toEqual({ issuedOn: '2026-10-12', expiresOn: '2026-11-10', expiryEstimated: false });
    expect(parseCertificateText('MUNICIPAL', 'Data: 06/11/2026 08h43min SECRETARIA ... Número Validade 63877 06/12/2026 CERTIDÃO NEGATIVA'))
      .toEqual({ issuedOn: '2026-11-06', expiresOn: '2026-12-06', expiryEstimated: false });
    expect(parseCertificateText('FEDERAL', 'Emitida às 10:11:58 do dia 29/06/2026 <hora e data de Brasília>. Válida até 26/12/2026. Código'))
      .toEqual({ issuedOn: '2026-06-29', expiresOn: '2026-12-26', expiryEstimated: false });
    expect(parseCertificateText('FALENCIA', 'texto sem datas')).toEqual({ issuedOn: null, expiresOn: null, expiryEstimated: false });
  });
});
