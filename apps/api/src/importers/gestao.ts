/**
 * Planilha "Gestão Frota MATIAS" (.xlsx do usuário).
 * - Aba "Manutencoes": por veículo, o km da PRÓXIMA revisão. É a base dos prazos das revisões
 *   (itens de 10.000 km do plano: Revisão geral, Troca do óleo, Filtro do óleo).
 * - Aba "Custos": últimos serviços e despesas. Entram em Custos (sem duplicar) e as manutenções
 *   viram registros do histórico.
 * Reimportar é seguro: custos iguais (veículo, data, descrição, valor) não são duplicados.
 */
import type ExcelJS from 'exceljs';
import { and, eq } from 'drizzle-orm';
import { parseDate, parseKm, parseNum } from '@sgi/core';
import type { DB } from '../db/client.js';
import { costCategories, costs, maintenancePlan, maintenanceRecords, vehicles } from '../db/schema.js';
import type { OrgResolver } from '../services/resolver.js';
import { sheetRows } from './xlsx.js';

/** Itens do plano que acompanham a revisão periódica (o km da próxima revisão vale para eles). */
const REVISION_ITEMS = /revis[aã]o geral|troca d[eo] [óo]leo|filtro d[eo] [óo]leo/i;
/** Descrições de custo que são uma revisão/troca de óleo (servem de data e registro da última revisão). */
const REVISION_COST = /revis[aã]o|[óo]leo/i;

const norm = (v: unknown) => String(v ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O');
const header = (rows: unknown[][]) => (rows[0] ?? []).map((h) => norm(h));
const col = (h: string[], ...names: string[]) => h.findIndex((x) => names.some((n) => x.startsWith(norm(n))));

export interface GestaoStats {
  costs: { read: number; created: number; existing: number; skipped: number };
  revisions: { vehicle: string; nextKm: number; items: number; lastDate: string | null }[];
  notFound: string[];
}

export async function importGestao(db: DB, orgId: string, userId: string, R: OrgResolver, wb: ExcelJS.Workbook): Promise<GestaoStats> {
  const vs = await db.select().from(vehicles).where(eq(vehicles.organizationId, orgId));
  // placa pelos apelidos; sem placa (ou com erro de digitação), pelo nome do veículo ("SAVEIR0 - 21" = "SAVEIRO - 21")
  const vehicleOf = (plate: unknown, name: unknown) => R.vehicleId(plate) ?? vs.find((v) => norm(v.name) === norm(name))?.id ?? null;
  const stats: GestaoStats = { costs: { read: 0, created: 0, existing: 0, skipped: 0 }, revisions: [], notFound: [] };
  const missing = (s: string) => { if (s && !stats.notFound.includes(s)) stats.notFound.push(s); };

  /* ---- Custos ---- */
  const cRows = sheetRows(wb, 'Custos');
  const revCosts = new Map<string, { date: string; costId: string; supplier: string | null; invoice: string | null; description: string }[]>();
  if (cRows) {
    const h = header(cRows);
    const iDate = col(h, 'Data'), iVeh = col(h, 'Veiculo'), iPlate = col(h, 'Placa'), iCat = col(h, 'Categoria'), iDesc = col(h, 'Descricao'),
      iSup = col(h, 'Fornecedor'), iVal = col(h, 'Valor'), iObs = col(h, 'Observacao');
    for (const r of cRows.slice(1)) {
      const description = String(r[iDesc] ?? '').trim();
      const date = parseDate(r[iDate]);
      if (!description || !date) { if (description || date) stats.costs.skipped++; continue; }
      stats.costs.read++;
      const vehicleId = vehicleOf(r[iPlate], r[iVeh]);
      if (!vehicleId) { missing(String(r[iPlate] ?? r[iVeh] ?? '')); stats.costs.skipped++; continue; }
      const catRaw = String(r[iCat] ?? '').trim();
      const category = (costCategories as readonly string[]).find((c) => norm(c) === norm(catRaw)) ?? (/multa/i.test(catRaw) ? 'Multa' : 'Outros');
      const amount = parseNum(r[iVal]);
      const notes = r[iObs] != null && String(r[iObs]).trim() ? String(r[iObs]).trim() : null;
      const invoice = notes && /\bN\s*F/i.test(notes) ? notes : null;
      const supplier = r[iSup] != null && String(r[iSup]).trim() ? String(r[iSup]).trim() : null;
      // já existe? (mesmo veículo, data e descrição; o valor pode ter sido completado depois)
      const same = (await db.select().from(costs).where(and(eq(costs.organizationId, orgId), eq(costs.vehicleId, vehicleId), eq(costs.date, date))))
        .find((c) => norm(c.description) === norm(description));
      let costId: string;
      if (same) {
        stats.costs.existing++; costId = same.id;
        if (same.amount == null && amount != null) await db.update(costs).set({ amount }).where(eq(costs.id, same.id));
      } else {
        const [c] = await db.insert(costs).values({ organizationId: orgId, vehicleId, date, category, description, supplier, amount, invoice, notes, source: 'LEGADO', userId }).returning();
        stats.costs.created++; costId = c.id;
      }
      if (category === 'Manutenção' && REVISION_COST.test(description)) {
        const list = revCosts.get(vehicleId) ?? [];
        list.push({ date, costId, supplier, invoice, description });
        revCosts.set(vehicleId, list);
      }
    }
  }

  /* ---- Manutencoes: km da próxima revisão ---- */
  const mRows = sheetRows(wb, 'Manutencoes') ?? sheetRows(wb, 'Manutenções');
  if (mRows) {
    const h = header(mRows);
    const iVeh = col(h, 'Veiculo'), iPlate = col(h, 'Placa'), iNext = col(h, 'Proxima'), iDate = col(h, 'Data da manutencao'), iKm = col(h, 'KM da manutencao'),
      iServ = col(h, 'Servico'), iSup = col(h, 'Oficina');
    for (const r of mRows.slice(1)) {
      const nextKm = parseKm(r[iNext]);
      if (nextKm == null || nextKm <= 0) continue;
      const vehicleId = vehicleOf(r[iPlate], r[iVeh]);
      const v = vs.find((x) => x.id === vehicleId);
      if (!v) { missing(String(r[iVeh] ?? r[iPlate] ?? '')); continue; }
      // data da última revisão: a da linha, se preenchida; senão a revisão mais recente da aba Custos
      const last = [...(revCosts.get(v.id) ?? [])].sort((a, b) => b.date.localeCompare(a.date))[0];
      const lastDate = parseDate(r[iDate]) ?? last?.date ?? null;
      const items = (await db.select().from(maintenancePlan).where(and(eq(maintenancePlan.vehicleId, v.id), eq(maintenancePlan.active, true))))
        .filter((p) => REVISION_ITEMS.test(p.item) && p.intervalKm);
      for (const p of items) {
        const lastKm = Math.round(nextKm - p.intervalKm!);
        const source = `Planilha Gestão Frota: próxima revisão no km ${nextKm.toLocaleString('pt-BR')}${lastDate ? ` · última em ${lastDate.split('-').reverse().join('/')}` : ''}`;
        await db.update(maintenancePlan).set({ lastKm, lastDate: lastDate ?? p.lastDate, needsCheck: false, source }).where(eq(maintenancePlan.id, p.id));
        // registra no histórico a revisão da aba Custos (uma vez por item)
        if (last && lastDate === last.date) {
          const has = (await db.select({ id: maintenanceRecords.id }).from(maintenanceRecords)
            .where(and(eq(maintenanceRecords.planItemId, p.id), eq(maintenanceRecords.date, last.date)))).length;
          if (!has) await db.insert(maintenanceRecords).values({ organizationId: orgId, planItemId: p.id, vehicleId: v.id, item: p.item, km: lastKm, date: last.date,
            supplier: last.supplier ?? (r[iSup] ? String(r[iSup]) : null), invoice: last.invoice, costId: last.costId, notes: `${last.description.trim()} (planilha Gestão Frota${r[iServ] ? ' · ' + String(r[iServ]) : ''}; km pela próxima revisão)`, userId });
        }
      }
      stats.revisions.push({ vehicle: v.name, nextKm, items: items.length, lastDate });
    }
  }
  return stats;
}
