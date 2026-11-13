/** Início do SGI Matias Brasil: os setores e um resumo de cada um. */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePeriod } from '../lib/period';
import type { Dashboard } from '../lib/types';
import { Header } from '../components/ui';
import { MODULES, type AppModule } from '../modules';

export default function Inicio() {
  const { me } = useAuth();
  return (
    <>
      <Header title={`Olá, ${me?.user.name.split(' ')[0] ?? ''}`} sub="SGI Matias Brasil · escolha um setor." />
      <div className="cards">{MODULES.map((m) => <ModuleCard key={m.id} m={m} />)}</div>
    </>
  );
}

function ModuleCard({ m }: { m: AppModule }) {
  return (
    <article className={'vc modcard' + (m.soon ? ' soon' : '')}>
      <header><h3>{m.name}</h3>{m.soon && <span className="chip">Em breve</span>}</header>
      <p className="note" style={{ margin: 0 }}>{m.about}</p>
      {m.id === 'frota' && <FrotaSummary />}
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
