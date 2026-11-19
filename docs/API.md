# API (v1)

Base: `/api/v1`. Autenticação: `Authorization: Bearer <token>` (obtido em `/auth/login`).
Datas de calendário em `AAAA-MM-DD`; instantes em ISO 8601. Listas aceitam `?from=&to=` (período).

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| POST | /auth/login | — | `{email, password}` → `{token, user}` |
| GET | /auth/me | todos | Usuário e empresa |
| POST | /auth/change-password | todos | `{current, next}` (mín. 10 caracteres, diferente da atual; auditado) |
| GET | /dashboard | todos | KPIs, veículos, alertas, gráficos |
| GET | /trips | todos | Viagens analisadas (`plate`, `problems=1`) |
| POST | /trips | ADMIN, GESTOR, MOTORISTA | Iniciar viagem |
| POST | /trips/:id/close | ADMIN, GESTOR, MOTORISTA | Encerrar viagem |
| PATCH | /trips/:id | ADMIN, GESTOR | Corrigir registro |
| GET / POST | /fuelings | todos / +MOTORISTA | Abastecimentos |
| GET | /speed-events | todos | Excessos (`all=1` para todos os eventos) |
| GET | /drivers/summary | todos | Atividade por motorista |
| GET | /quality | todos | Verificação dos dados |
| GET / POST / PATCH | /vehicles, /drivers, /stations | todos / ADMIN, GESTOR | Cadastros |
| GET / PUT | /settings | todos / ADMIN | Parâmetros das regras (PUT parcial; recusa `pMin ≥ pMax` e `kmlMin ≥ kmlMax`) |
| GET / POST / PATCH | /maintenance/plan | todos / ADMIN, GESTOR | Plano de manutenção |
| POST | /maintenance/plan/:id/records | ADMIN, GESTOR | Registrar serviço |
| GET | /maintenance/records | todos | Histórico de serviços |
| GET / PUT | /documents, /documents/:vehicleId | todos / ADMIN, GESTOR | Documentos |
| GET / POST / PATCH / DELETE | /costs | todos / ADMIN, GESTOR | Custos |
| GET / POST / PATCH | /tasks | todos / ADMIN, GESTOR | Pendências |
| POST | /imports/comando-bordo | ADMIN, GESTOR | Upload .xlsx (campo `file`) |
| POST | /imports/chronos | ADMIN, GESTOR | Upload .xlsx (campo `file`) |
| POST | /imports/comando-bordo/sync | chave `X-Sync-Token` (sem login) | Envio automático da planilha pelo Apps Script; sem mudança desde o último envio responde `{ unchanged: true }` |
| GET | /imports/sync | ADMIN | Situação da sincronização (ligada, última verificação/importação) |
| POST / DELETE | /imports/sync/token | ADMIN | Gera nova chave (mostrada só uma vez; a anterior deixa de valer) / desliga |
| GET | /imports | todos | Histórico de importações |
| GET / POST / PATCH | /users | ADMIN | Usuários |
| GET | /audit | ADMIN | Auditoria |
| GET | /health (sem prefixo) | — | Saúde da API e do banco |

Erros: `{ error, message }` com 400 (validação, com `issues`), 401, 403, 404, 409 (duplicado) ou 500.

## Minhas tarefas (cada usuário vê só as suas)

| Método | Rota | Perfil | Observação |
|---|---|---|---|
| GET | /my/tasks | todos | Abertas + feitas nos últimos 30 dias |
| POST | /my/tasks | todos | `{title, details?, person?, dueDate?}` |
| POST | /my/tasks/bulk | todos | `{tasks: [{title, details?, person?, status?}]}` (até 200; lista colada, lida por `parseTaskList` do core) |
| PATCH | /my/tasks/:id | todos | `{title?, details?, person?, dueDate?, status?}` (`A_FAZER`, `EM_ANDAMENTO`, `AGUARDANDO`, `FEITA`) |
| DELETE | /my/tasks/:id | todos | |
| GET | /my/routine | todos | Itens da rotina com `checked` do dia de hoje (America/Sao_Paulo) |
| POST | /my/routine | todos | `{title}` |
| DELETE | /my/routine/:id | todos | Desativa o item (marcações antigas ficam) |
| PUT | /my/routine/:id/check | todos | `{checked}` para hoje |

## Calendário

Feriados nacionais são calculados no front (`nationalHolidays` do `@sgi/core`, inclui Carnaval e Corpus Christi como ponto facultativo).

| Método | Rota | Perfil | Observação |
|---|---|---|---|
| GET | /birthdays | todos | `{id, name, day, month}`; `year` só para ADMIN/GESTOR |
| POST / PATCH /:id / DELETE /:id | /birthdays | ADMIN, GESTOR | `{name, day, month, year?}`; nome único por empresa |
| POST | /birthdays/import | ADMIN, GESTOR | .xlsx com nome e data em qualquer coluna; atualiza quem já existe |
| GET | /appointments?from&to | todos | Compromissos do usuário + os da equipe (`shared`); `{id, date, time, title, notes, shared, mine, owner}` |
| POST / PATCH /:id / DELETE /:id | /appointments | todos | `{date, time?, title, notes?, shared?}`; só quem criou altera ou exclui |

## Administrativo: certidões (CNDs)

| Método | Rota | Perfil | Observação |
|---|---|---|---|
| GET | /certificates | ADMIN, GESTOR, LEITOR | `{today, kinds, companies: [{…empresa, certificates: [{kind, issuedOn, expiresOn, expiryEstimated, alertDays, link, days, status}]}]}` — os 6 tipos sempre aparecem |
| PUT | /certificates | ADMIN, GESTOR | `{companyId, kind, issuedOn?, expiresOn?, alertDays?, link?, notes?}`; cria ou renova a certidão do tipo |
| DELETE | /certificates/:id | ADMIN, GESTOR | |
| POST / PATCH /:id | /companies | ADMIN, GESTOR | `{shortName, name, cnpj, driveFolder?, active?}`; CNPJ único por organização |
| GET | /certificates/sync | ADMIN | `{configured, lastCheckAt, lastUpdateAt}` da leitura automática do Drive |
| POST / DELETE | /certificates/sync/token | ADMIN | Gera (devolve `{token}` uma vez) ou apaga a chave; hash em `settings.certSyncTokenHash` |
| GET | /certificates/sync/folders | chave `X-Sync-Token` | Pastas do Drive das empresas ativas `[{companyId, shortName, folderId}]` |
| POST | /certificates/sync | chave `X-Sync-Token` | `{files: [{companyId, fileId, name, url}], contents?: {fileId: base64}}` → `{need, updated, unreadable}`; `need` = PDFs sem data no nome que a API quer ler |

## Manutenção (complemento)

| Método | Rota | Perfil | Observação |
|---|---|---|---|
| POST | /maintenance/plan/copy | ADMIN, GESTOR | `{fromVehicleId, toVehicleId, lastKm?, lastDate?}` copia itens e intervalos; mantém os que o destino já tem |
| GET | /maintenance/hints | todos | Serviços de Custos/checklist ainda não lançados no histórico |
| POST | /maintenance/hints/dismiss | ADMIN, GESTOR | `{key}` tira uma sugestão da lista |
| POST | /maintenance/plan/:id/records | ADMIN, GESTOR | aceita `costId` (liga a um custo existente); responde `updatedPlan` (false = serviço mais antigo, só histórico) |
| POST | /imports/gestao-frota | ADMIN, GESTOR | .xlsx "Gestão Frota MATIAS" (abas Manutencoes e Custos); reimportação segura |
| GET / PUT | /documents/:vehicleId | todos / ADMIN, GESTOR | Datas dos documentos e `links` dos PDFs `{crlv, ipva, licensing, insurance}` (https; vazio apaga) |
| POST | /imports/mais-controle | ADMIN, GESTOR | .xlsx "Pagamentos" do Mais Controle: custos da Frota (sem combustível), uma linha por parcela (`external_key`), substitui o mesmo serviço lançado antes por outra fonte |

