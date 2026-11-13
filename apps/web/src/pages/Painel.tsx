import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fdt, nf, rs, STATUS_LABEL } from '../lib/format';
import { usePeriod } from '../lib/period';
import type { Dashboard, PlanItem, VehicleSummary } from '../lib/types';
import { Chip, Header, Kpi, Loading, PeriodPicker } from '../components/ui';
import { Bars, StackChart } from '../components/charts';
import { MaintenanceDialog } from './Manutencao';
import { useAuth, WRITE } from '../lib/auth';

export function VehicleCard({ v, worst }: { v: VehicleSummary; worst?: PlanItem }) {
  return (
    <article className="vc">
      <header><div><h3>{v.name}</h3><div className="plate">{v.plate}</div></div><div className="chips"><Chip s={v.status} /></div></header>
      <div className="kv">
        <span>Km atual</span><b>{nf(v.currentKm)}</b>
        <span>Último uso</span><b>{fdt(v.lastUse)}</b>
        <span>Km no período</span><b>{nf(v.km)}</b>
        <span>Consumo</span><b>{v.kml ? nf(v.kml, 1) + ' km/L' : 'sem dado'}</b>
        <span>Combustível</span><b>{rs(v.fuelCost)}</b>
        <span>Maior velocidade</span><b>{nf(v.maxSpeed)} km/h</b>
      </div>
      <div className="chips"><Chip s={v.maintenance} label={'Manutenção: ' + (STATUS_LABEL[v.maintenance] ?? v.maintenance)} />{v.docs && <Chip s={v.docs} label={'Docs: ' + (STATUS_LABEL[v.docs] ?? v.docs)} />}</div>
      {worst && <div className="note" style={{ margin: 0 }}>{worst.item}: {STATUS_LABEL[worst.status]}</div>}
    </article>
  );
}

export default function Painel() {
  const { qs } = usePeriod();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['dashboard', qs], queryFn: () => api<Dashboard>('/dashboard?' + qs) });
  const [reg, setReg] = useState<PlanItem | null>(null);
  const d = q.data;
  return (
    <>
      <Header title="Painel de gestão da frota" sub="Somente registros da empresa. Escolha o período dos indicadores:"
        actions={d && <div className="asof" title="Data do registro mais recente de cada fonte (não é o horário da sincronização).">Último registro do Comando de Bordo: {fdt(d.lastTripAt)}<br />Último dado do Chronos (importação manual): {fdt(d.lastSpeedAt)}</div>} />
      <PeriodPicker />
      <Loading q={q} />
      {d && <>
        <div className="kpis">
          <Kpi label="Km rodados" value={nf(d.kpis.km)} note="viagens válidas" />
          <Kpi label="Combustível" value={rs(d.kpis.fuel)} />
          <Kpi label="Custo total" value={rs(d.kpis.total)} note="inclui outros custos" />
          <Kpi label="Custo por km" value={rs(d.kpis.costPerKm)} />
          <Kpi label="Excessos de velocidade" value={d.kpis.speedEvents} note={`acima de ${d.config.speed} km/h`} />
          <Kpi label="Alertas de manutenção" value={d.kpis.maintenanceAlerts} note="a conferir ou vencidos" />
        </div>
        <h2>Veículos</h2>
        <div className="cards">{d.vehicles.map((v) => <VehicleCard key={v.plate} v={v} worst={d.alerts.find((a) => a.plate === v.plate)} />)}</div>
        <h2>Ações necessárias</h2>
        <div className="panel todo">
          {d.alerts.slice(0, 8).map((p) => <div key={p.id}><Chip s={p.status} /><span><b>{p.vehicleName}</b> · {p.item}{p.kmLeft != null && ` · ${nf(Math.abs(p.kmLeft))} km ${p.kmLeft < 0 ? 'além do previsto' : 'restantes'}`}
            {can(...WRITE) && <button className="btn sm" onClick={() => setReg(p)}>Registrar</button>}</span></div>)}
          {!d.alerts.length && <div><span>Nenhuma manutenção pendente.</span></div>}
          {d.openTasks.slice(0, 4).map((t) => <div key={t.id}><Chip s="ABERTO" /><span><b>{t.title}</b></span><p>{t.description}</p></div>)}
        </div>
        <div className="two">
          <div><h2>Combustível por mês</h2><div className="panel"><StackChart data={d.monthlyFuel} series={d.vehicles.map((v) => ({ key: v.plate, name: v.name }))} /></div></div>
          <div><h2>Velocidade por motorista</h2><div className="panel"><Bars items={d.speedByDriver.map((x) => ({ label: x.driver, value: x.count }))} />
            <div className="note">Excessos acima de {d.config.speed} km/h, com o motorista identificado pelo horário das viagens.</div></div></div>
        </div>
      </>}
      {reg && <MaintenanceDialog item={reg} onClose={() => setReg(null)} />}
    </>
  );
}
