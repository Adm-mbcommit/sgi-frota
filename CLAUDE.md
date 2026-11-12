# SGI Matias Brasil (antigo SGI Frota) — guia para o Claude

Sistema de gestão da frota da Matias Brasil Engenharia (4 veículos, ~8 motoristas).
Nasceu do artefato "SGI Frota Matias" (página única no Claude); `legacy/` guarda o original e o snapshot de dados.
Produção: https://sgi-frota.vercel.app (projeto Vercel `sgi-frota`, conta `adm-mbcommit`).

O usuário não é programador: explique em português simples, passo a passo, e diga onde clicar.
Interface, mensagens, documentação e commits em **português**; identificadores de código em inglês.

## Estrutura

- `packages/core` — regras de negócio puras (sem I/O). Toda regra de cálculo fica aqui.
  `test/parity.test.ts` compara com o `compute()` do artefato original: não quebre sem documentar.
- `apps/api` — Fastify 5 + PostgreSQL (Drizzle ORM), JWT, rotas em `src/modules/`, importadores em `src/importers/`.
  `src/vercel.ts` adapta a API para Função Serverless; `api/index.mjs` (raiz) aponta para o build.
- `apps/web` — React 18 + Vite + TanStack Query. Telas em `src/pages/`, componentes em `src/components/ui.tsx`.
  O visual (tokens CSS, tema claro/escuro) veio do artefato: `src/styles.css`.
- `docs/` — ARQUITETURA, REGRAS-DE-NEGOCIO (parâmetros e paridade), DEPLOY, API, ROADMAP. Atualize junto com o código.
- `infra/` — alternativa Docker + Caddy (não usada em produção).

## Comandos

```bash
npm install
npm run build -w @sgi/core        # a API e os testes importam o core compilado
npm run typecheck
npm test                          # testes da API só rodam com TEST_DATABASE_URL
TEST_DATABASE_URL=postgres://sgi:sgi@localhost:5432/sgi_frota_test npm test
npm run dev                       # API :3333 + web :5173 (precisa de apps/api/.env, ver .env.example)
npm run db:migrate && npm run db:seed
```

Neste ambiente de nuvem há PostgreSQL 16 local, mas ele pode parar entre comandos:
`service postgresql start` antes de usar. Usuário/senha locais `sgi`/`sgi`; bancos `sgi_frota` e `sgi_frota_test`
(recrie com `su postgres -c "psql -c 'CREATE DATABASE ... OWNER sgi'"` se não existirem).

## Banco e migrações

- Mudou `apps/api/src/db/schema.ts`? Gere a migração: `cd apps/api && npx drizzle-kit generate --name <nome>` e commite `drizzle/`.
- Toda tabela de negócio tem `organization_id`; toda consulta filtra por `req.user.org`.
- Dados importados guardam o texto original (`*_raw`) e o valor normalizado; reimportação é idempotente por `external_key`.
- Instantes em `timestamptz` (UTC); datas de calendário em `date` (string `YYYY-MM-DD`). Hora sem fuso das planilhas = America/Sao_Paulo.
- Alterações via API gravam em `audit_log` (`services/audit.ts`). Mantenha isso em rotas novas.

## Publicação (Vercel)

- Push na `main` → deploy de produção automático. Branches/PRs → deploy de preview (não mexe no banco).
- `scripts/vercel-build.mjs`: compila tudo; em produção aplica migrações e roda o seed usando `DATABASE_URL_UNPOOLED`.
- Variáveis no projeto: `DATABASE_URL*` (Neon), `JWT_SECRET`, `SEED_ADMIN_EMAIL`.
- **Cuidado:** se `SEED_ADMIN_PASSWORD` estiver definida, *todo* deploy redefine a senha do administrador para esse valor.
  Ela deve ficar **removida**; só use temporariamente para recuperar acesso, e apague depois.
- **Regra do usuário: toda mudança passa pelo preview antes.** Trabalhe sempre numa branch, acumule as alterações
  nela e mande o usuário testar no link de preview. Nunca faça push, merge ou pull request para a `main` sem ele
  pedir com todas as letras ("pode publicar"). Publique tudo de uma vez, não a cada alteração.
- Preview com banco separado: ligue na Vercel (Storage → banco Neon → criar branch de banco para Preview) e defina
  `MIGRATE_ON_PREVIEW=1` **só** depois de confirmar pela API que o preview tem um `DATABASE_URL` próprio
  (variável com `gitBranch`). Sem isso, o preview usa o banco de produção e não pode aplicar migrações.
- Esta sessão não acessa `*.vercel.app`; para verificar um deploy use a API da Vercel (estado e logs) e peça print ao usuário.

## Perfis

ADMIN (tudo, usuários, parâmetros, auditoria) · GESTOR (cadastros, manutenção, custos, importações, correções) ·
MOTORISTA (só as próprias viagens/abastecimentos) · LEITOR (consulta). Use `app.requireRole(...)` nas rotas
e `can(...)` no front.

## Próximos passos (docs/ROADMAP.md)

1. Telas de troca de senha (própria) e de parâmetros (`PUT /settings` já existe).
2. Sincronização automática com a planilha do Google Drive (Vercel Cron).
3. App do motorista (PWA) para substituir o formulário do Comando de Bordo.
4. Alertas por e-mail/WhatsApp; anexos (NF, CRLV); relatórios PDF/Excel.
