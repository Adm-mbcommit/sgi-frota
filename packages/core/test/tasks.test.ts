import { describe, expect, it } from 'vitest';
import { parseTaskList } from '../src/tasks.js';

describe('parseTaskList', () => {
  it('lê tarefas, detalhes, pessoa e situação', () => {
    const r = parseTaskList(`
-> Fazer ordem de compra – entrada protocolo
→ Ver com João sobre as mesas @João
   ↳ fazer manutenção nos calços das aberturas de fios
↳ e conferir as tomadas
[aguardando] Ver sobre confraternização de final de ano @Diego
[feita] Mouse pad Diego

1. Ver com o Kleberson o vencimento dos certificados digitais @Kleberson
`);
    expect(r).toEqual([
      { title: 'Fazer ordem de compra – entrada protocolo', details: null, person: null, status: 'A_FAZER' },
      { title: 'Ver com João sobre as mesas', details: 'fazer manutenção nos calços das aberturas de fios; e conferir as tomadas', person: 'João', status: 'A_FAZER' },
      { title: 'Ver sobre confraternização de final de ano', details: null, person: 'Diego', status: 'AGUARDANDO' },
      { title: 'Mouse pad Diego', details: null, person: null, status: 'FEITA' },
      { title: 'Ver com o Kleberson o vencimento dos certificados digitais', details: null, person: 'Kleberson', status: 'A_FAZER' },
    ]);
  });
  it('e-mail no meio do texto não vira pessoa; detalhe sem tarefa vira tarefa', () => {
    expect(parseTaskList('Enviar para fulano@empresa.com.br hoje')[0].person).toBeNull();
    expect(parseTaskList('↳ solto')).toEqual([{ title: 'solto', details: null, person: null, status: 'A_FAZER' }]);
  });
});
