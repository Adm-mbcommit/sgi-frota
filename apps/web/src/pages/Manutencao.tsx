import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fd, nf, todayIso } from '../lib/format';
import { useAuth, WRITE } from '../lib/auth';
import type { MaintenanceRecord, PlanItem } from '../lib/types';
import { Chip, DataTable, FormDialog, Header, Loading, nn } from '../components/ui';

export function MaintenanceDialog({ item, onClose }: { item: PlanItem; onClose: () => void }) {
  const qc = useQueryClient();
  return (
    <FormDialog title={`Registrar manutenção: ${item.vehicleName} · ${item.item}`} onClose={onClose}
      note="Serviço com valor? Lance em Custos e marque os itens feitos: o prazo é atualizado do mesmo jeito, sem lançar duas vezes."
      fields={[
        { name: 'km', label: 'Km do serviço', type: 'number', step: '1', value: item.currentKm, required: true },
        { name: 'date', label: 'Data do serviço', type: 'date', value: todayIso(), required: true },
        { name: 'supplier', label: 'Oficina / fornecedor' },
        { name: 'invoice', label: 'Nota fiscal' },
        { name: 'notes', label: 'Observação' },
      ]}
      onSave={async (o) => {
        await api(`/maintenance/plan/${item.id}/records`, { method: 'POST', json: { km: Number(o.km), date: o.date, supplier: nn(o.supplier), invoice: nn(o.invoice), notes: nn(o.notes) } });
        await qc.invalidateQueries();
      }} />
  );
}

const origin = (r: MaintenanceRecord) => (r.source === 'COMANDO_BORDO' ? 'Comando de Bordo' : r.costId ? 'Custos' : 'Registrado no SGI');

export default function Manutencao() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['plan'], queryFn: () => api<PlanItem[]>('/maintenance/plan') });
  const h = useQuery({ queryKey: ['maint-records'], queryFn: () => api<MaintenanceRecord[]>('/maintenance/records') });
  const [reg, setReg] = useState<PlanItem | null>(null);
  return (
    <>
      <Header title="Plano de manutenção" sub="Prazos por km, por data e pelo ritmo de uso. O prazo recomeça sozinho quando chega um serviço mais recente: pela aba Manutencao do Comando de Bordo (importação) ou por um custo de manutenção/revisão lançado em Custos." />
      <Loading q={q} />
      {q.data && <DataTable rows={q.data} filter={{ label: 'Todos os veículos', v: (r) => r.vehicleName }} cols={[
        { h: 'Veículo', v: (r) => r.vehicleName }, { h: 'Item', v: (r) => r.item }, { h: 'Status', v: (r) => r.status, f: (r) => <Chip s={r.status} /> },
        { h: 'Última (km)', v: (r) => r.lastKm, f: (r) => nf(r.lastKm), n: true }, { h: 'Próxima (km)', v: (r) => r.nextKm, f: (r) => nf(r.nextKm), n: true },
        { h: 'Km restante', v: (r) => r.kmLeft, f: (r) => nf(r.kmLeft), n: true }, { h: 'Vence em', v: (r) => r.dueDate, f: (r) => fd(r.dueDate) },
        { h: 'Previsão (dias)', v: (r) => r.forecastDays, f: (r) => nf(r.forecastDays), n: true }, { h: 'Fonte', v: (r) => r.source, w: true },
        { h: '', v: () => '', f: (r) => can(...WRITE) && <button className="btn sm" onClick={() => setReg(r)}>Registrar</button> },
      ]} />}
      <h2>Histórico de serviços</h2>
      <Loading q={h} />
      {h.data && <DataTable rows={h.data} limit={200} filter={{ label: 'Todos os veículos', v: (r) => r.vehicleName }} cols={[
        { h: 'Data', v: (r) => r.date, f: (r) => fd(r.date) }, { h: 'Veículo', v: (r) => r.vehicleName }, { h: 'Item', v: (r) => r.item },
        { h: 'Km', v: (r) => r.km, f: (r) => nf(r.km), n: true }, { h: 'Origem', v: (r) => origin(r) },
        { h: 'Fornecedor / NF', v: (r) => [r.supplier, r.invoice].filter(Boolean).join(' · ') }, { h: 'Observação', v: (r) => r.notes, w: true },
      ]} />}
      {reg && <MaintenanceDialog item={reg} onClose={() => setReg(null)} />}
    </>
  );
}
