/**
 * Lista de tarefas colada de uma vez (ex.: passada a limpo de um caderno).
 *
 * Formato, uma tarefa por linha:
 *   Fazer ordem de compra
 *   Ver com João sobre as mesas @João
 *   ↳ fazer manutenção nos calços          (detalhe da tarefa de cima)
 *   [aguardando] Ver sobre confraternização @Diego
 *   [feita] Mouse pad Diego
 * Marcadores de início ("->", "→", "-", "•", "*", "☐", "1.") são ignorados.
 */
export type ParsedTaskStatus = 'A_FAZER' | 'AGUARDANDO' | 'FEITA';
export interface ParsedTask { title: string; details: string | null; person: string | null; status: ParsedTaskStatus }

const BULLET = /^(?:-+>|→|=>|[-•*·☐□]|\d+[.)])\s*/;
const DETAIL = /^(?:↳|↪|└|>)\s*/;
const STATUS = /^\[(a fazer|aguardando|aguardar|feita|feito|ok)\]\s*/i;
const PERSON = /\s+@([\p{L}][\p{L}\s.'-]*?)\s*$/u;

export function parseTaskList(text: string): ParsedTask[] {
  const out: ParsedTask[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    if (DETAIL.test(line)) {
      const d = line.replace(DETAIL, '').trim();
      const last = out[out.length - 1];
      if (d && last) { last.details = last.details ? `${last.details}; ${d}` : d; continue; }
      line = d;
      if (!line) continue;
    }
    line = line.replace(BULLET, '');
    let status: ParsedTaskStatus = 'A_FAZER';
    const st = line.match(STATUS);
    if (st) {
      const s = st[1].toLowerCase();
      status = s.startsWith('aguard') ? 'AGUARDANDO' : s === 'a fazer' ? 'A_FAZER' : 'FEITA';
      line = line.replace(STATUS, '');
    }
    let person: string | null = null;
    const pm = line.match(PERSON);
    if (pm) { person = pm[1].trim(); line = line.replace(PERSON, ''); }
    line = line.trim();
    if (line) out.push({ title: line.slice(0, 300), details: null, person, status });
  }
  return out;
}
