/**
 * Normalização dos dados que chegam das planilhas (Comando de Bordo, Chronos).
 * Usado pelos importadores; os cálculos já recebem dados normalizados.
 */
import { DAY_MS } from './dates.js';

/** Offset fixo de Brasília (sem horário de verão desde 2019). */
const SP_OFFSET = '-03:00';

/**
 * Interpreta datas das planilhas: serial do Excel, Date, 'YYYY-MM-DD[THH:MM[:SS]]'
 * ou 'DD/MM/YYYY [HH:MM[:SS]]'. Horários sem fuso são hora local de São Paulo.
 */
export function parseInstant(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') {
    if (!isFinite(v)) return null;
    // serial do Excel (dias desde 1899-12-30), em hora local
    if (v < 200000) return Math.round((v - 25569) * DAY_MS) + 3 * 3_600_000;
    return v;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::(\d\d))?)?(Z|[+-]\d\d:?\d\d)?/);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}${m[7] ?? SP_OFFSET}`;
    const t = Date.parse(iso);
    return isNaN(t) ? null : t;
  }
  m = s.match(/^(\d\d)\/(\d\d)\/(\d{4})(?:\s+(\d\d):(\d\d)(?::(\d\d))?)?/);
  if (m) {
    const t = Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}${SP_OFFSET}`);
    return isNaN(t) ? null : t;
  }
  return null;
}

/** Data de calendário ('YYYY-MM-DD') a partir de qualquer formato aceito por parseInstant. */
export function parseDate(v: unknown): string | null {
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\d/.test(v.trim())) return v.trim().slice(0, 10);
  const t = parseInstant(v);
  if (t == null) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(t));
}

/** Km digitado: aceita número, '34.789km', '16.628 km'. */
export function parseKm(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/km/gi, '').replace(/\./g, '').replace(/\s/g, ''));
  return isNaN(n) || String(v).trim() === '' ? null : n;
}

/** Número com vírgula ou ponto decimal. */
export function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

/** Chave de comparação de placas e apelidos: maiúsculas, sem espaço e hífen. */
export function plateKey(v: unknown): string {
  return String(v ?? '').toUpperCase().replace(/[\s\-]/g, '');
}

/** Chave de comparação de nomes: minúsculas, sem espaços extras. */
export function nameKey(v: unknown): string {
  return String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface AliasResolver {
  /** Retorna a placa cadastrada ou null. */
  plate(raw: unknown): string | null;
  /** Retorna o nome canônico do motorista ou null se a grafia não estiver cadastrada. */
  driver(raw: unknown): string | null;
}

/**
 * Cria o resolvedor de apelidos a partir dos cadastros (placa → apelidos, motorista → grafias).
 * Placas também casam se a entrada contém a placa cadastrada (ex.: "SAVEIRO TPR0F55").
 */
export function makeResolver(
  vehicles: { plate: string; aliases: string[] }[],
  drivers: { name: string; aliases: string[] }[],
): AliasResolver {
  const pm = new Map<string, string>();
  for (const v of vehicles) {
    pm.set(plateKey(v.plate), v.plate);
    for (const a of v.aliases) pm.set(plateKey(a), v.plate);
  }
  const dm = new Map<string, string>();
  for (const d of drivers) {
    dm.set(nameKey(d.name), d.name);
    for (const a of d.aliases) dm.set(nameKey(a), d.name);
  }
  return {
    plate(raw) {
      const k = plateKey(raw);
      if (!k) return null;
      if (pm.has(k)) return pm.get(k)!;
      for (const v of vehicles) if (k.includes(plateKey(v.plate))) return v.plate;
      return null;
    },
    driver(raw) {
      const k = nameKey(raw);
      return k ? dm.get(k) ?? null : null;
    },
  };
}
