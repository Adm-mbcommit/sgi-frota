import { describe, expect, it } from 'vitest';
import { mcCategory, mcVehicle, parseMaisControle } from '../src/maiscontrole.js';

const vs = [
  { id: 'v75', plate: 'QXI9C75', name: 'SAVEIRO - 75', aliases: ['QXI9675'] },
  { id: 'v55', plate: 'TPR0F55', name: 'SAVEIRO - 55', aliases: ['TRP0F55'] },
  { id: 'v21', plate: 'TPX8A21', name: 'SAVEIRO - 21', aliases: [] },
  { id: 'uno', plate: 'MFS7D92', name: 'UNO', aliases: [] },
];
const H = ['Índice', 'Data de Competência', 'Data de Vencimento', 'Data de Pagamento', 'Valor da Parcela', 'Valor em Aberto', 'Valor Pago da Parcela', 'Juros / Multas', 'Descontos', 'Valor Total Pago', 'Fornecedor', 'CNPJ / CPF do Fornecedor', 'Dados Bancários do Fornecedor', 'Descrição', 'Número do Documento', 'Categoria'];
const row = (comp: string, venc: string, val: number, forn: string, desc: string, doc: string, cat = 'Frota') => ['1', comp, venc, '', val, val, 0, 0, 0, 0, forn, '', null, desc, doc, cat];

describe('Mais Controle', () => {
  it('acha o veículo pela placa, pelo nome ou pelo apelido', () => {
    expect(mcVehicle('Combustível Placa QIX9C75 Saveiro', '2026-10-01', vs)).toBe('v75');
    expect(mcVehicle('Concerto Saveiro 21', '2026-09-25', vs)).toBe('v21');
    expect(mcVehicle('MFS7392 Reativação da Proteção - UNO', '2026-09-28', vs)).toBe('uno');
    expect(mcVehicle('IPVA Saveiro obras TPR0F55', '2026-01-27', vs)).toBe('v55');
    expect(mcVehicle('Licenciamento Saveiro escritório', '2026-01-27', vs)).toBe('v75');
    expect(mcVehicle('1ª revisão da saveiro nova', '2025-11-25', vs)).toBe('v55');
    expect(mcVehicle('seguro saveiros TPX/TPR', '2026-05-20', vs)).toBeNull();
    expect(mcVehicle('Pedágio', '2026-10-01', vs)).toBeNull();
  });
  it('classifica pelo texto', () => {
    expect(mcCategory('REVISAO SAVEIRO TPR0F55 Via Serra')).toBe('Manutenção');
    expect(mcCategory('Mensalidade de Seguro Zurich Minas Brasil')).toBe('Seguro');
    expect(mcCategory('Pedágio Planalto Sul')).toBe('Pedágios');
    expect(mcCategory('Lavação Saveiro 21')).toBe('Lavação');
    expect(mcCategory('VULCANIZACAO PNEU SAVEIRO')).toBe('Pneus');
    expect(mcCategory('Rastreador TPR0F55 - Saveiro Khronos')).toBe('Outros');
    expect(mcCategory('concerto do vidro traseiro saveiro obras - manutenção')).toBe('Conserto');
    expect(mcCategory('Manutenção na suspensão saveiro QXI9C75')).toBe('Manutenção');
  });
  it('lê as parcelas, tira o combustível e não repete a mesma parcela', () => {
    const r = parseMaisControle([H,
      row('01/06/2026', '09/07/2026', 200, 'Via Serra', 'REVISAO SAVEIRO TPR0F55', '186640'),
      row('01/06/2026', '11/08/2026', 200, 'Via Serra', 'REVISAO SAVEIRO TPR0F55', '186640'),
      row('01/06/2026', '11/08/2026', 200, 'Via Serra', 'REVISAO SAVEIRO TPR0F55', '186640'),
      row('07/10/2026', '11/12/2026', 231.61, 'Posto Elefantinho', 'Combustível Placa QIX9C75 Saveiro', '218309'),
      row('12/11/2026', '', 17.4, 'Pedágio', 'Pedágio', 'Cupom Fiscal'),
      row('12/11/2026', '', 50, 'X', 'Material', '1', 'Escritório'),
    ], vs);
    expect(r.skippedFuel).toBe(1);
    expect(r.skippedOther).toBe(1);
    expect(r.costs.map((c) => [c.date, c.amount, c.category, c.vehicleId, c.invoice])).toEqual([
      ['2026-06-01', 200, 'Manutenção', 'v55', '186640'], ['2026-06-01', 200, 'Manutenção', 'v55', '186640'], ['2026-11-12', 17.4, 'Pedágios', null, null],
    ]);
  });
});
