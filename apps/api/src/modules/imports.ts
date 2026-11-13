/**
 * Importação das planilhas do Comando de Bordo e do Chronos.
 * - Upload manual (.xlsx) pela tela Importações.
 * - Sincronização automática: um Apps Script na própria planilha do Google envia o .xlsx
 *   para POST /imports/comando-bordo/sync com o cabeçalho X-Sync-Token (chave gerada pelo ADMIN).
 *   A chave é guardada só como hash (sha256) em organizations.settings.syncTokenHash.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type ExcelJS from 'exceljs';
import { desc, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { auditLog, imports, organizations } from '../db/schema.js';
import { HttpError } from '../plugins/http.js';
import { WRITE_ROLES } from '../plugins/auth.js';
import { readWorkbook, sheetRows } from '../importers/xlsx.js';
import { importComandoBordo } from '../importers/comando-bordo.js';
import { ChronosFormatError, importChronos, mapChronos } from '../importers/chronos.js';
import { loadResolver } from '../services/resolver.js';
import { audit } from '../services/audit.js';

async function upload(req: FastifyRequest) {
  const file = await req.file();
  if (!file) throw new HttpError(400, 'file_required', 'Envie o arquivo .xlsx no campo "file".');
  if (!/\.xlsx$/i.test(file.filename)) throw new HttpError(400, 'file_type', 'Envie um arquivo .xlsx.');
  return { name: file.filename, wb: await readWorkbook(await file.toBuffer()) };
}

/** Lê as abas do Comando de Bordo; erro 400 se faltar uma aba obrigatória. */
function comandoBordoSheets(wb: ExcelJS.Workbook) {
  const get = (n: string) => { const r = sheetRows(wb, n); if (!r) throw new HttpError(400, 'sheet_missing', `Aba "${n}" não encontrada na planilha.`); return r.slice(1); };
  return { trips: get('Registros'), fuel: get('Abastecimentos'), check: sheetRows(wb, 'manutencao_diaria')?.slice(1) ?? [] };
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const SYNC_KIND = 'COMANDO_BORDO';
const SYNC_FILE = 'Sincronização automática (Google Planilhas)';

/** Grava campos em organizations.settings sem sobrescrever os demais (merge no próprio banco). */
const mergeSettings = (db: DB, orgId: string, patch: Record<string, unknown>) =>
  db.update(organizations).set({ settings: sql`${organizations.settings} || ${JSON.stringify(patch)}::jsonb` }).where(eq(organizations.id, orgId));

export default async function importRoutes(app: FastifyInstance) {
  const { db } = app;
  const write = { onRequest: [app.authenticate, app.requireRole(...WRITE_ROLES)] };
  const adminOnly = { onRequest: [app.authenticate, app.requireRole('ADMIN')] };

  app.post('/imports/comando-bordo', write, async (req) => {
    const { name, wb } = await upload(req);
    const sheets = comandoBordoSheets(wb);
    const R = await loadResolver(db, req.user.org);
    const stats = await importComandoBordo(db, req.user.org, R, sheets);
    const [imp] = await db.insert(imports).values({ organizationId: req.user.org, kind: 'COMANDO_BORDO', fileName: name, stats, userId: req.user.sub }).returning();
    await audit(db, req, 'import', 'comando_bordo', imp.id, stats);
    return { id: imp.id, ...stats };
  });

  /** Recebe a planilha enviada pelo Apps Script. Sem mudança desde o último envio, não grava nada. */
  app.post('/imports/comando-bordo/sync', async (req) => {
    const token = req.headers['x-sync-token'];
    if (typeof token !== 'string' || token.length < 20) throw new HttpError(401, 'sync_token', 'Chave de sincronização ausente.');
    const [o] = await db.select().from(organizations).where(sql`${organizations.settings}->>'syncTokenHash' = ${sha256(token)}`);
    if (!o) throw new HttpError(401, 'sync_token', 'Chave de sincronização inválida. Gere uma nova na tela Importações do SGI.');
    const { wb } = await upload(req);
    const sheets = comandoBordoSheets(wb);
    const hash = sha256(JSON.stringify(sheets));
    const now = new Date().toISOString();
    if (o.settings?.syncLastHash === hash) {
      await mergeSettings(db, o.id, { syncLastCheckAt: now });
      return { unchanged: true };
    }
    const R = await loadResolver(db, o.id);
    const stats = await importComandoBordo(db, o.id, R, sheets);
    const [imp] = await db.insert(imports).values({ organizationId: o.id, kind: SYNC_KIND, fileName: SYNC_FILE, stats }).returning();
    await db.insert(auditLog).values({ organizationId: o.id, userId: null, action: 'import', entity: 'comando_bordo_sync', entityId: imp.id, data: stats });
    await mergeSettings(db, o.id, { syncLastHash: hash, syncLastCheckAt: now, syncLastImportAt: now });
    return { id: imp.id, ...stats };
  });

  app.get('/imports/sync', adminOnly, async (req) => {
    const [o] = await db.select().from(organizations).where(eq(organizations.id, req.user.org));
    const st = o?.settings ?? {};
    return { configured: !!st.syncTokenHash, createdAt: st.syncTokenCreatedAt ?? null, lastCheckAt: st.syncLastCheckAt ?? null, lastImportAt: st.syncLastImportAt ?? null };
  });

  /** Gera uma nova chave (a anterior deixa de valer). A chave só é mostrada nesta resposta. */
  app.post('/imports/sync/token', adminOnly, async (req) => {
    const token = 'sgi_' + randomBytes(24).toString('base64url');
    await mergeSettings(db, req.user.org, { syncTokenHash: sha256(token), syncTokenCreatedAt: new Date().toISOString(), syncLastHash: null });
    await audit(db, req, 'create', 'sync_token', req.user.org);
    return { token };
  });

  app.delete('/imports/sync/token', adminOnly, async (req, reply) => {
    await mergeSettings(db, req.user.org, { syncTokenHash: null, syncLastHash: null });
    await audit(db, req, 'delete', 'sync_token', req.user.org);
    return reply.code(204).send();
  });

  app.post('/imports/chronos', write, async (req) => {
    const { name, wb } = await upload(req);
    const ws = wb.worksheets[0];
    const rows = ws ? sheetRows(wb, ws.name)! : [];
    const R = await loadResolver(db, req.user.org);
    const [imp] = await db.insert(imports).values({ organizationId: req.user.org, kind: 'CHRONOS', fileName: name, userId: req.user.sub }).returning();
    let mapped;
    try { mapped = mapChronos(rows, req.user.org, R, imp.id); }
    catch (e) { await db.delete(imports).where(eq(imports.id, imp.id)); if (e instanceof ChronosFormatError) throw new HttpError(400, 'format', e.message); throw e; }
    const stats = await importChronos(db, mapped);
    await db.update(imports).set({ stats }).where(eq(imports.id, imp.id));
    await audit(db, req, 'import', 'chronos', imp.id, stats);
    return { id: imp.id, ...stats };
  });

  app.get('/imports', { onRequest: [app.authenticate] }, async (req) =>
    db.select().from(imports).where(eq(imports.organizationId, req.user.org)).orderBy(desc(imports.at)).limit(100));

  app.get('/audit', { onRequest: [app.authenticate, app.requireRole('ADMIN')] }, async (req) =>
    db.select().from(auditLog).where(eq(auditLog.organizationId, req.user.org)).orderBy(desc(auditLog.at)).limit(500));
}
