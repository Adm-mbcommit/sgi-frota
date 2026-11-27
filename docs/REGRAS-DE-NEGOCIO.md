# Regras de negócio

Implementadas em `packages/core`. Os parâmetros (tabela abaixo) ficam em `organizations.settings`
e podem ser alterados pelo administrador em `PUT /api/v1/settings`.

| Parâmetro | Padrão | Uso |
|---|---|---|
| `empresa` | Matias Brasil | Só registros com esta empresa entram nos cálculos |
| `win` | 15.000 km | Faixa aceita em torno do km de referência do veículo |
| `maxTrip` | 2.500 km | Km máximo plausível em uma viagem |
| `tripH` | 24 h | Duração máxima plausível de uma viagem |
| `jump` | 5 km | Salto máximo entre o km final de uma viagem e o inicial da próxima |
| `maxL` | 80 L | Litros máximos em um abastecimento |
| `pMin`–`pMax` | R$ 4–10 | Faixa plausível de preço por litro |
| `kmlMin`–`kmlMax` | 5–20 km/L | Faixa plausível de consumo |
| `speed` | 100 km/h | Limite para contar excesso de velocidade |
| `kmAlert` | 1.500 km | Manutenção entra em ATENÇÃO (1º aviso: 🟡 agendar) |
| `kmAlert2` | 1.000 km | 2º aviso: 🟠 confirmar agendamento |
| `kmAlert3` | 500 km | 3º aviso: 🔴 urgente |
| `dayAlert` | 30 dias | Manutenção entra em ATENÇÃO (por data ou pela previsão de uso) |
| `docDays` | 60 dias | Documentos e CNH entram em PRÓXIMO |
| `paceDays` | 60 dias | Janela do ritmo de uso (km/dia) |

## Viagens

Processadas em ordem cronológica.

- **Início válido**: empresa própria, km inicial > 0 e a até `win` do km de referência.
- **Viagem válida** (entra nos km): início válido, km final presente, 0 ≤ km rodados ≤ `maxTrip`, km final na faixa.
- **Salto de odômetro**: km inicial − maior km final válido anterior do veículo; alerta se |salto| > `jump`.
- **Km atual do veículo**: maior entre os km finais válidos e os km iniciais com início válido.
- **Ritmo de uso**: soma dos km válidos nos últimos `paceDays` dias ÷ `paceDays`.
- **Km rodados por mês** (Painel, `monthlyKm`): soma dos km das viagens válidas da empresa pelo mês do início da
  viagem (horário de Brasília), por veículo; do primeiro mês com viagem válida até o mês atual, no máximo 12 meses.
- **Problemas** sinalizados: outra empresa, placa desconhecida, km inicial inválido/zerado/fora da faixa,
  viagem não encerrada, km final inválido/menor/fora da faixa, km acima do plausível, duração acima do limite, salto.

## Abastecimentos

- **Preço/L** = valor total ÷ litros.
- **Válido**: empresa própria, placa conhecida, litros em (0, `maxL`], preço/L na faixa, km na faixa.
- **Consumo**: km desde o abastecimento válido anterior ÷ litros, só quando o tanque foi completado.
- Consumo do veículo no período = Σ km ÷ Σ litros dos abastecimentos com consumo calculado.

## Velocidade

Eventos do Chronos com velocidade máxima > `speed`. O motorista é o da viagem da empresa em andamento
naquele horário (saída ≤ evento ≤ chegada; viagem sem chegada vale por 24 h).

## Uso dos veículos (rastreador)

Tela Frota → Uso dos veículos (`analyzeUsage` em `packages/core/src/usage.ts`), a partir do relatório
"Períodos de utilização (BDV)" do Chronos. Cada linha = um período de motor ligado ("viagem do rastreador").
A importação guarda também a coluna de distância (`distance_km`); reimportar o mesmo arquivo completa o km
de linhas antigas, sem duplicar.

- **Fora do expediente**: viagem iniciada antes de `workStart` (6,5 = 06h30), a partir de `workEnd`
  (19,5 = 19h30) ou no sábado/domingo. Horários em Gestão → Parâmetros.
- **Velocidade**: conta acima de `speed` (parâmetro), de 120 e de 140 km/h.
- **Parada**: intervalo entre o fim de uma viagem e o início da próxima no **mesmo dia**, no endereço final
  da viagem; dividida em horas dentro e fora do expediente. Parada longa = 3 h ou mais fora da base.
- **Pernoite**: a última viagem do dia termina fora da base e a próxima começa em outro dia; conta uma noite
  por dia de calendário. Base = endereço que contém "Brasília, 201" (sem acento/maiúsculas; `USAGE_BASE`).
- **Dias úteis parado**: segunda a sexta do período sem nenhuma viagem (feriados não são descontados).
- O relatório não identifica o motorista.

## Manutenção

Para cada item do plano: próxima = último km + intervalo km; vencimento = última data + intervalo em meses.

| Status | Quando |
|---|---|
| CONFIRMAR | O último serviço ainda não foi confirmado |
| SEM DADO | Não há intervalo/último serviço suficiente para calcular |
| VENCIDO | Km restante < 0 ou vencimento passou |
| ATENÇÃO | Km restante ≤ `kmAlert`, ou faltam ≤ `dayAlert` dias, ou a previsão pelo ritmo de uso é ≤ `dayAlert` dias |
| OK | Nenhum dos anteriores |

Registrar um serviço (`POST /maintenance/plan/:id/records`) grava o histórico, atualiza último km/data,
tira o CONFIRMAR e, se houver valor, lança o custo em Custos.

### Agenda das revisões (alertas)

`@sgi/core` → `maintenance.ts`:
- **Data esperada** de cada item = a mais cedo entre a data limite (última data + meses) e a data em que o veículo
  deve chegar ao km da próxima pelo ritmo de uso (`forecastDays`). Km já ultrapassado = hoje.
- Itens do mesmo veículo com a mesma situação, km e data vencem juntos e aparecem num só alerta (`groupDue`). Na tela,
  itens com a mesma situação e o mesmo km da próxima também se juntam, mesmo que só alguns vençam por data (vale a mais cedo).
- Itens sem km/data da última vez (SEM DADO) não geram alerta; a tela de Manutenção lista esses itens e permite
  informar a última revisão de vários de uma vez. Também é possível copiar o plano de outro veículo
  (`POST /maintenance/plan/copy`).
- **Serviços já feitos** (`GET /maintenance/hints`): custos da categoria Manutenção (tela Custos) e observações do
  checklist dos motoristas que citam serviço, ainda sem registro no histórico. Custos do mesmo veículo e dia viram uma
  sugestão; o km é estimado pelas viagens do dia (`kmOnDate`). "Lançar no plano" grava no histórico ligado ao custo
  (sem duplicar o valor); "Não é revisão" tira da lista.
- Um serviço lançado só recomeça o prazo do item se for **mais recente** que o último registrado; senão fica só no histórico.
- **Planilha Gestão Frota** — deixou de ser usada em 17/11/2026; os dados dela já foram gravados (migração 0006). O botão
  de importação continua disponível (`POST /imports/gestao-frota`, em Manutenção): a aba *Manutencoes* traz o km da
  **próxima revisão** de cada veículo, que vira a base dos itens de revisão do plano (Revisão geral, Troca do óleo,
  Filtro do óleo: último km = próxima − intervalo; data = a da linha ou a revisão mais recente da aba *Custos*).
  A aba *Custos* entra em Custos sem duplicar (veículo, data e descrição) e as revisões viram registros no histórico.
- **Avisos por km em degraus** (`kmAlertLevel`): faltando ≤ `kmAlert`, ≤ `kmAlert2` e ≤ `kmAlert3` km o alerta muda de
  nível (🟡 → 🟠 → 🔴); os três valores são ajustáveis em Parâmetros e precisam ir diminuindo.
- Na tela, os itens CONFIRMAR ficam num cartão por veículo ("Para conferir"), separados dos alertas; o histórico
  mostra uma linha por visita à oficina (veículo + dia), com os itens feitos.
- As revisões previstas aparecem no Calendário (🔧; vencidas no dia de hoje) e o Início mostra vencidas, perto de
  vencer e para conferir.

## Custos vindos do Mais Controle

`@sgi/core` → `maiscontrole.ts` + `importers/maiscontrole.ts` (Importações → Mais Controle):
- Relatório **Pagamentos** (Excel). Só a categoria Frota; **combustível fica de fora** (já vem do Comando de Bordo).
- Uma linha de custo por **parcela**, na data de competência; reimportar não duplica (`costs.external_key`).
- Veículo pela placa (inclusive erros como QIX9C75/MFS7392) ou pelo nome ("Saveiro 21", "Uno", "saveiro obras" = 55,
  "saveiro escritório" = 75). Sem veículo identificado (pedágio, seguro de mais de um carro) = custo da frota.
- Categoria pelo texto (revisão → Manutenção; conserto/vidro/lâmpada → Conserto; seguro, IPVA, pedágio, lavação…).
- Custos de outra fonte que são o **mesmo serviço** (mesmo veículo, até 3 dias, mesmo total ou ambos de manutenção)
  são substituídos; o histórico de manutenção passa a apontar para o custo do Mais Controle.
- Revisões com número na descrição ("2ª revisão") sugerem km = número × 10.000 ao lançar no plano.

## Documentos e CNH

Próximo vencimento = menor data entre CRLV, IPVA, licenciamento e seguro.
ATRASADO se já passou; PRÓXIMO se faltam ≤ `docDays` dias; OK caso contrário. A CNH segue a mesma regra.

## Certidões (CNDs) — Administrativo

Uma certidão vigente por tipo e empresa (tabela `certificates`; renovar = atualizar a linha, o histórico fica em `audit_log`).
Regra em `packages/core/src/certificates.ts` (`certificateStatus`):
VENCIDO se o vencimento já passou; ATENÇÃO se faltam ≤ dias de alerta; OK caso contrário; SEM DADO sem vencimento.

| Tipo | Órgão | Validade habitual | Alerta padrão |
|---|---|---|---|
| Federal | Receita Federal / PGFN | 180 dias | 30 dias antes |
| Estadual | SEF/SC | 180 dias | 30 dias antes |
| Municipal | Prefeitura de Lages | 30 dias | 10 dias antes |
| FGTS | Caixa (CRF) | 30 dias | 7 dias antes |
| Trabalhista | TST (CNDT) | 180 dias | 30 dias antes |
| Falência | TJSC | 90 dias (sem data impressa) | 15 dias antes |

O alerta de cada certidão pode ser mudado na tela (campo "Avisar quantos dias antes"). Sem vencimento informado,
o vencimento é a emissão + validade habitual e aparece como "(estimado)" — caso da falência do TJSC, que só informa
90 dias de autenticidade. A carga inicial (migração `0010_certidoes`) veio da pasta do Drive "DOCUMENTOS P/ LICITAÇÕES"
(subpastas Matias 26 e Matias 44), lida em 19/11/2026. As empresas Santos (Santos 47 e Santos 50) não entram no controle,
por decisão do usuário; se um dia precisar, cadastre-as em "Nova empresa".

**Leitura automática do Drive** (`parseCertificateName` e `parseCertificateText` no core): todo dia às 7h um Apps Script
lista os PDFs da pasta de cada empresa. Tipo e validade vêm do nome do arquivo (`CND FGTS - VAL 22.11.26.pdf`;
ano com 2 dígitos = 20xx). Sem data no nome (falência), a API lê o texto do PDF: "Válida até", "Validade: x a y" (FGTS),
"Número Validade N data" (Lages); emissão em "emitida às … de", "Emissão", "Data:". Entre vários arquivos do mesmo tipo
vale o de vencimento mais tarde, e só substitui o SGI se vencer **depois** do que já está gravado (um arquivo antigo
esquecido na pasta não desfaz uma renovação). Arquivos que não são CND (balanço, cartão CNPJ) são ignorados.

## Conferência com o artefato original

O teste de paridade rodou o `compute()` do artefato e o `@sgi/core` sobre o mesmo snapshot
(11/11/2026 10:49, período 01/09 a 11/11/2026). Resultado:

- **Idênticos**: km rodados (20.313), combustível (R$ 11.271,64), outros custos (R$ 9.799,24),
  custo/km, excessos (235), km atual, km no período, consumo, gasto e ritmo de cada veículo,
  status de todos os 44 itens do plano, documentos, atividade por motorista e 15 das 16 linhas da
  verificação de dados.
- **Correção de defeito**: "Observação cita desconto" dava 4 no original porque a busca pela palavra
  "desconto" também casava com o texto do problema "Preço/L fora da faixa (valor líquido de
  desconto…)". O novo código checa só a observação: 3.
- **Diferença intencional**: "viagens abertas" conta as viagens sem chegada (4), e não só as com
  status "Em uso" (3); inclui a viagem de 17/07 que nunca foi encerrada.
