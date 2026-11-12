/**
 * Atualização do plano de manutenção a partir de serviços feitos.
 * Três caminhos chegam aqui: a aba "Manutencao" do Comando de Bordo (importação),
 * os custos de Manutenção lançados na tela Custos e o botão Registrar da tela Manutenção.
 * Regra única: o plano só avança — um serviço mais antigo que o último registrado não volta o prazo.
 */
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { maintenancePlan } from '../db/schema.js';

/** Chave de comparação de nomes de item: sem acento, sem espaços, minúsculas ("Pastilhas/ lonas de Freios" = "Pastilhas/lonas de freios"). */
export const itemKey = (v: unknown) =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '');

interface Last { lastKm: number | null; lastDate: string | null }

/** O serviço (km, data) é mais recente que o último registrado no plano? */
export function isNewer(cur: Last, km: number | null, date: string | null): boolean {
  if (km == null && date == null) return false;
  if (cur.lastKm == null && cur.lastDate == null) return true;
  if (date && cur.lastDate && date !== cur.lastDate) return date > cur.lastDate;
  if (km != null && cur.lastKm != null) return km > cur.lastKm;
  return cur.lastDate == null ? date != null : cur.lastKm == null && km != null;
}

export const brDate = (iso: string) => iso.split('-').reverse().join('/');

type PlanRow = typeof maintenancePlan.$inferSelect;

/** Aplica o serviço ao item do plano se for mais recente. Retorna true se atualizou. */
export async function applyToPlan(db: DB, p: PlanRow, km: number | null, date: string | null, source: string): Promise<boolean> {
  if (!isNewer(p, km, date)) return false;
  await db.update(maintenancePlan).set({ lastKm: km ?? p.lastKm, lastDate: date ?? p.lastDate, needsCheck: false, source }).where(eq(maintenancePlan.id, p.id));
  p.lastKm = km ?? p.lastKm; p.lastDate = date ?? p.lastDate;
  return true;
}
