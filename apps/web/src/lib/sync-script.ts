/**
 * Script (Google Apps Script) que a planilha do Comando de Bordo usa para enviar os dados ao SGI.
 * O administrador cola este texto em Extensões → Apps Script, salva e executa "instalar".
 * O comentário com DriveApp é proposital: faz o Google pedir a permissão de ler o arquivo para exportá-lo.
 */
export function syncScript(url: string, token: string) {
  return `/**
 * SGI Frota — envio automático do Comando de Bordo.
 * Envia a planilha ao SGI quando um formulário é respondido e a cada 30 minutos.
 * Para ativar: salve (ícone de disquete), escolha a função "instalar" e clique em Executar.
 * Necessário para exportar a planilha: DriveApp.getFiles()
 */
const SGI_URL = ${JSON.stringify(url)};
const SGI_CHAVE = ${JSON.stringify(token)};

function enviarParaSGI() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60 * 1000)) return; // já há um envio em andamento
  try {
    const id = SpreadsheetApp.getActiveSpreadsheet().getId();
    const xlsx = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx', {
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

function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('enviarParaSGI').forSpreadsheet(SpreadsheetApp.getActive()).onFormSubmit().create();
  ScriptApp.newTrigger('enviarParaSGI').timeBased().everyMinutes(30).create();
  enviarParaSGI();
  SpreadsheetApp.getActive().toast('Pronto! A planilha agora envia os dados ao SGI automaticamente.', 'SGI Frota', 10);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('SGI Frota').addItem('Enviar ao SGI agora', 'enviarParaSGI').addToUi();
}
`;
}
