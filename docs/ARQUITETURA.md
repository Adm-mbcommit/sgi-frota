# Arquitetura

Na Vercel (produção):

```
 navegador ──HTTPS──▶ Vercel ──▶ arquivos estáticos (apps/web/dist)
                         └─/api/*──▶ Função Serverless (Fastify) ──▶ PostgreSQL (Neon)
                                          └─ @sgi/core (regras)
```

Em servidor próprio (alternativa): Caddy (HTTPS) → nginx (web) → API Fastify → PostgreSQL.

## Módulos (setores)

O SGI Matias Brasil é dividido em módulos, um por setor (Frota, e depois Administrativo, RH…).
No front, cada módulo é declarado em `apps/web/src/modules.ts` (nome, caminho e menu) e tem as rotas em
`/<módulo>/...`. Quando houver mais de um, o menu lateral mostra os setores no alto e só o menu do setor aberto.
Usuários e Minha conta ficam fora dos módulos. Na API, cada setor terá os seus arquivos em `src/modules/`
e as suas tabelas, sempre com `organization_id`.

## Decisões

| Tema | Escolha | Por quê |
|---|---|---|
| Linguagem | TypeScript em tudo | Um só idioma no front, na API e nas regras; tipos compartilhados |
| Regras de negócio | Pacote `@sgi/core` puro | Testável sem banco; a mesma lógica pode rodar no navegador ou em um job |
| API | Fastify 5 | Rápido, com plugins maduros (JWT, CORS, rate limit, multipart, helmet) |
| Banco | PostgreSQL 16 + Drizzle ORM | Relacional, transações, migrações SQL versionadas, sem binários externos |
| Front | React + Vite + TanStack Query | Cache e revalidação automática; build estático servido por nginx |
| Autenticação | JWT (Bearer), senha com bcrypt (custo 12) | Simples e suficiente para o sistema web |
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

## Sincronização automática com a planilha do Google

Em vez de uma conta de serviço do Google, um Apps Script do próprio dono da planilha
**Comando de Bordo - Veículos** empurra os dados.

> **Atenção:** o projeto Apps Script *da planilha* (Extensões → Apps Script) é o sistema do QR Code dos
> veículos e do ponto (`doGet`, `index.html`, gatilhos próprios). Não mexa nele. O script do SGI fica num
> **projeto separado** (script.google.com → Novo projeto) e lê a planilha pelo ID.

1. O ADMIN clica em *Importações → Sincronização automática → Ligar*. A API gera uma chave aleatória
   (`POST /imports/sync/token`) e guarda só o hash sha256 em `organizations.settings.syncTokenHash`.
   A tela monta o script (`apps/web/src/lib/sync-script.ts`) com o endereço da API e a chave.
2. O script é colado num projeto novo e a função `instalarSGI` cria um gatilho a cada 10 minutos
   (só remove gatilhos da própria função `enviarParaSGI`). Os registros chegam pelo app do QR Code, que grava
   por script e não dispara onEdit/onChange; por isso o envio é por tempo.
3. A cada gatilho o script exporta a planilha como .xlsx e envia para `POST /imports/comando-bordo/sync`
   com o cabeçalho `X-Sync-Token`. A API usa o mesmo importador do upload manual (idempotente por `external_key`).
4. Se o conteúdo das abas for igual ao último envio (hash em `settings.syncLastHash`), nada é gravado;
   só `syncLastCheckAt` é atualizado. Importações com novidade entram no histórico e no `audit_log` (sem usuário).

As chaves `sync*` de `settings` são internas e não aparecem em `GET /settings`.
Gerar nova chave invalida a anterior; *Desligar* apaga o hash.
