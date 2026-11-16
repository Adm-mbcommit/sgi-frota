/** Manutenção: alertas das próximas revisões (km, data e ritmo de uso), plano por veículo e registro de serviços. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { groupDue, type DueGroup } from '@sgi/core';
import { api } from '../lib/api';
import { fd, nf, todayIso } from '../lib/format';
import { useAuth, WRITE } from '../lib/auth';
import type { PlanItem, Vehicle } from '../lib/types';
import { Chip, DataTable, FormDialog, Header, Loading, nn, num } from '../components/ui';

export const usePlan = () => useQuery({ queryKey: ['plan'], queryFn: () => api<PlanItem[]>('/maintenance/plan') });

/** Revisões agrupadas (itens que vencem juntos), da mais urgente para a menos urgente. */
export function dueGroups(plan: PlanItem[], today = todayIso()) {
  return groupDue(plan.map((p) => ({ ...p, status: p.status as DueGroup['status'] })), today);
}

const vname = (plan: PlanItem[], plate: string) => plan.find((p) => p.plate === plate)?.vehicleName ?? plate;

/** "Faltam 2.415 km (no km 149.126)" / "Passou 3.766 km do previsto (era no km 20.000)" */
export function kmText(g: { kmLeft: number | null; nextKm: number | null }) {
  if (g.nextKm == null) return null;
  if (g.kmLeft == null) return `No km ${nf(g.nextKm)}`;
  return g.kmLeft < 0 ? `Passou ${nf(-g.kmLeft)} km do previsto (era no km ${nf(g.nextKm)})` : `Faltam ${nf(g.kmLeft)} km (no km ${nf(g.nextKm)})`;
}
export function dateText(g: { dueDate: string | null; daysLeft: number | null }) {
  if (!g.dueDate) return null;
  const d = g.daysLeft ?? 0;
  return d < 0 ? `Venceu em ${fd(g.dueDate)} (há ${nf(-d)} dias)` : d === 0 ? `Vence hoje (${fd(g.dueDate)})` : `Até ${fd(g.dueDate)} (faltam ${nf(d)} dias)`;
}
const listItems = (items: string[]) => (items.length <= 3 ? items.join(', ') : `${items.slice(0, 3).join(', ')} e mais ${items.length - 3}`);

export function MaintenanceDialog({ items, onClose }: { items: PlanItem[]; onClose: () => void }) {
  const qc = useQueryClient();
  const first = items[0];
  return (
    <FormDialog title={`Registrar revisão: ${first.vehicleName}`} onClose={onClose}
      fields={[
        ...(items.length > 1 ? [{ name: 'which', label: `Itens: ${items.map((i) => i.item).join(', ')}`, type: 'check' as const, value: true }] : []),
        { name: 'km', label: 'Km do serviço', type: 'number', step: '1', value: first.currentKm, required: true },
        { name: 'date', label: 'Data do serviço', type: 'date', value: todayIso(), required: true },
        { name: 'supplier', label: 'Oficina / fornecedor' },
        { name: 'invoice', label: 'Nota fiscal' },
        { name: 'amount', label: 'Valor total (R$) — lança em Custos', type: 'number', step: '0.01' },
        { name: 'notes', label: 'Observação' },
      ]}
      onSave={async (o) => {
        const chosen = items.length > 1 && o.which === false ? [first] : items;
        for (const [i, it] of chosen.entries()) {
          // o valor vai uma vez só (no primeiro item), para não duplicar o custo
          await api(`/maintenance/plan/${it.id}/records`, { method: 'POST', json: { km: Number(o.km), date: o.date, supplier: nn(o.supplier), invoice: nn(o.invoice), amount: i === 0 ? num(o.amount) : null, notes: nn(o.notes) } });
        }
        await qc.invalidateQueries();
      }} />
  );
}

function PlanDialog({ item, vehicles, onClose }: { item: Partial<PlanItem>; vehicles: Vehicle[]; onClose: () => void }) {
  const qc = useQueryClient();
  return (
    <FormDialog title={item.id ? `Editar: ${item.vehicleName} · ${item.item}` : 'Nova revisão no plano'} onClose={onClose}
      extra={item.id ? { label: 'Tirar do plano', run: async () => { if (confirm(`Tirar "${item.item}" do plano de ${item.vehicleName}?`)) { await api(`/maintenance/plan/${item.id}`, { method: 'PATCH', json: { active: false } }); await qc.invalidateQueries(); } } } : undefined}
      fields={[
        ...(item.id ? [] : [{ name: 'vehicleId', label: 'Veículo', type: 'select' as const, value: item.vehicleId ?? vehicles[0]?.id, options: vehicles.map((v) => [v.id, v.name] as [string, string]) }]),
        { name: 'item', label: 'Item (ex.: Troca do óleo, Revisão geral, Pneus)', value: item.item, required: true },
        { name: 'intervalKm', label: 'A cada quantos km (deixe vazio se não for por km)', type: 'number', step: '1', value: item.intervalKm },
        { name: 'intervalMonths', label: 'A cada quantos meses (deixe vazio se não for por data)', type: 'number', step: '1', value: item.intervalMonths },
        { name: 'lastKm', label: 'Km da última vez que foi feito', type: 'number', step: '1', value: item.lastKm },
        { name: 'lastDate', label: 'Data da última vez que foi feito', type: 'date', value: item.lastDate },
        { name: 'needsCheck', label: 'Dados a conferir (não tenho certeza do último km/data)', type: 'check', value: item.status === 'CONFIRMAR' },
      ]}
      onSave={async (o) => {
        const body = { item: o.item, intervalKm: num(o.intervalKm), intervalMonths: num(o.intervalMonths), lastKm: num(o.lastKm), lastDate: nn(o.lastDate), needsCheck: !!o.needsCheck };
        if (body.intervalKm == null && body.intervalMonths == null) throw new Error('Informe o intervalo em km, em meses ou os dois.');
        await api(item.id ? `/maintenance/plan/${item.id}` : '/maintenance/plan', { method: item.id ? 'PATCH' : 'POST', json: item.id ? body : { ...body, vehicleId: o.vehicleId } });
        await qc.invalidateQueries();
      }} />
  );
}

function CopyDialog({ to, vehicles, sources, onClose }: { to: Vehicle; vehicles: Vehicle[]; sources: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const opts = vehicles.filter((v) => v.id !== to.id && sources.includes(v.id)).map((v) => [v.id, v.name] as [string, string]);
  return (
    <FormDialog title={`Copiar plano para ${to.name}`} onClose={onClose}
      fields={[
        { name: 'from', label: 'Copiar os itens e intervalos de', type: 'select', value: opts[0]?.[0], options: opts },
        { name: 'lastKm', label: `Km da última revisão do ${to.name}`, type: 'number', step: '1' },
        { name: 'lastDate', label: `Data da última revisão do ${to.name}`, type: 'date' },
      ]}
      onSave={async (o) => {
        const r = await api<{ created: number }>('/maintenance/plan/copy', { method: 'POST', json: { fromVehicleId: o.from, toVehicleId: to.id, lastKm: num(o.lastKm), lastDate: nn(o.lastDate) } });
        await qc.invalidateQueries();
        alert(`${r.created} item(ns) copiado(s) para ${to.name}.${num(o.lastKm) == null ? ' Sem o km da última revisão, eles ficam como "Confirmar" até você preencher.' : ''}`);
      }} />
  );
}

/** Informar km e data da última revisão de vários itens de uma vez (para os itens sem dados). */
function LastServiceDialog({ items, onClose }: { items: PlanItem[]; onClose: () => void }) {
  const qc = useQueryClient();
  return (
    <FormDialog title={`Última revisão: ${items[0].vehicleName}`} onClose={onClose}
      fields={[
        { name: 'lastKm', label: 'Km da última revisão', type: 'number', step: '1', required: true },
        { name: 'lastDate', label: 'Data da última revisão', type: 'date', required: true },
        ...items.map((it) => ({ name: 'it_' + it.id, label: `Foi feito: ${it.item}`, type: 'check' as const, value: true })),
      ]}
      onSave={async (o) => {
        const chosen = items.filter((it) => o['it_' + it.id] === true);
        if (!chosen.length) throw new Error('Marque pelo menos um item.');
        for (const it of chosen) await api(`/maintenance/plan/${it.id}`, { method: 'PATCH', json: { lastKm: Number(o.lastKm), lastDate: o.lastDate, needsCheck: false } });
        await qc.invalidateQueries();
      }} />
  );
}

function GroupCard({ g, plan, onRegister }: { g: DueGroup; plan: PlanItem[]; onRegister?: (items: PlanItem[]) => void }) {
  const items = plan.filter((p) => g.ids.includes(p.id));
  return (
    <div className={'due-card ' + g.status.toLowerCase()}>
      <div className="due-head"><b>{vname(plan, g.plate)}</b><Chip s={g.status} /></div>
      <div className="due-items">{listItems(g.items)}</div>
      <ul className="due-facts">
        {kmText(g) && <li>🛣️ {kmText(g)}</li>}
        {dateText(g) && <li>📅 {dateText(g)}</li>}
        {g.forecastDate && (g.kmLeft ?? 0) > 0 && <li>📈 Pelo ritmo de uso: chega ao km por volta de {fd(g.forecastDate)}</li>}
        {g.status === 'CONFIRMAR' && <li>❓ Confira o km e a data da última revisão (na nota fiscal) e atualize.</li>}
      </ul>
      {onRegister && <button className="btn sm pri" onClick={() => onRegister(items)}>Registrar revisão feita</button>}
    </div>
  );
}

export default function Manutencao() {
  const { can } = useAuth();
  const write = can(...WRITE);
  const q = usePlan();
  const vq = useQuery({ queryKey: ['vehicles'], queryFn: () => api<Vehicle[]>('/vehicles') });
  const [reg, setReg] = useState<PlanItem[] | null>(null);
  const [edit, setEdit] = useState<Partial<PlanItem> | null>(null);
  const [copy, setCopy] = useState<Vehicle | null>(null);
  const [fill, setFill] = useState<PlanItem[] | null>(null);
  const plan = q.data ?? [];
  const vehicles = (vq.data ?? []).filter((v) => v.active && v.status !== 'INATIVO');
  const groups = dueGroups(plan);
  const alerts = groups.filter((g) => g.status === 'VENCIDO' || g.status === 'ATENCAO' || g.status === 'CONFIRMAR');
  const withPlan = new Set(plan.map((p) => p.vehicleId));
  const noPlan = vehicles.filter((v) => !withPlan.has(v.id));
  const noData = vehicles.map((v) => ({ v, items: plan.filter((p) => p.vehicleId === v.id && p.status === 'SEM_DADO') })).filter((x) => x.items.length);
  // próxima revisão de cada veículo (a primeira data esperada entre os itens com prazo)
  const nextByVehicle = vehicles.filter((v) => withPlan.has(v.id)).map((v) => {
    const vg = groups.filter((g) => g.plate === v.plate && g.status !== 'SEM_DADO' && g.status !== 'CONFIRMAR');
    const g = [...vg].sort((a, b) => (a.expectedDate ?? '9999').localeCompare(b.expectedDate ?? '9999'))[0];
    return { v, g };
  });
  return (
    <>
      <Header title="Manutenção" sub="Alertas das próximas revisões por km, por data e pelo ritmo de uso de cada veículo. O que vier primeiro vale."
        actions={write && <button className="btn" onClick={() => setEdit({})}>Nova revisão no plano</button>} />
      <Loading q={q} />
      {q.data && <>
        <h2>⚠️ Alertas {alerts.length > 0 && <span className="count-pill">{alerts.length}</span>}</h2>
        {alerts.length
          ? <div className="due-grid">{alerts.map((g, i) => <GroupCard key={i} g={g} plan={plan} onRegister={write ? setReg : undefined} />)}</div>
          : <div className="banner ok-banner">Nenhuma revisão vencida ou perto de vencer. ✅</div>}

        {noPlan.length > 0 && <>
          <h2>🚫 Veículos sem plano de manutenção</h2>
          <div className="panel">
            <p className="note" style={{ marginTop: 0 }}>Sem plano, o sistema não consegue avisar as revisões destes veículos.</p>
            {noPlan.map((v) => (
              <div key={v.id} className="noplan-row"><b>{v.name}</b><span className="note">{v.plate}</span>
                {write && <span className="noplan-act">
                  {withPlan.size > 0 && <button className="btn sm pri" onClick={() => setCopy(v)}>Copiar plano de outro veículo</button>}
                  <button className="btn sm" onClick={() => setEdit({ vehicleId: v.id })}>Cadastrar revisão</button>
                </span>}
              </div>
            ))}
          </div>
        </>}

        {noData.length > 0 && <>
          <h2>❔ Itens sem dados: o sistema não consegue avisar</h2>
          <div className="panel">
            <p className="note" style={{ marginTop: 0 }}>Falta o km e a data da última vez que estes itens foram feitos. Informe a última revisão de cada veículo para o SGI passar a avisar.</p>
            {noData.map(({ v, items }) => (
              <div key={v.id} className="noplan-row"><b>{v.name}</b><span className="note">{items.length} ite{items.length > 1 ? 'ns' : 'm'}: {listItems(items.map((i) => i.item))}</span>
                {write && <span className="noplan-act"><button className="btn sm pri" onClick={() => setFill(items)}>Informar última revisão</button></span>}
              </div>
            ))}
          </div>
        </>}

        <h2>🗓️ Próxima revisão de cada veículo</h2>
        <div className="tw"><table>
          <thead><tr><th>Veículo</th><th>O quê</th><th>Por km</th><th>Por data</th><th>Data esperada</th><th>Situação</th></tr></thead>
          <tbody>{nextByVehicle.map(({ v, g }) => (
            <tr key={v.id}><td>{v.name}{noData.some((x) => x.v.id === v.id) && <div className="note">❔ há itens sem dados</div>}</td>
              {g ? <><td className="wide">{listItems(g.items)}</td><td>{kmText(g) ?? '—'}</td><td>{dateText(g) ?? '—'}</td>
                <td><b>{g.expectedDate ? fd(g.expectedDate) : '—'}</b>{g.by && <span className="note"> ({g.by === 'km' ? 'pelo km' : 'pela data'})</span>}</td><td><Chip s={g.status} /></td></>
                : <td colSpan={5} className="note">Todos os itens precisam de conferência (veja os alertas).</td>}
            </tr>
          ))}</tbody>
        </table></div>

        <details className="done-box"><summary>Todos os itens do plano ({plan.length}) — ver, editar ou registrar um item</summary>
        <DataTable rows={plan} filter={{ label: 'Todos os veículos', v: (r) => r.vehicleName }} cols={[
          { h: 'Veículo', v: (r) => r.vehicleName }, { h: 'Item', v: (r) => r.item }, { h: 'Status', v: (r) => r.status, f: (r) => <Chip s={r.status} /> },
          { h: 'Intervalo', v: (r) => r.intervalKm, f: (r) => [r.intervalKm && nf(r.intervalKm) + ' km', r.intervalMonths && r.intervalMonths + ' meses'].filter(Boolean).join(' ou ') },
          { h: 'Última', v: (r) => r.lastKm, f: (r) => [r.lastKm != null && nf(r.lastKm) + ' km', r.lastDate && fd(r.lastDate)].filter(Boolean).join(' · ') },
          { h: 'Próxima (km)', v: (r) => r.nextKm, f: (r) => nf(r.nextKm), n: true },
          { h: 'Km restante', v: (r) => r.kmLeft, f: (r) => nf(r.kmLeft), n: true }, { h: 'Vence em', v: (r) => r.dueDate, f: (r) => fd(r.dueDate) },
          { h: 'Fonte', v: (r) => r.source, w: true },
          { h: '', v: () => '', f: (r) => write && <span style={{ display: 'flex', gap: 4 }}><button className="btn sm" onClick={() => setReg([r])}>Registrar</button><button className="btn sm" onClick={() => setEdit(r)}>Editar</button></span> },
        ]} />
        </details>
      </>}
      {fill && <LastServiceDialog items={fill} onClose={() => setFill(null)} />}
      {reg && <MaintenanceDialog items={reg} onClose={() => setReg(null)} />}
      {edit && <PlanDialog item={edit} vehicles={vehicles} onClose={() => setEdit(null)} />}
      {copy && <CopyDialog to={copy} vehicles={vehicles} sources={[...withPlan] as string[]} onClose={() => setCopy(null)} />}
    </>
  );
}

/** Aviso no Início: revisões vencidas e perto de vencer. */
export function MaintenanceSummary() {
  const q = usePlan();
  if (!q.data) return null;
  const g = dueGroups(q.data);
  const late = g.filter((x) => x.status === 'VENCIDO');
  const soon = g.filter((x) => x.status === 'ATENCAO');
  const conf = g.filter((x) => x.status === 'CONFIRMAR');
  if (!late.length && !soon.length && !conf.length) return null;
  const desc = (x: DueGroup) => `${vname(q.data!, x.plate)} (${x.items[0]}${x.items.length > 1 ? ' +' + (x.items.length - 1) : ''})`;
  return (
    <div className={'banner cal-banner' + (late.length ? ' bad-banner' : '')}>
      <span>🔧 <b>Manutenção:</b> {[late.length && `${late.length} vencida(s): ${late.map(desc).join(', ')}`, soon.length && `${soon.length} perto de vencer: ${soon.map(desc).join(', ')}`, conf.length && `${conf.length} para conferir`].filter(Boolean).join(' · ')}</span>
      <Link className="btn sm" to="/frota/manutencao">Ver manutenção</Link>
    </div>
  );
}
