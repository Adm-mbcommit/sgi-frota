# Arquitetura

Na Vercel (produção):

```
 navegador ──HTTPS──▶ Vercel ──▶ arquivos estáticos (apps/web/dist)
                         └─/api/*──▶ Função Serverless (Fastify) ──▶ PostgreSQL (Neon)
                                          └─ @sgi/core (regras)
```

Em servidor próprio (alternativa): Caddy (HTTPS) → nginx (web) → API Fastify → PostgreSQL.

## Decisões

| Tema | Escolha | Por quê |
|---|---|---|
| Linguagem | TypeScript em tudo | Um só idioma no front, na API e nas regras; tipos compartilhados |
| Regras de negócio | Pacote `@sgi/core` puro | Testável sem banco; a mesma lógica pode rodar no navegador ou em um job |
| API | Fastify 5 | Rápido, com plugins maduros (JWT, CORS, rate limit, multipart, helmet) |
| Banco | PostgreSQL 16 + Drizzle ORM | Relacional, transações, migrações SQL versionadas, sem binários externos |
| Front | React + Vite + TanStack Query | Cache e revalidação automática; build estático servido por nginx |
| Autenticação | JWT (Bearer), senha com bcrypt (custo 12) | Simples para web e para um futuro app do motorista |
| Implantação | Vercel + Neon (Postgres) | Sem servidor para manter; HTTPS, domínio e deploy a cada push. Docker + Caddy como alternativa |

## Multiempresa

Toda tabela de negócio tem `organization_id`, e toda consulta filtra pelo `org` do token.
Hoje existe uma empresa; atender outra é cadastrar uma nova `organization` e seus usuários.

## Perfis de acesso

| Perfil | Pode |
|---|---|
| ADMIN | Tudo, inclusive usuários, parâmetros e auditoria |
| GESTOR | Cadastros, manutenção, documentos, custos, pendências, importações e correção de registros |
| MOTORISTA | Consultar e registrar/encerrar as **próprias** viagens e abastecimentos |
| LEITOR | Somente consulta |

## Dados importados

Cada viagem, abastecimento e checklist guarda o texto original (`plate_raw`, `driver_raw`,
`km_start_raw`…) e o valor normalizado (`vehicle_id`, `driver_id`, `km_start`). Assim:

- uma grafia nova de placa ou motorista pode ser cadastrada como apelido e reprocessada;
- a reimportação é idempotente: a chave `external_key` (hash de saída + placa + motorista)
  atualiza a mesma linha quando a viagem é encerrada depois.

## Fluxo de cálculo

`services/fleet.ts` carrega os dados da empresa, converte para as entradas de `@sgi/core` e chama
`analyzeFleet(dados, parâmetros, período)`. Para o volume atual (centenas a poucos milhares de linhas)
o cálculo completo por requisição leva milissegundos. Se crescer muito, o próximo passo é
filtrar por janela de datas na consulta e/ou guardar o resultado em cache por empresa.

## Auditoria

Toda alteração feita pela API grava em `audit_log` (quem, quando, o quê). Consulta em `GET /api/v1/audit` (ADMIN).

## Fuso horário

Instantes em `timestamptz` (UTC). Horários sem fuso vindos das planilhas são interpretados como
America/Sao_Paulo. Vencimentos e datas de serviço são `date` (sem fuso). "Hoje" e os filtros de período
usam o calendário de São Paulo.
