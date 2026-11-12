/** Veículos, motoristas e documentos. */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fd, nf, rs } from '../lib/format';
import { usePeriod } from '../lib/period';
import { useAuth, WRITE } from '../lib/auth';
import type { Dashboard, Docs, Driver, DriverSummary, Vehicle } from '../lib/types';
import { Chip, DataTable, FormDialog, Header, Loading, PeriodPicker, nn } from '../components/ui';
import { VehicleCard } from './Painel';

const list = (s: unknown) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export function Veiculos() {
  const { qs } = usePeriod(); const { can } = useAuth(); const qc = useQueryClient();
  const dash = useQuery({ queryKey: ['dashboard', qs], queryFn: () => api<Dashboard>('/dashboard?' + qs) });
  const reg = useQuery({ queryKey: ['vehicles'], queryFn: () => api<Vehicle[]>('/vehicles') });
  const [edit, setEdit] = useState<Partial<Vehicle> | null>(null);
  return (
    <>
      <Header title="Veículos" sub="Cadastro e situação atual." actions={can(...WRITE) && <button className="btn" onClick={() => setEdit({})}>Novo veículo</button>} />
      <PeriodPicker />
      <Loading q={dash} />
      {dash.data && <>
        <div className="cards">{dash.data.vehicles.map((v) => <VehicleCard key={v.plate} v={v} />)}</div>
        <h2>Quadro comparativo</h2>
        <div className="tw"><table><thead><tr><th>Veículo</th><th>Placa</th><th>Viagens</th><th>Km</th><th>Litros</th><th>R$/km comb.</th><th>Ocorrências</th></tr></thead>
          <tbody>{dash.data.vehicles.map((v) => <tr key={v.plate}><td>{v.name}</td><td className="n">{v.plate}</td><td className="n">{nf(v.trips)}</td><td className="n">{nf(v.km)}</td><td className="n">{nf(v.liters, 1)}</td><td className="n">{rs(v.fuelCostPerKm)}</td><td className="n">{nf(v.speedEvents)}</td></tr>)}</tbody></table></div>
      </>}
      <h2>Cadastro</h2>
      {reg.data && <DataTable rows={reg.data} cols={[
        { h: 'Nome', v: (r) => r.name }, { h: 'Placa', v: (r) => r.plate }, { h: 'Modelo', v: (r) => r.model }, { h: 'Situação', v: (r) => r.status, f: (r) => <Chip s={r.status} /> },
        { h: 'Km de referência', v: (r) => r.refKm, f: (r) => nf(r.refKm), n: true }, { h: 'Outras grafias da placa', v: (r) => r.aliases.join(', '), w: true },
        { h: '', v: () => '', f: (r) => can(...WRITE) && <button className="btn sm" onClick={() => setEdit(r)}>Editar</button> },
      ]} />}
      {edit && <FormDialog title={edit.id ? 'Editar veículo' : 'Novo veículo'} onClose={() => setEdit(null)} fields={[
        { name: 'name', label: 'Nome', value: edit.name, required: true }, { name: 'plate', label: 'Placa', value: edit.plate, required: true },
        { name: 'model', label: 'Modelo', value: edit.model }, { name: 'refKm', label: 'Km de referência (atualize a cada revisão)', type: 'number', value: edit.refKm, required: true },
        { name: 'status', label: 'Situação', type: 'select', value: edit.status ?? 'ATIVO', options: [['ATIVO', 'Ativo'], ['PARALISADO', 'Paralisado'], ['INATIVO', 'Inativo']] },
        { name: 'aliases', label: 'Outras grafias da placa (separe por vírgula)', value: edit.aliases?.join(', ') },
      ]} onSave={async (o) => {
        const body = { name: o.name, plate: o.plate, model: nn(o.model), refKm: Number(o.refKm), status: o.status, aliases: list(o.aliases) };
        await api(edit.id ? `/vehicles/${edit.id}` : '/vehicles', { method: edit.id ? 'PATCH' : 'POST', json: body });
        await qc.invalidateQueries();
      }} />}
    </>
  );
}

export function Motoristas() {
  const { qs } = usePeriod(); const { can } = useAuth(); const qc = useQueryClient();
  const sum = useQuery({ queryKey: ['drivers-summary', qs], queryFn: () => api<DriverSummary[]>('/drivers/summary?' + qs) });
  const reg = useQuery({ queryKey: ['drivers'], queryFn: () => api<Driver[]>('/drivers') });
  const [edit, setEdit] = useState<Partial<Driver> | null>(null);
  const byName = new Map((reg.data ?? []).map((d) => [d.name, d]));
  return (
    <>
      <Header title="Motoristas" sub="Atividade no período e situação da CNH. Informe o vencimento da CNH para ativar o alerta." actions={can(...WRITE) && <button className="btn" onClick={() => setEdit({})}>Novo motorista</button>} />
      <PeriodPicker />
      <Loading q={sum} />
      {sum.data && <DataTable rows={sum.data} cols={[
        { h: 'Motorista', v: (r) => r.name }, { h: 'CNH', v: (r) => r.cnhStatus, f: (r) => <Chip s={r.cnhStatus} /> }, { h: 'Vencimento', v: (r) => r.cnhExpiry, f: (r) => fd(r.cnhExpiry) },
        { h: 'Viagens', v: (r) => r.trips, n: true }, { h: 'Km', v: (r) => r.km, f: (r) => nf(r.km), n: true }, { h: 'Excessos', v: (r) => r.speedEvents, n: true },
        { h: 'Maior vel. (km/h)', v: (r) => r.maxSpeed, f: (r) => nf(r.maxSpeed), n: true }, { h: 'Abastec.', v: (r) => r.fuelings, n: true }, { h: 'Checklists', v: (r) => r.checklists, n: true },
        { h: '', v: () => '', f: (r) => can(...WRITE) && byName.get(r.name) && <button className="btn sm" onClick={() => setEdit(byName.get(r.name)!)}>Editar</button> },
      ]} />}
      {edit && <FormDialog title={edit.id ? `Motorista: ${edit.name}` : 'Novo motorista'} onClose={() => setEdit(null)} fields={[
        { name: 'name', label: 'Nome', value: edit.name, required: true },
        { name: 'cnhExpiry', label: 'Vencimento da CNH', type: 'date', value: edit.cnhExpiry },
        { name: 'aliases', label: 'Outras grafias usadas nos formulários (separe por vírgula)', value: edit.aliases?.join(', ') },
        { name: 'active', label: 'Ativo', type: 'check', value: edit.active ?? true },
      ]} onSave={async (o) => {
        const body = { name: o.name, cnhExpiry: nn(o.cnhExpiry), aliases: list(o.aliases), active: o.active };
        await api(edit.id ? `/drivers/${edit.id}` : '/drivers', { method: edit.id ? 'PATCH' : 'POST', json: body });
        await qc.invalidateQueries();
      }} />}
    </>
  );
}

export function Documentos() {
  const { can } = useAuth(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['documents'], queryFn: () => api<Docs[]>('/documents') });
  const [edit, setEdit] = useState<Docs | null>(null);
  return (
    <>
      <Header title="Documentos dos veículos" sub="Marque como conferido depois de informar as datas reais. As datas iniciais vieram da planilha antiga e eram provisórias." />
      <Loading q={q} />
      {q.data && <DataTable rows={q.data} cols={[
        { h: 'Veículo', v: (r) => r.vehicleName }, { h: 'CRLV', v: (r) => r.crlv, f: (r) => fd(r.crlv) }, { h: 'IPVA', v: (r) => r.ipva, f: (r) => fd(r.ipva) },
        { h: 'Licenciamento', v: (r) => r.licensing, f: (r) => fd(r.licensing) }, { h: 'Seguro', v: (r) => r.insurance, f: (r) => fd(r.insurance) },
        { h: 'Próximo', v: (r) => r.next, f: (r) => fd(r.next) }, { h: 'Dias', v: (r) => r.days, n: true }, { h: 'Status', v: (r) => r.status, f: (r) => <Chip s={r.status} /> },
        { h: 'Dados', v: (r) => r.confirmed, f: (r) => <span className={'chip ' + (r.confirmed ? 'ok' : 'conf')}>{r.confirmed ? 'Conferido' : 'A confirmar'}</span> },
        { h: '', v: () => '', f: (r) => can(...WRITE) && <button className="btn sm" onClick={() => setEdit(r)}>Editar</button> },
      ]} />}
      {edit && <FormDialog title={'Documentos: ' + edit.vehicleName} onClose={() => setEdit(null)} fields={[
        { name: 'crlv', label: 'CRLV', type: 'date', value: edit.crlv }, { name: 'ipva', label: 'IPVA', type: 'date', value: edit.ipva },
        { name: 'licensing', label: 'Licenciamento', type: 'date', value: edit.licensing }, { name: 'insurance', label: 'Seguro', type: 'date', value: edit.insurance },
        { name: 'confirmed', label: 'Datas conferidas com o documento', type: 'check', value: edit.confirmed },
      ]} onSave={async (o) => {
        await api(`/documents/${edit.vehicleId}`, { method: 'PUT', json: { crlv: nn(o.crlv), ipva: nn(o.ipva), licensing: nn(o.licensing), insurance: nn(o.insurance), confirmed: o.confirmed } });
        await qc.invalidateQueries();
      }} />}
    </>
  );
}
