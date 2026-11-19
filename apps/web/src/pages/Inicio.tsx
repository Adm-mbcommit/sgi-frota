/** Início do SGI Matias Brasil: os setores e um resumo de cada um. */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePeriod } from '../lib/period';
import type { Dashboard } from '../lib/types';
import { Header } from '../components/ui';
import { MODULES, type AppModule } from '../modules';
import { dueInfo, useMyTasks } from './Tarefas';
import { CalendarSummary } from './Calendario';
import { MaintenanceSummary } from './Manutencao';
import { CertificatesSummary, certAlerts, useCertificates } from './Certidoes';

export default function Inicio() {
  const { me } = useAuth();
  return (
    <>
      <Header title={`Olá, ${me?.user.name.split(' ')[0] ?? ''}`} sub="SGI Matias Brasil · escolha um setor." />
      <MaintenanceSummary />
      <CertificatesSummary />
      <CalendarSummary />
      <MyTasksSummary />
      <div className="cards">{MODULES.map((m) => <ModuleCard key={m.id} m={m} />)}</div>
    </>
  );
}

/** Lembrete das tarefas pessoais atrasadas ou para hoje. */
function MyTasksSummary() {
  const q = useMyTasks();
  const open = (q.data ?? []).filter((t) => t.status !== 'FEITA');
  if (!open.length) return null;
  const late = open.filter((t) => dueInfo(t)?.cls === 'bad').length;
  const today = open.filter((t) => dueInfo(t)?.cls === 'warn').length;
  return (
    <div className="banner" style={{ marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span><b>Minhas tarefas:</b> {open.length} em aberto{today ? ` · ${today} para hoje` : ''}{late ? ` · ${late} atrasada${late > 1 ? 's' : ''}` : ''}</span>
      <Link className="btn sm" to="/tarefas">Ver tarefas</Link>
    </div>
  );
}

function ModuleCard({ m }: { m: AppModule }) {
  return (
    <article className={'vc modcard' + (m.soon ? ' soon' : '')}>
      <header><h3>{m.name}</h3>{m.soon && <span className="chip">Em breve</span>}</header>
      <p className="note" style={{ margin: 0 }}>{m.about}</p>
      {m.id === 'frota' && <FrotaSummary />}
      {m.id === 'administrativo' && <AdmSummary />}
      <div><Link className={'btn' + (m.soon ? '' : ' pri')} to={m.path}>{m.soon ? 'Ver' : 'Abrir ' + m.name}</Link></div>
    </article>
  );
}

function FrotaSummary() {
  const { qs } = usePeriod();
  const q = useQuery({ queryKey: ['dashboard', qs], queryFn: () => api<Dashboard>('/dashboard?' + qs) });
  const d = q.data;
  if (!d) return null;
  return (
    <div className="kv">
      <span>Veículos</span><b>{d.vehicles.length}</b>
      <span>Alertas de manutenção</span><b>{d.kpis.maintenanceAlerts}</b>
      <span>Pendências abertas</span><b>{d.openTasks.length}</b>
    </div>
  );
}

function AdmSummary() {
  const q = useCertificates();
  if (!q.data) return null;
  const a = certAlerts(q.data);
  return (
    <div className="kv">
      <span>Empresas</span><b>{q.data.companies.filter((c) => c.active).length}</b>
      <span>Certidões vencidas</span><b>{a.filter((r) => r.status === 'VENCIDO').length}</b>
      <span>Vencendo em breve</span><b>{a.filter((r) => r.status === 'ATENCAO').length}</b>
    </div>
  );
}

/** Página de um setor que ainda não tem telas. */
export function EmPreparacao({ m }: { m: AppModule }) {
  return (
    <>
      <Header title={m.name} sub="Setor em preparação." />
      <div className="panel" style={{ maxWidth: 640 }}>
        <p style={{ marginTop: 0 }}>Este setor ainda não tem telas. Vamos montá-lo juntos: diga o que o setor controla hoje (e em quais planilhas), quem deve ter acesso e o que é mais urgente.</p>
        <Link className="btn" to="/">Voltar ao início</Link>
      </div>
    </>
  );
}
