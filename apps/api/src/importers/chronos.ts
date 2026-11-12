/**
 * Importação do relatório "Períodos de utilização (BDV)" do rastreador Chronos.
 * Localiza as colunas pelo cabeçalho; eventos repetidos (mesma placa e início) são ignorados.
 */
import { parseInstant, parseNum } from '@sgi/core';
import type { DB } from '../db/client.js';
import { speedEvents } from '../db/schema.js';
import type { OrgResolver } from '../services/resolver.js';

const hours = (v: unknown) => {
  if (typeof v === 'number') return v < 1 ? v * 24 : v; // fração de dia do Excel
  const m = String(v ?? '').match(/(\d+):(\d\d):(\d\d)/);
  return m ? +m[1] + +m[2] / 60 + +m[3] / 3600 : null;
};

export class ChronosFormatError extends Error {}

export function mapChronos(rows: unknown[][], orgId: string, R: OrgResolver, importId: string | null) {
  const hIdx = rows.findIndex((r) => r.some((c) => String(c ?? '').trim().startsWith('Unidade rastreada')));
  if (hIdx < 0) throw new ChronosFormatError('Arquivo não parece ser o relatório "Períodos de utilização" do Chronos.');
  const h = rows[hIdx].map((x) => String(x ?? '').trim());
  const ix = (n: string) => h.findIndex((x) => x.startsWith(n));
  const c = { u: ix('Unidade rastreada'), i: ix('Data inicial'), d: ix('Duração'), vx: ix('Vel. máxima'), vm: ix('Vel. média'), ei: ix('Endereço inicial'), ef: ix('Endereço final') };
  if (c.u < 0 || c.i < 0 || c.vx < 0) throw new ChronosFormatError('Colunas obrigatórias ausentes: Unidade rastreada, Data inicial, Vel. máxima.');
  const out = [];
  for (const r of rows.slice(hIdx + 1)) {
    const s = parseInstant(r[c.i]); const vmax = parseNum(r[c.vx]);
    if (s == null || vmax == null) continue;
    out.push({
      organizationId: orgId, vehicleId: R.vehicleId(r[c.u]), plateRaw: String(r[c.u] ?? '').trim(),
      startedAt: new Date(s), durationH: c.d >= 0 ? hours(r[c.d]) : null, vmax,
      vavg: c.vm >= 0 ? parseNum(r[c.vm]) : null,
      addressStart: c.ei >= 0 ? (r[c.ei] as string) ?? null : null, addressEnd: c.ef >= 0 ? (r[c.ef] as string) ?? null : null,
      importId,
    });
  }
  return out;
}

export async function importChronos(db: DB, rows: ReturnType<typeof mapChronos>) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const r = await db.insert(speedEvents).values(rows.slice(i, i + 500)).onConflictDoNothing().returning({ id: speedEvents.id });
    inserted += r.length;
  }
  return { read: rows.length, inserted };
}
