import ExcelJS from 'exceljs';

/** Valor "plano" de uma célula do ExcelJS (texto de hyperlink, resultado de fórmula, rich text). */
export function cellValue(v: ExcelJS.CellValue): unknown {
  if (v == null) return null;
  if (v instanceof Date) {
    // ExcelJS devolve a hora "de parede" da planilha como se fosse UTC.
    return v.toISOString().slice(0, 19);
  }
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result as ExcelJS.CellValue);
    if ('hyperlink' in v) return (v as { hyperlink: string }).hyperlink;
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
    if ('text' in v) return (v as { text: string }).text;
    if ('error' in v) return null;
  }
  return v;
}

export async function readWorkbook(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

/** Linhas de uma aba como arrays (índice 0 = coluna A). Retorna null se a aba não existir. */
export function sheetRows(wb: ExcelJS.Workbook, name: string): unknown[][] | null {
  const ws = wb.worksheets.find((w) => w.name.trim().toLowerCase() === name.toLowerCase());
  if (!ws) return null;
  const out: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = (row.values as ExcelJS.CellValue[]).slice(1).map(cellValue);
    out.push(vals);
  });
  return out;
}
