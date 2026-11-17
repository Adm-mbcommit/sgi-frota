/**
 * Relatório "Pagamentos" exportado do Mais Controle (sistema financeiro da empresa).
 * Cada linha é uma parcela. Viram custos do SGI (uma linha por parcela, na data de competência do serviço).
 * - Só a categoria "Frota".
 * - Combustível fica de fora: já vem do Comando de Bordo (entraria em dobro).
 * - Veículo pela placa (com erros comuns, ex.: QIX9C75) ou pelo nome na descrição ("Saveiro 21", "Uno",
 *   "saveiro obras" = 55, "saveiro escritório" = 75).
 */
import { parseDate } from './normalize.js';

export const MC_CATEGORIES = ['Manutenção', 'Conserto', 'Pneus', 'Seguro', 'IPVA', 'Licenciamento', 'Multa', 'Pedágios', 'Lavação', 'Outros'] as const;
export type McCategory = (typeof MC_CATEGORIES)[number];

export interface McVehicle { id: string; plate: string; name: string; aliases: string[] }
export interface McCost {
  /** Chave estável da parcela (reimportar não duplica). */
  key: string;
  date: string; dueDate: string | null; paidAt: string | null;
  amount: number; paid: number;
  supplier: string | null; description: string; invoice: string | null;
  category: McCategory; vehicleId: string | null;
}
export interface McResult { costs: McCost[]; skippedFuel: number; skippedOther: number }

const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const compact = (v: unknown) => norm(v).replace(/[^A-Z0-9]/g, '');
const num = (v: unknown) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0);
const dateBR = (v: unknown) => { const s = String(v ?? '').trim(); return s ? parseDate(s) : null; };

const FUEL = /COMBUSTIVEL|GASOLINA|DIESEL|ETANOL|ABASTEC/;

export function mcCategory(text: string): McCategory {
  const t = norm(text);
  if (/REVIS/.test(t)) return 'Manutenção';
  // conserto pontual ("concerto do vidro ... manutenção") não é revisão
  if (/CONCERTO|CONSERTO|REPARO|VIDRO|PARABRISA|MACANETA|LAMPADA|PALHETA|BATERIA/.test(t)) return 'Conserto';
  if (/MANUTEN|OLEO|FILTRO|SUSPENS/.test(t)) return 'Manutenção';
  if (/PNEU|VULCANIZ|BORRACH/.test(t)) return 'Pneus';
  if (/SEGURO|PROTECAO|APLAC|LONDON|ZURICH/.test(t) && !/CONSORCIO/.test(t)) return 'Seguro';
  if (/IPVA/.test(t)) return 'IPVA';
  if (/LICENCIAMENTO|REGISTRO/.test(t)) return 'Licenciamento';
  if (/MULTA|POLICIA|DIRETRAN/.test(t)) return 'Multa';
  if (/PEDAGIO|SEM PARAR|PLANALTO SUL|AUTO PISTA/.test(t)) return 'Pedágios';
  if (/LAVA[CG]/.test(t)) return 'Lavação';
  if (/MECANIC/.test(t)) return 'Conserto';
  return 'Outros';
}

/** Veículo citado no texto: placa (ou apelido) primeiro, depois o nome e os apelidos de uso ("obras", "escritório"). */
export function mcVehicle(text: string, date: string, vs: McVehicle[]): string | null {
  const c = compact(text);
  // placas e apelidos (inclui erros de digitação cadastrados como apelido, ex.: QXI9675, TRP0F55)
  const extra: Record<string, string[]> = { QXI9C75: ['QIX9C75'], MFS7D92: ['MFS7392'] };
  const byPlate = vs.filter((v) => [v.plate, ...v.aliases, ...(extra[v.plate] ?? [])].some((a) => compact(a).length >= 6 && c.includes(compact(a))));
  if (byPlate.length === 1) return byPlate[0].id;
  if (byPlate.length > 1) return null; // mais de um veículo (ex.: "saveiros TPX/TPR"): custo da frota
  const t = norm(text);
  const plateOf = (p: string) => vs.find((v) => v.plate === p)?.id ?? null;
  const num2 = t.match(/SAVEIR[O0]\S*\s*-?\s*(21|55|75)\b/);
  if (num2) return vs.find((v) => compact(v.name).endsWith(num2[1]))?.id ?? null;
  if (/\bUNO\b/.test(t)) return vs.find((v) => /UNO/.test(norm(v.name)))?.id ?? null;
  if (/SAVEIRO\s+(DE\s+)?OBRA/.test(t)) return plateOf('TPR0F55');
  if (/SAVEIRO\s+(DO\s+)?ESCRIT/.test(t)) return plateOf('QXI9C75');
  // "saveiro nova" antes da chegada da 21 (fev/2026) era a 55 (0 km 2025/2026)
  if (/SAVEIRO NOVA/.test(t) && date < '2026-02-01') return plateOf('TPR0F55');
  return null;
}

/** Lê as linhas do relatório (cabeçalho na primeira linha). */
export function parseMaisControle(rows: unknown[][], vs: McVehicle[]): McResult {
  const h = (rows[0] ?? []).map((x) => norm(x).trim());
  const col = (name: string) => h.findIndex((x) => x === norm(name));
  const i = {
    comp: col('Data de Competência'), venc: col('Data de Vencimento'), pag: col('Data de Pagamento'), val: col('Valor da Parcela'),
    pago: col('Valor Total Pago'), forn: col('Fornecedor'), desc: col('Descrição'), doc: col('Número do Documento'), cat: col('Categoria'),
  };
  if (i.comp < 0 || i.val < 0 || i.desc < 0) throw new Error('Não parece o relatório de Pagamentos do Mais Controle (faltam colunas como "Data de Competência", "Valor da Parcela" e "Descrição").');
  const out: McCost[] = []; let skippedFuel = 0, skippedOther = 0;
  for (const r of rows.slice(1)) {
    if (!r || r.every((x) => x == null || x === '')) continue;
    if (i.cat >= 0 && r[i.cat] && norm(r[i.cat]).trim() !== 'FROTA') { skippedOther++; continue; }
    const description = String(r[i.desc] ?? '').trim();
    const supplier = String(r[i.forn] ?? '').trim() || null;
    const date = dateBR(r[i.comp]) ?? dateBR(r[i.venc]);
    const amount = num(r[i.val]);
    if (!date || !amount) { skippedOther++; continue; }
    if (FUEL.test(norm(description))) { skippedFuel++; continue; }
    const docRaw = String(r[i.doc] ?? '').trim();
    const invoice = /\d{2,}/.test(docRaw) ? docRaw : null;
    const dueDate = dateBR(r[i.venc]);
    const text = `${description} ${supplier ?? ''}`;
    out.push({
      key: ['MC', compact(supplier), compact(description), compact(docRaw), date, dueDate ?? '', amount.toFixed(2)].join('|'),
      date, dueDate, paidAt: dateBR(r[i.pag]), amount, paid: num(r[i.pago]),
      supplier, description: description || supplier || 'Pagamento', invoice,
      category: mcCategory(text), vehicleId: mcVehicle(text, date, vs),
    });
  }
  // mesma parcela listada duas vezes no relatório conta uma vez só
  const seen = new Set<string>();
  return { costs: out.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true))), skippedFuel, skippedOther };
}
