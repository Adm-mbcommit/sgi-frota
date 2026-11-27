/**
 * Módulos (setores) do SGI Matias Brasil. Cada módulo tem um caminho próprio (/frota, /rh…)
 * e o seu menu. Para criar um setor novo: acrescente aqui e registre as rotas em main.tsx.
 */
import type { Role } from './lib/auth';

/** Item do menu: [caminho relativo ao módulo, rótulo, contador opcional] ou o título de um grupo. */
export type NavItem = string | { to: string; label: string; badge?: 'alerts' | 'tasks' | 'cnds' | 'checklist'; roles?: Role[]; hide?: Role[] };

export interface AppModule {
  id: string; name: string; path: string; nav: NavItem[];
  /** Frase curta mostrada no Início. */
  about: string;
  /** Setor ainda em preparação: aparece no menu e no Início, sem telas. */
  soon?: boolean;
}

export const MODULES: AppModule[] = [
  {
    id: 'frota', name: 'Frota', path: '/frota', about: 'Veículos, motoristas, viagens, abastecimentos, manutenção e custos.',
    nav: [
      { to: '', label: 'Painel' }, { to: 'manutencao', label: 'Manutenção', badge: 'alerts' },
      { to: 'veiculos', label: 'Veículos' }, { to: 'motoristas', label: 'Motoristas' }, { to: 'documentos', label: 'Documentos' },
      { to: 'checklist', label: 'Checklist periódico', badge: 'checklist', hide: ['MOTORISTA'] },
      'Registros',
      { to: 'viagens', label: 'Viagens' }, { to: 'abastecimentos', label: 'Abastecimentos' }, { to: 'velocidade', label: 'Velocidade' }, { to: 'uso', label: 'Uso dos veículos' }, { to: 'custos', label: 'Custos' },
      'Gestão',
      { to: 'pendencias', label: 'Pendências', badge: 'tasks' }, { to: 'importacoes', label: 'Importações' },
      { to: 'parametros', label: 'Parâmetros', hide: ['MOTORISTA'] },
    ],
  },
  {
    id: 'administrativo', name: 'Administrativo', path: '/administrativo', about: 'Certidões negativas (CNDs) das empresas, com alerta antes de vencer.',
    nav: [{ to: '', label: 'Certidões (CNDs)', badge: 'cnds', hide: ['MOTORISTA'] }],
  },
  { id: 'rh', name: 'RH', path: '/rh', about: 'Em preparação: vamos definir juntos o que este setor vai controlar.', soon: true, nav: [] },
];

/** Itens do sistema, comuns a todos os módulos. */
export const SYSTEM_NAV: NavItem[] = [{ to: '/usuarios', label: 'Usuários', roles: ['ADMIN'] }];

/** Caminhos antigos (antes dos módulos), para não quebrar favoritos. */
export const LEGACY_FROTA_PATHS = ['manutencao', 'veiculos', 'motoristas', 'documentos', 'checklist', 'viagens', 'abastecimentos', 'velocidade', 'uso', 'custos', 'pendencias', 'importacoes', 'parametros'];
