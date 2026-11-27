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
      <Header title="Veículos" sub="Situação atual, documentos (CRLV, IPVA, licenciamento, seguro) e cadastro." actions={can(...WRITE) && <button className="btn" onClick={() => setEdit({})}>Novo veículo</button>} />
      <PeriodPicker />
      <Loading q={dash} />
      {dash.data && <>
        <div className="cards">{dash.data.vehicles.map((v) => <VehicleCard key={v.plate} v={v} />)}</div>
      </>}
      <VehicleDocuments />
      {dash.data && <>
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

const DOC_KINDS: [string, string][] = [['crlv', 'CRLV'], ['ipva', 'IPVA'], ['licensing', 'Licenciamento'], ['insurance', 'Seguro (apólice)']];

type DocItem = { days: number | null; status: string };

/** Documentos vencidos ou dentro da antecedência de alerta, o mais urgente primeiro. */
export const docAlerts = (rows?: Docs[]) =>
  (rows ?? []).flatMap((r) => DOC_KINDS.map(([k, label]) => ({ r, k, label, date: r[k as 'crlv'] as string | null, it: r.items?.[k] as DocItem | undefined })))
    .filter((x) => x.it && (x.it.status === 'ATRASADO' || x.it.status === 'PROXIMO')).sort((a, b) => (a.it!.days ?? 0) - (b.it!.days ?? 0));

export const useDocuments = () => useQuery({ queryKey: ['documents'], queryFn: () => api<Docs[]>('/documents'), staleTime: 5 * 60_000 });

const docChip = (it?: DocItem) => !it || it.status === 'SEM_DADO' ? 'Sem data' : it.status === 'ATRASADO' ? 'Vencido'
  : it.status === 'PROXIMO' ? (it.days === 0 ? 'Vence hoje' : `${it.days} dia${it.days === 1 ? '' : 's'}`) : 'Em dia';
const docWhen = (date: string | null, it?: DocItem) => !date || !it || it.days == null ? 'sem data'
  : it.days < 0 ? `venceu em ${fd(date)} (há ${-it.days} dia${it.days === -1 ? '' : 's'})`
  : it.days === 0 ? 'vence hoje' : `vence em ${it.days} dia${it.days === 1 ? '' : 's'} (${fd(date)})`;

/** Documentos dos veículos (CRLV, IPVA, licenciamento, seguro): fica dentro da tela Veículos. */
function VehicleDocuments() {
  const { can } = useAuth(); const qc = useQueryClient();
  const q = useDocuments();
  const [edit, setEdit] = useState<Docs | null>(null);
  const write = can(...WRITE);
  const alerts = docAlerts(q.data);
  const next = (q.data ?? []).flatMap((r) => DOC_KINDS.map(([k, label]) => ({ r, label, date: r[k as 'crlv'] as string | null, st: r.items?.[k]?.status })))
    .filter((x) => x.st === 'OK' && x.date).sort((a, b) => a.date!.localeCompare(b.date!))[0];
  return (
    <>
      <h2 id="documentos">Documentos</h2>
      <p className="note">Vencimento do CRLV, IPVA, licenciamento e seguro de cada veículo. O sistema avisa {q.data?.[0]?.alertDays ?? 60} dias antes. Clique em 📄 para abrir o PDF (Google Drive da empresa).</p>
      <Loading q={q} />
      {q.data && <>
        {alerts.length > 0
          ? <section className="panel cnd-todo">
              <h3>Renovar agora <span className="cnd-count">{alerts.length}</span></h3>
              {alerts.map((x) => (
                <div key={x.r.plate + x.k} className={'cnd-todo-row ' + (x.it!.status === 'ATRASADO' ? 'bad' : 'warn')}>
                  <span className="cnd-dot" aria-hidden />
                  <span className="cnd-todo-what"><b>{x.r.vehicleName}</b> · {x.label}</span>
                  <span className="cnd-todo-when">{docWhen(x.date, x.it)}</span>
                  <span className="cnd-todo-act">{write && <button className="btn sm pri" onClick={() => setEdit(x.r)}>Atualizar</button>}</span>
                </div>
              ))}
            </section>
          : <section className="panel cnd-ok">✅ <b>Tudo em dia.</b>{next && <> Próximo a vencer: {next.r.vehicleName} · {next.label}, em {fd(next.date)}.</>}</section>}

        <div className="cnd-cos">
          {q.data.map((r) => (
            <article key={r.plate} className="panel cnd-co">
              <header>
                <div><h3>{r.vehicleName}</h3><small>Placa {r.plate} · {r.confirmed ? 'datas conferidas' : 'datas a confirmar'}</small></div>
                <div className="cnd-co-act">{write && <button className="btn sm" onClick={() => setEdit(r)}>Editar</button>}</div>
              </header>
              <ul className="cnd-list">
                {DOC_KINDS.map(([k, label]) => {
                  const date = r[k as 'crlv'] as string | null; const it = r.items?.[k]; const link = r.links?.[k];
                  return (
                    <li key={k}>
                      <span className="cnd-kind">{label}</span>
                      <span className="cnd-date">{date ? fd(date) : '—'}</span>
                      <Chip s={it?.status ?? 'SEM_DADO'} label={docChip(it)} />
                      <span className="cnd-act">
                        {link ? <a className="cnd-icon" href={link} target="_blank" rel="noopener noreferrer" title={`Abrir o PDF do ${label}`}>📄</a> : <span className="cnd-icon off" />}
                        {write && <button className="cnd-icon" onClick={() => setEdit(r)} title="Atualizar as datas e os links" aria-label={`Atualizar ${label}`}>✏️</button>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </div>
      </>}
      {edit && <FormDialog title={'Documentos: ' + edit.vehicleName} onClose={() => setEdit(null)} fields={[
        { name: 'crlv', label: 'CRLV válido até (prazo do próximo licenciamento)', type: 'date', value: edit.crlv }, { name: 'ipva', label: 'IPVA', type: 'date', value: edit.ipva },
        { name: 'licensing', label: 'Licenciamento', type: 'date', value: edit.licensing }, { name: 'insurance', label: 'Seguro', type: 'date', value: edit.insurance },
        { name: 'confirmed', label: 'Datas conferidas com o documento', type: 'check', value: edit.confirmed },
        { name: 'linksInfo', label: 'Links dos PDFs: no Google Drive, abra o arquivo, clique em ⋮ → Compartilhar → Copiar link e cole aqui. Deixe vazio para tirar o link.', type: 'info' },
        ...DOC_KINDS.map(([k, label]) => ({ name: 'link_' + k, label: `Link do PDF: ${label}`, value: edit.links?.[k] ?? '' })),
      ]} onSave={async (o) => {
        const links = Object.fromEntries(DOC_KINDS.map(([k]) => [k, String(o['link_' + k] ?? '').trim()]));
        await api(`/documents/${edit.vehicleId}`, { method: 'PUT', json: { crlv: nn(o.crlv), ipva: nn(o.ipva), licensing: nn(o.licensing), insurance: nn(o.insurance), confirmed: o.confirmed, links } });
        await qc.invalidateQueries();
      }} />}
    </>
  );
}
