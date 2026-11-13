import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Dashboard } from '../lib/types';
import { usePeriod } from '../lib/period';
import { MODULES, SYSTEM_NAV, type NavItem } from '../modules';

const ROLE: Record<string, string> = { ADMIN: 'Administrador', GESTOR: 'Gestor', MOTORISTA: 'Motorista', LEITOR: 'Leitura' };

export default function Layout() {
  const { me, logout, can } = useAuth();
  const { qs } = usePeriod();
  const { pathname } = useLocation();
  const current = MODULES.find((m) => pathname === m.path || pathname.startsWith(m.path + '/'));
  const dash = useQuery({ queryKey: ['dashboard', qs], queryFn: () => api<Dashboard>('/dashboard?' + qs) });
  const badge: Record<string, number> = { alerts: dash.data?.kpis.maintenanceAlerts ?? 0, tasks: dash.data?.openTasks.length ?? 0 };
  const visible = (it: NavItem) => typeof it === 'string' || ((!it.roles || can(...it.roles)) && !(it.hide && can(...it.hide)));
  const link = (it: Exclude<NavItem, string>, base: string) => {
    const to = it.to.startsWith('/') ? it.to : base + (it.to ? '/' + it.to : '');
    return <NavLink key={to} to={to} end={!it.to} className={({ isActive }) => (isActive ? 'act' : '')}>{it.label}{it.badge && badge[it.badge] ? <i>{badge[it.badge]}</i> : null}</NavLink>;
  };
  const render = (items: NavItem[], base: string) => {
    const shown = items.filter(visible);
    // não mostra o título de um grupo que ficou sem itens
    return shown.filter((it, i) => typeof it !== 'string' || (shown[i + 1] && typeof shown[i + 1] !== 'string'))
      .map((it) => (typeof it === 'string' ? <div className="grp" key={base + it}>{it}</div> : link(it, base)));
  };
  const system = render(SYSTEM_NAV, '');
  return (
    <div className="app">
      <nav className="side" aria-label="Setores">
        <div className="brand"><div className="logo"><img src="/logo.png" alt="Matias Brasil Engenharia" /></div><b>SGI Matias Brasil</b><span>Sistema de Gestão Interno</span></div>
        <NavLink to="/" end className={({ isActive }) => 'top-link' + (isActive ? ' act' : '')}>Início</NavLink>
        <div className="grp">Setores</div>
        {MODULES.map((m) => {
          const open = current?.id === m.id && !m.soon;
          return (
            <div key={m.id} className={'modgrp' + (open ? ' open' : '')}>
              <NavLink to={m.path} className={'mod-link' + (current?.id === m.id ? ' act' : '')}>
                <span>{m.name}</span>{m.soon ? <em>em breve</em> : <small aria-hidden>{open ? '▾' : '▸'}</small>}
              </NavLink>
              {open && <div className="sub">{render(m.nav, m.path)}</div>}
            </div>
          );
        })}
        {system.length > 0 && <><div className="grp">Sistema</div>{system}</>}
        <div className="user"><b>{me?.user.name}</b><span>{ROLE[me?.user.role ?? ''] ?? ''} · {me?.organization.name}</span><NavLink to="/conta">Minha conta</NavLink><button onClick={logout}>Sair</button></div>
      </nav>
      <main className="main"><Outlet /></main>
    </div>
  );
}
