const TZ = 'America/Sao_Paulo';
const dFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const dtFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Data de calendário 'YYYY-MM-DD' → 'DD/MM/AAAA' (sem conversão de fuso). */
export const fd = (v?: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '');
/** Instante ISO → 'DD/MM/AAAA HH:MM' em São Paulo. */
export const fdt = (v?: string | null) => (v ? dtFmt.format(new Date(v)) : '');
export const fdi = (v?: string | null) => (v ? dFmt.format(new Date(v)) : '');
export const nf = (v: number | null | undefined, d = 0) =>
  v == null || isNaN(v) ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const rs = (v: number | null | undefined) => (v == null || isNaN(v) ? '' : 'R$ ' + nf(v, 2));
export const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

export const STATUS_LABEL: Record<string, string> = {
  VENCIDO: 'VENCIDO', ATENCAO: 'ATENÇÃO', CONFIRMAR: 'CONFIRMAR', SEM_DADO: 'SEM DADO', OK: 'OK',
  ATRASADO: 'ATRASADO', PROXIMO: 'PRÓXIMO', ATIVO: 'Ativo', PARALISADO: 'Paralisado', INATIVO: 'Inativo',
  ABERTO: 'Aberto', RESOLVIDO: 'Resolvido', SUGESTAO: 'Sugestão',
};
const CLS: Record<string, string> = {
  OK: 'ok', VENCIDO: 'bad', ATRASADO: 'bad', ATENCAO: 'warn', PROXIMO: 'warn', CONFIRMAR: 'conf',
  ATIVO: 'ok', PARALISADO: 'warn', INATIVO: '', ABERTO: 'warn', RESOLVIDO: 'ok', SUGESTAO: '',
};
export const chipClass = (s?: string | null) => (s ? CLS[s] ?? '' : '');
