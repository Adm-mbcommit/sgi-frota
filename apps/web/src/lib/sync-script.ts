/**
 * Script (Google Apps Script) que envia a planilha do Comando de Bordo ao SGI.
 *
 * Fica num projeto SEPARADO (script.google.com → Novo projeto), e não em Extensões → Apps Script
 * da planilha: o projeto da planilha já tem o sistema do QR Code dos veículos e do ponto (doGet,
 * index.html, gatilhos), que não pode ser alterado. Por isso os nomes têm o sufixo SGI e o
 * instalador só remove os gatilhos da própria função.
 * Os registros chegam pelo app do QR Code (gravação por script, que não dispara onEdit/onChange),
 * então o envio é por tempo: a cada 10 minutos. Envios sem novidade são ignorados pela API.
 * O comentário com DriveApp é proposital: faz o Google pedir a permissão de ler o arquivo para exportá-lo.
 */
export function sheetIdFromUrl(s: string) {
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/) ?? s.trim().match(/^([a-zA-Z0-9_-]{20,})$/);
  return m?.[1] ?? null;
}

export function syncScript(url: string, token: string, sheetId: string) {
  return `/**
 * SGI Matias Brasil (módulo Frota) — envio automático do Comando de Bordo (projeto separado da planilha).
 * Envia a planilha ao SGI a cada 10 minutos. Não altera a planilha nem o sistema do QR Code.
 * Para ativar: salve (ícone de disquete), escolha a função "instalarSGI" e clique em Executar.
 * Para enviar na hora: escolha "enviarParaSGI" e clique em Executar.
 * Necessário para exportar a planilha: DriveApp.getFiles()
 */
const SGI_URL = ${JSON.stringify(url)};
const SGI_CHAVE = ${JSON.stringify(token)};
const SGI_PLANILHA_ID = ${JSON.stringify(sheetId)};

function enviarParaSGI() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60 * 1000)) return; // já há um envio em andamento
  try {
    const xlsx = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + SGI_PLANILHA_ID + '/export?format=xlsx', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    }).getBlob().setName('comando-bordo.xlsx');
    const r = UrlFetchApp.fetch(SGI_URL, {
      method: 'post', headers: { 'X-Sync-Token': SGI_CHAVE }, payload: { file: xlsx }, muteHttpExceptions: true,
    });
    if (r.getResponseCode() >= 300) throw new Error('O SGI recusou o envio (' + r.getResponseCode() + '): ' + r.getContentText());
    console.log('SGI: ' + r.getContentText());
  } finally {
    lock.releaseLock();
  }
}

function instalarSGI() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'enviarParaSGI') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarParaSGI').timeBased().everyMinutes(10).create();
  enviarParaSGI();
  console.log('Pronto! A planilha agora é enviada ao SGI a cada 10 minutos.');
}
`;
}
