/**
 * Certidões negativas de débito (CNDs) das empresas do grupo: tipos, validade padrão e situação do vencimento.
 *
 * - Cada tipo tem uma antecedência padrão de alerta (dias antes do vencimento), proporcional à validade:
 *   o FGTS vale ~30 dias, então alertar 30 dias antes deixaria o alerta sempre aceso.
 * - A certidão de falência do TJSC não traz validade impressa: o SGI considera 90 dias da emissão
 *   (o prazo de autenticidade informado no documento), salvo se o edital pedir outro.
 */
import { addDays, daysBetween } from './dates.js';

export const CERT_KINDS = ['FEDERAL', 'ESTADUAL', 'MUNICIPAL', 'FGTS', 'TRABALHISTA', 'FALENCIA'] as const;
export type CertKind = (typeof CERT_KINDS)[number];

export interface CertKindInfo {
  label: string;
  /** Órgão que emite e onde renovar. */
  issuer: string;
  /** Validade habitual (dias), usada para sugerir o vencimento quando a certidão não traz a data. */
  validityDays: number;
  /** Antecedência padrão do alerta (dias antes de vencer). */
  alertDays: number;
}

export const CERT_KIND_INFO: Record<CertKind, CertKindInfo> = {
  FEDERAL: { label: 'Federal', issuer: 'Receita Federal / PGFN', validityDays: 180, alertDays: 30 },
  ESTADUAL: { label: 'Estadual', issuer: 'SEF/SC', validityDays: 180, alertDays: 30 },
  MUNICIPAL: { label: 'Municipal', issuer: 'Prefeitura de Lages', validityDays: 30, alertDays: 10 },
  FGTS: { label: 'FGTS', issuer: 'Caixa (CRF)', validityDays: 30, alertDays: 7 },
  TRABALHISTA: { label: 'Trabalhista', issuer: 'TST (CNDT)', validityDays: 180, alertDays: 30 },
  FALENCIA: { label: 'Falência', issuer: 'TJSC (recuperação judicial e falência)', validityDays: 90, alertDays: 15 },
};

/** VENCIDO: passou do vencimento · ATENCAO: dentro da antecedência de alerta · OK · SEM_DADO: sem vencimento. */
export type CertStatus = 'VENCIDO' | 'ATENCAO' | 'OK' | 'SEM_DADO';

export function certificateStatus(expiresOn: string | null, today: string, alertDays: number): { days: number | null; status: CertStatus } {
  if (!expiresOn) return { days: null, status: 'SEM_DADO' };
  const days = daysBetween(today, expiresOn);
  return { days, status: days < 0 ? 'VENCIDO' : days <= alertDays ? 'ATENCAO' : 'OK' };
}

/** Vencimento sugerido a partir da emissão, pela validade habitual do tipo. */
export function suggestedExpiry(kind: CertKind, issuedOn: string): string {
  return addDays(issuedOn, CERT_KIND_INFO[kind].validityDays);
}
