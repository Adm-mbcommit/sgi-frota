import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Dashboard } from '../lib/types';
import { usePeriod } from '../lib/period';

const NAV: (string | [string, string, string?])[] = [
  ['/', 'Painel'], ['/manutencao', 'Manutenção', 'alerts'], ['/veiculos', 'Veículos'], ['/motoristas', 'Motoristas'], ['/documentos', 'Documentos'],
  'Registros', ['/viagens', 'Viagens'], ['/abastecimentos', 'Abastecimentos'], ['/velocidade', 'Velocidade'], ['/custos', 'Custos'],
  'Gestão', ['/pendencias', 'Pendências', 'tasks'], ['/importacoes', 'Importações'],
];
const ROLE: Record<string, string> = { ADMIN: 'Administrador', GESTOR: 'Gestor', MOTORISTA: 'Motorista', LEITOR: 'Leitura' };

export default function Layout() {
  const { me, logout, can } = useAuth();
  const { qs } = usePeriod();
  const dash = useQuery({ queryKey: ['dashboard', qs], queryFn: () => api<Dashboard>('/dashboard?' + qs) });
  const badge: Record<string, number> = { alerts: dash.data?.kpis.maintenanceAlerts ?? 0, tasks: dash.data?.openTasks.length ?? 0 };
  const items = [...NAV, ...(can('MOTORISTA') ? [] : [['/parametros', 'Parâmetros'] as [string, string]]), ...(can('ADMIN') ? [['/usuarios', 'Usuários'] as [string, string]] : [])];
  return (
    <div className="app">
      <nav className="side" aria-label="Módulos">
        <div className="brand"><div className="logo"><img src="/logo.png" alt="Matias Brasil Engenharia" /></div><b>SGI Frota</b><span>Sistema de Gestão Interno</span></div>
        {items.map((it) => typeof it === 'string'
          ? <div className="grp" key={it}>{it}</div>
          : <NavLink key={it[0]} to={it[0]} end={it[0] === '/'} className={({ isActive }) => (isActive ? 'act' : '')}>{it[1]}{it[2] && badge[it[2]] ? <i>{badge[it[2]]}</i> : null}</NavLink>)}
        <div className="user"><b>{me?.user.name}</b><span>{ROLE[me?.user.role ?? ''] ?? ''} · {me?.organization.name}</span><NavLink to="/conta">Minha conta</NavLink><button onClick={logout}>Sair</button></div>
      </nav>
      <main className="main"><Outlet /></main>
    </div>
  );
}
