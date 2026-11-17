/**
 * Importa o relatório "Pagamentos" do Mais Controle para Custos (ver @sgi/core/maiscontrole).
 * - Uma linha de custo por parcela, chave em costs.external_key (reimportar não duplica).
 * - Custos lançados antes por outra fonte (planilha antiga/SGI) que são o mesmo serviço (mesmo veículo, até 3 dias
 *   de diferença e mesmo valor total ou ambos de manutenção) são substituídos pelos do Mais Controle; os registros
 *   do histórico de manutenção que apontavam para eles passam a apontar para o custo novo.
 */
import type ExcelJS from 'exceljs';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { daysBetween, parseMaisControle, type McCost } from '@sgi/core';
import type { DB } from '../db/client.js';
import { costs, maintenanceRecords, vehicles } from '../db/schema.js';
import { cellValue } from './xlsx.js';

const MAINT = new Set(['Manutenção', 'Conserto', 'Pneus']);

export interface McStats {
  read: number; created: number; existing: number; skippedFuel: number; skippedOther: number;
  withoutVehicle: number; replaced: { date: string; vehicle: string; description: string }[];
}

export async function importMaisControle(db: DB, orgId: string, userId: string, wb: ExcelJS.Workbook): Promise<McStats> {
  const ws = wb.worksheets[0];
  const rows: unknown[][] = [];
  ws?.eachRow({ includeEmpty: false }, (row) => rows.push((row.values as ExcelJS.CellValue[]).slice(1).map(cellValue)));
  const vs = await db.select().from(vehicles).where(eq(vehicles.organizationId, orgId));
  const parsed = parseMaisControle(rows, vs.map((v) => ({ id: v.id, plate: v.plate, name: v.name, aliases: v.aliases })));
  const stats: McStats = { read: parsed.costs.length, created: 0, existing: 0, skippedFuel: parsed.skippedFuel, skippedOther: parsed.skippedOther,
    withoutVehicle: parsed.costs.filter((c) => !c.vehicleId).length, replaced: [] };
  if (!parsed.costs.length) return stats;

  const have = new Set((await db.select({ k: costs.externalKey }).from(costs)
    .where(and(eq(costs.organizationId, orgId), inArray(costs.externalKey, parsed.costs.map((c) => c.key))))).map((x) => x.k));
  const fresh = parsed.costs.filter((c) => !have.has(c.key));
  stats.existing = parsed.costs.length - fresh.length;
  const ids = new Map<string, string>();
  for (const c of fresh) {
    const notes = [c.dueDate && `Parcela com vencimento em ${c.dueDate.split('-').reverse().join('/')}`, c.paidAt ? `paga em ${c.paidAt.split('-').reverse().join('/')}` : 'em aberto']
      .filter(Boolean).join(', ');
    const [row] = await db.insert(costs).values({ organizationId: orgId, vehicleId: c.vehicleId, date: c.date, category: c.category, description: c.description,
      supplier: c.supplier, amount: c.amount, invoice: c.invoice, notes: `Mais Controle: ${notes}`, source: 'MAIS_CONTROLE', externalKey: c.key, userId }).returning({ id: costs.id });
    ids.set(c.key, row.id);
    stats.created++;
  }

  // serviços que já estavam lançados por outra fonte: substitui pelos do Mais Controle (fonte oficial do financeiro)
  const groups = new Map<string, { c: McCost; total: number; firstKey: string }>();
  for (const c of parsed.costs.filter((x) => x.vehicleId)) {
    const g = `${c.vehicleId}|${c.date}|${c.supplier}|${c.description}`;
    const cur = groups.get(g);
    if (cur) cur.total += c.amount; else groups.set(g, { c, total: c.amount, firstKey: c.key });
  }
  const others = await db.select().from(costs).where(and(eq(costs.organizationId, orgId), ne(costs.source, 'MAIS_CONTROLE')));
  for (const { c, total, firstKey } of groups.values()) {
    const target = ids.get(firstKey) ?? (await db.select({ id: costs.id }).from(costs).where(and(eq(costs.organizationId, orgId), eq(costs.externalKey, firstKey))))[0]?.id;
    if (!target) continue;
    for (const o of [...others]) { // cópia: itens são retirados de "others" dentro do laço
      if (o.vehicleId !== c.vehicleId || Math.abs(daysBetween(o.date, c.date)) > 3) continue;
      const sameValue = o.amount != null && Math.abs(o.amount - total) < 0.05;
      if (!(o.amount == null || sameValue || (MAINT.has(o.category) && MAINT.has(c.category)))) continue;
      await db.update(maintenanceRecords).set({ costId: target }).where(eq(maintenanceRecords.costId, o.id));
      await db.delete(costs).where(eq(costs.id, o.id));
      others.splice(others.indexOf(o), 1);
      stats.replaced.push({ date: o.date, vehicle: vs.find((v) => v.id === o.vehicleId)?.name ?? '', description: o.description.trim() });
    }
  }
  return stats;
}
