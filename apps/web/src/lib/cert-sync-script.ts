/**
 * Script (Google Apps Script) que lê as pastas das empresas no Drive e manda as CNDs ao SGI, uma vez por dia.
 *
 * Fica num projeto próprio (script.google.com → Novo projeto). Só lê o Drive: não move, não renomeia, não apaga.
 * 1) Pede ao SGI as pastas (GET …/certificates/sync/folders), 2) lista os PDFs de cada pasta e envia nome e link,
 * 3) se o SGI pedir (arquivo sem data no nome, ex.: falência), envia o PDF para o SGI ler a data no texto.
 */
export function certSyncScript(baseUrl: string, token: string) {
  return `/**
 * SGI Matias Brasil (Administrativo) — leitura automática das CNDs no Google Drive.
 * Todo dia às 7h lê as pastas das empresas e atualiza no SGI as certidões novas (só lê o Drive, não altera nada).
 * Para ativar: salve (ícone de disquete), escolha a função "instalarCertidoesSGI" e clique em Executar.
 * Para ler agora: escolha "lerCertidoesSGI" e clique em Executar.
 */
const SGI_URL = ${JSON.stringify(baseUrl)};
const SGI_CHAVE = ${JSON.stringify(token)};

function chamarSGI_(caminho, corpo) {
  const r = UrlFetchApp.fetch(SGI_URL + caminho, {
    method: corpo ? 'post' : 'get', contentType: 'application/json', headers: { 'X-Sync-Token': SGI_CHAVE },
    payload: corpo ? JSON.stringify(corpo) : undefined, muteHttpExceptions: true,
  });
  if (r.getResponseCode() >= 300) throw new Error('O SGI recusou (' + r.getResponseCode() + '): ' + r.getContentText());
  return JSON.parse(r.getContentText());
}

function lerCertidoesSGI() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60 * 1000)) return;
  try {
    const pastas = chamarSGI_('/folders');
    const arquivos = [];
    pastas.forEach(function (p) {
      const it = DriveApp.getFolderById(p.folderId).getFiles();
      while (it.hasNext()) {
        const f = it.next();
        if (f.getMimeType() !== 'application/pdf') continue;
        arquivos.push({ companyId: p.companyId, fileId: f.getId(), name: f.getName(), url: f.getUrl() });
      }
    });
    let r = chamarSGI_('', { files: arquivos });
    if (r.need.length) {
      const contents = {};
      r.need.forEach(function (id) { contents[id] = Utilities.base64Encode(DriveApp.getFileById(id).getBlob().getBytes()); });
      r = chamarSGI_('', { files: arquivos, contents: contents });
    }
    console.log(arquivos.length + ' PDFs lidos. Atualizadas: ' + (r.updated.map(function (u) { return u.file; }).join(', ') || 'nenhuma (nada novo)')
      + (r.unreadable.length ? '. Não consegui ler: ' + r.unreadable.join(', ') : ''));
  } finally {
    lock.releaseLock();
  }
}

function instalarCertidoesSGI() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'lerCertidoesSGI') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('lerCertidoesSGI').timeBased().everyDays(1).atHour(7).create();
  lerCertidoesSGI();
  console.log('Pronto! As certidões agora são lidas do Drive todo dia às 7h.');
}
`;
}
