import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fd, nf, todayIso } from '../lib/format';
import { useAuth, WRITE } from '../lib/auth';
import type { PlanItem } from '../lib/types';
import { Chip, DataTable, FormDialog, Header, Loading, nn, num } from '../components/ui';

export function MaintenanceDialog({ item, onClose }: { item: PlanItem; onClose: () => void }) {
  const qc = useQueryClient();
  return (
    <FormDialog title={`Registrar manutenção: ${item.vehicleName} · ${item.item}`} onClose={onClose}
      fields={[
        { name: 'km', label: 'Km do serviço', type: 'number', step: '1', value: item.currentKm, required: true },
        { name: 'date', label: 'Data do serviço', type: 'date', value: todayIso(), required: true },
        { name: 'supplier', label: 'Oficina / fornecedor' },
        { name: 'invoice', label: 'Nota fiscal' },
        { name: 'amount', label: 'Valor (R$) — lança em Custos', type: 'number', step: '0.01' },
        { name: 'notes', label: 'Observação' },
      ]}
      onSave={async (o) => {
        await api(`/maintenance/plan/${item.id}/records`, { method: 'POST', json: { km: Number(o.km), date: o.date, supplier: nn(o.supplier), invoice: nn(o.invoice), amount: num(o.amount), notes: nn(o.notes) } });
        await qc.invalidateQueries();
      }} />
  );
}

export default function Manutencao() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['plan'], queryFn: () => api<PlanItem[]>('/maintenance/plan') });
  const [reg, setReg] = useState<PlanItem | null>(null);
  return (
    <>
      <Header title="Plano de manutenção" sub="Prazos por km, por data e pelo ritmo de uso. Use Registrar quando um serviço for feito: o prazo recomeça a contar." />
      <Loading q={q} />
      {q.data && <DataTable rows={q.data} filter={{ label: 'Todos os veículos', v: (r) => r.vehicleName }} cols={[
        { h: 'Veículo', v: (r) => r.vehicleName }, { h: 'Item', v: (r) => r.item }, { h: 'Status', v: (r) => r.status, f: (r) => <Chip s={r.status} /> },
        { h: 'Última (km)', v: (r) => r.lastKm, f: (r) => nf(r.lastKm), n: true }, { h: 'Próxima (km)', v: (r) => r.nextKm, f: (r) => nf(r.nextKm), n: true },
        { h: 'Km restante', v: (r) => r.kmLeft, f: (r) => nf(r.kmLeft), n: true }, { h: 'Vence em', v: (r) => r.dueDate, f: (r) => fd(r.dueDate) },
        { h: 'Previsão (dias)', v: (r) => r.forecastDays, f: (r) => nf(r.forecastDays), n: true }, { h: 'Fonte', v: (r) => r.source, w: true },
        { h: '', v: () => '', f: (r) => can(...WRITE) && <button className="btn sm" onClick={() => setReg(r)}>Registrar</button> },
      ]} />}
      {reg && <MaintenanceDialog item={reg} onClose={() => setReg(null)} />}
    </>
  );
}
