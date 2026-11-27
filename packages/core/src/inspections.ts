/**
 * Checklist periódico (vistoria) dos veículos, feito pela administração no SGI, com fotos.
 * É diferente do checklist diário dos motoristas (aba "manutencao_diaria" do Comando de Bordo).
 *
 * - Prazo: a cada `inspectionDays` dias (padrão 15, quinzenal), contados da última vistoria do veículo.
 * - Alerta: `inspectionAlertDays` dias antes de vencer (padrão 3).
 * - Cada item recebe OK, ATENCAO (acompanhar), PROBLEMA (resolver: vira pendência) ou NA (não se aplica).
 */
import { addDays, daysBetween } from './dates.js';

export const INSPECTION_ANSWERS = ['OK', 'ATENCAO', 'PROBLEMA', 'NA'] as const;
export type InspectionAnswer = (typeof INSPECTION_ANSWERS)[number];

export interface InspectionItemDef { key: string; group: string; label: string }

/** Itens padrão da vistoria, agrupados como se percorre o carro. */
export const INSPECTION_ITEMS: InspectionItemDef[] = [
  { group: 'Por fora', key: 'lataria', label: 'Lataria e pintura (amassados, riscos)' },
  { group: 'Por fora', key: 'vidros', label: 'Para-brisa e vidros' },
  { group: 'Por fora', key: 'retrovisores', label: 'Retrovisores' },
  { group: 'Por fora', key: 'farois', label: 'Faróis, lanternas e setas' },
  { group: 'Por fora', key: 'freio_luz', label: 'Luz de freio e de ré' },
  { group: 'Por fora', key: 'limpadores', label: 'Limpadores e esguicho' },
  { group: 'Pneus', key: 'pneus', label: 'Pneus (desgaste e calibragem)' },
  { group: 'Pneus', key: 'estepe', label: 'Estepe' },
  { group: 'Pneus', key: 'ferramentas', label: 'Macaco, chave de roda e triângulo' },
  { group: 'Por dentro', key: 'painel', label: 'Painel sem luz de alerta acesa' },
  { group: 'Por dentro', key: 'cintos', label: 'Cintos de segurança' },
  { group: 'Por dentro', key: 'buzina', label: 'Buzina' },
  { group: 'Por dentro', key: 'ar', label: 'Ar-condicionado e ventilação' },
  { group: 'Por dentro', key: 'bancos', label: 'Bancos e forração' },
  { group: 'Por dentro', key: 'limpeza', label: 'Limpeza e organização' },
  { group: 'Documentos', key: 'crlv', label: 'CRLV (documento) no veículo ou no celular' },
];

export interface PhotoSlot { key: string; label: string; required: boolean }

/** Fotos pedidas em toda vistoria. "Outras" (avarias, detalhes) são livres. */
export const INSPECTION_PHOTOS: PhotoSlot[] = [
  { key: 'frente', label: 'Frente', required: true },
  { key: 'traseira', label: 'Traseira', required: true },
  { key: 'lado_esquerdo', label: 'Lado esquerdo (motorista)', required: true },
  { key: 'lado_direito', label: 'Lado direito', required: true },
  { key: 'painel', label: 'Painel ligado (km e luzes)', required: true },
  { key: 'pneu_de', label: 'Pneu dianteiro esquerdo', required: true },
  { key: 'pneu_dd', label: 'Pneu dianteiro direito', required: true },
  { key: 'pneu_te', label: 'Pneu traseiro esquerdo', required: true },
  { key: 'pneu_td', label: 'Pneu traseiro direito', required: true },
  { key: 'interior', label: 'Interior', required: false },
  { key: 'outra', label: 'Outra (avaria, detalhe)', required: false },
];

export const FUEL_LEVELS = ['Reserva', '1/4', '1/2', '3/4', 'Cheio'] as const;

/** EM_DIA · VENCENDO (dentro do alerta) · ATRASADO · NUNCA (veículo sem vistoria). */
export type InspectionDue = 'EM_DIA' | 'VENCENDO' | 'ATRASADO' | 'NUNCA';

/** Próxima vistoria e situação, a partir da data da última. `days` = dias até a próxima (negativo = atrasada). */
export function inspectionStatus(lastDate: string | null, today: string, intervalDays: number, alertDays: number):
  { next: string | null; days: number | null; status: InspectionDue } {
  if (!lastDate) return { next: null, days: null, status: 'NUNCA' };
  const next = addDays(lastDate, Math.max(1, Math.round(intervalDays)));
  const days = daysBetween(today, next);
  return { next, days, status: days < 0 ? 'ATRASADO' : days <= alertDays ? 'VENCENDO' : 'EM_DIA' };
}

/** Contagem das respostas de uma vistoria (itens sem resposta não contam). */
export function inspectionSummary(items: { status: string }[]) {
  const c = { ok: 0, attention: 0, problems: 0 };
  for (const i of items) {
    if (i.status === 'OK') c.ok++;
    else if (i.status === 'ATENCAO') c.attention++;
    else if (i.status === 'PROBLEMA') c.problems++;
  }
  return c;
}
