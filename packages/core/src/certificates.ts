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

/* ---------------- leitura automática da pasta do Drive ---------------- */

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const KIND_PATTERNS: [CertKind, RegExp][] = [
  ['FALENCIA', /FALENCIA|RECUPERACAO JUDICIAL/],
  ['FGTS', /\bFGTS\b|\bCRF\b/],
  ['TRABALHISTA', /TRABALHIST|\bCNDT\b/],
  ['MUNICIPAL', /MUNICIPAL/],
  ['ESTADUAL', /ESTADUAL/],
  ['FEDERAL', /FEDERAL|RECEITA|PGFN/],
];

/** "22.11.26", "05/05/2027" → '2026-11-22' / '2027-05-05' (ano com 2 dígitos = 20xx). */
function brDate(d: string, m: string, y: string): string | null {
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const day = Number(d), month = Number(m);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  const iso = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return addDays(iso, 0) === iso ? iso : null; // rejeita 31/02 etc.
}

/**
 * Tipo e validade a partir do nome do arquivo, no padrão usado na pasta: "CND FGTS - VAL 22.11.26.pdf",
 * "CND TRABALHISTA 28.11.2026.pdf", "CND_Falencia.pdf" (sem data). Null se não for uma CND conhecida.
 */
export function parseCertificateName(name: string): { kind: CertKind; expiresOn: string | null } | null {
  const n = plain(name);
  const kind = KIND_PATTERNS.find(([, re]) => re.test(n))?.[0];
  if (!kind) return null;
  const dates = [...n.matchAll(/(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/g)].map((m) => brDate(m[1], m[2], m[3])).filter(Boolean) as string[];
  return { kind, expiresOn: dates.at(-1) ?? null };
}

const D = String.raw`(\d{2})\/(\d{2})\/(\d{4})`;

/**
 * Emissão e validade a partir do texto do PDF (Receita, SEF/SC, Prefeitura de Lages, Caixa, TST, TJSC).
 * Sem validade impressa (falência do TJSC): emissão + validade habitual, marcado como estimado.
 */
export function parseCertificateText(kind: CertKind, text: string): { issuedOn: string | null; expiresOn: string | null; expiryEstimated: boolean } {
  const t = plain(text).replace(/\s+/g, ' ');
  const pick = (re: RegExp) => { const m = t.match(re); return m ? brDate(m[1], m[2], m[3]) : null; };
  // "Validade: 12/10/2026 a 10/11/2026" (FGTS): início e fim
  const range = t.match(new RegExp(String.raw`VALIDADE:? ${D} A ${D}`));
  let expiresOn = range ? brDate(range[4], range[5], range[6])
    : pick(new RegExp(String.raw`VALID(?:ADE|A|O)(?: ATE)?:?(?: \d{1,10})? ${D}`));
  const issuedOn = (range ? brDate(range[1], range[2], range[3]) : null)
    ?? pick(new RegExp(String.raw`(?:EMITIDA|EMISSAO|EXPEDI[CD]A?O?|EXPEDIDA)[^0-9]{0,25}(?:\d{1,2}:\d{2}(?::\d{2})?[^0-9]{0,12})?${D}`))
    ?? pick(new RegExp(String.raw`INFORMACAO OBTIDA EM ${D}`))
    ?? pick(new RegExp(String.raw`\bDATA:? ${D}`));
  let expiryEstimated = false;
  if (!expiresOn && issuedOn) { expiresOn = suggestedExpiry(kind, issuedOn); expiryEstimated = true; }
  return { issuedOn, expiresOn, expiryEstimated };
}
