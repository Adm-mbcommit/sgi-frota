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
| `kmAlert` | 1.500 km | Manutenção entra em ATENÇÃO |
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

## Documentos e CNH

Próximo vencimento = menor data entre CRLV, IPVA, licenciamento e seguro.
ATRASADO se já passou; PRÓXIMO se faltam ≤ `docDays` dias; OK caso contrário. A CNH segue a mesma regra.

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
