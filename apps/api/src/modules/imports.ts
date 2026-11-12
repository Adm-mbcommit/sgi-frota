/** Upload das planilhas do Comando de Bordo e do Chronos. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { auditLog, imports } from '../db/schema.js';
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

export default async function importRoutes(app: FastifyInstance) {
  const { db } = app;
  const write = { onRequest: [app.authenticate, app.requireRole(...WRITE_ROLES)] };

  app.post('/imports/comando-bordo', write, async (req) => {
    const { name, wb } = await upload(req);
    const get = (n: string) => { const r = sheetRows(wb, n); if (!r) throw new HttpError(400, 'sheet_missing', `Aba "${n}" não encontrada na planilha.`); return r.slice(1); };
    const R = await loadResolver(db, req.user.org);
    const stats = await importComandoBordo(db, req.user.org, R, { trips: get('Registros'), fuel: get('Abastecimentos'), check: sheetRows(wb, 'manutencao_diaria')?.slice(1) ?? [], maint: sheetRows(wb, 'Manutencao')?.slice(1) });
    const [imp] = await db.insert(imports).values({ organizationId: req.user.org, kind: 'COMANDO_BORDO', fileName: name, stats, userId: req.user.sub }).returning();
    await audit(db, req, 'import', 'comando_bordo', imp.id, stats);
    return { id: imp.id, ...stats };
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
