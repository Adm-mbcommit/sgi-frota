# SGI Frota

Sistema de Gestão Interno da frota da **Matias Brasil Engenharia**. Evolução do artefato
"SGI Frota Matias" (página única no Claude) para uma aplicação web com banco de dados,
login por usuário e perfis de acesso, pronta para rodar em um servidor externo.

| Módulo | O que faz |
|---|---|
| Painel | KPIs do período (km, combustível, custo/km, excessos, alertas), cartões por veículo, ações necessárias, gráficos |
| Manutenção | Plano por km, data e ritmo de uso; registrar serviço reinicia o prazo e pode lançar o custo |
| Veículos / Motoristas / Documentos | Cadastros, apelidos de placa e de nome, CNH, CRLV/IPVA/licenciamento/seguro |
| Viagens / Abastecimentos / Velocidade | Registros do Comando de Bordo e do Chronos, com validação automática |
| Custos / Pendências | Custos além do combustível; lista de itens a confirmar e verificação da qualidade dos dados |
| Importações | Upload das planilhas (.xlsx) do Comando de Bordo e do Chronos, idempotente |
| Usuários | Contas e perfis (Administrador, Gestor, Motorista, Leitura) |

## Estrutura

```
sgi-frota/
├─ packages/core/     Regras de negócio puras (TypeScript, sem I/O) + testes de paridade
├─ apps/api/          API REST: Fastify + PostgreSQL (Drizzle ORM), JWT, importadores
│  ├─ src/db/         schema, migrações, seed, criação de usuário
│  ├─ src/modules/    rotas por domínio
│  ├─ src/importers/  Comando de Bordo, Chronos, leitura de .xlsx
│  └─ drizzle/        migrações SQL versionadas
├─ apps/web/          Front-end: React + Vite + TanStack Query
├─ api/index.mjs      Função Serverless da Vercel (aponta para a API compilada)
├─ scripts/           Build da Vercel (compila, migra o banco, carga inicial)
├─ infra/             Alternativa: Docker Compose, Caddy (HTTPS), backup
├─ legacy/            Artefato original e snapshot de dados (11/11/2026)
└─ docs/              Arquitetura, regras de negócio, implantação, roadmap, API
```

## Rodar localmente

Requisitos: Node 22+ e PostgreSQL 16 (ou Docker).

```bash
npm install
npm run db:up                          # sobe o Postgres no Docker (ou use um local)
cp apps/api/.env.example apps/api/.env # ajuste JWT_SECRET e a senha do admin
npm run db:migrate
npm run db:seed                        # carrega o snapshot do artefato + usuário admin
npm run dev                            # API em :3333, web em http://localhost:5173
```

Testes: `npm test` (os de integração da API rodam quando `TEST_DATABASE_URL` aponta para um banco descartável).

## Documentação

- [Arquitetura](docs/ARQUITETURA.md)
- [Regras de negócio](docs/REGRAS-DE-NEGOCIO.md) — inclui a conferência com o artefato original
- [Implantação na Vercel](docs/DEPLOY.md) (e alternativa com Docker)
- [API](docs/API.md)
- [Roadmap](docs/ROADMAP.md)
