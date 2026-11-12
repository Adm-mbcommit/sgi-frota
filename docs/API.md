# API (v1)

Base: `/api/v1`. Autenticação: `Authorization: Bearer <token>` (obtido em `/auth/login`).
Datas de calendário em `AAAA-MM-DD`; instantes em ISO 8601. Listas aceitam `?from=&to=` (período).

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| POST | /auth/login | — | `{email, password}` → `{token, user}` |
| GET | /auth/me | todos | Usuário e empresa |
| POST | /auth/change-password | todos | `{current, next}` |
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
| GET / PUT | /settings | todos / ADMIN | Parâmetros das regras |
| GET / POST / PATCH | /maintenance/plan | todos / ADMIN, GESTOR | Plano de manutenção |
| POST | /maintenance/plan/:id/records | ADMIN, GESTOR | Registrar serviço (sem custo) |
| GET | /maintenance/records | todos | Histórico de serviços (`source`: COMANDO_BORDO ou SGI; `costId` se veio de Custos) |
| GET / PUT | /documents, /documents/:vehicleId | todos / ADMIN, GESTOR | Documentos |
| GET / POST / PATCH / DELETE | /costs | todos / ADMIN, GESTOR | Custos. `maintenance: { km, planItemIds }` liga o custo a itens do plano e atualiza o prazo |
| GET / POST / PATCH | /tasks | todos / ADMIN, GESTOR | Pendências |
| POST | /imports/comando-bordo | ADMIN, GESTOR | Upload .xlsx (campo `file`) |
| POST | /imports/chronos | ADMIN, GESTOR | Upload .xlsx (campo `file`) |
| GET | /imports | todos | Histórico de importações |
| GET / POST / PATCH | /users | ADMIN | Usuários |
| GET | /audit | ADMIN | Auditoria |
| GET | /health (sem prefixo) | — | Saúde da API e do banco |

Erros: `{ error, message }` com 400 (validação, com `issues`), 401, 403, 404, 409 (duplicado) ou 500.
