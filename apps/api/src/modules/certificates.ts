/**
 * Administrativo → Certidões (CNDs): empresas do grupo e a certidão vigente de cada tipo, com a situação do
 * vencimento (regra em @sgi/core: certificateStatus). ADMIN, GESTOR e LEITOR consultam; ADMIN e GESTOR alteram.
 *
 * Leitura automática do Drive: um Apps Script (gerado na tela, chave em settings.certSyncTokenHash) pede as pastas
 * das empresas (GET /certificates/sync/folders), lista os PDFs e envia nome/link (POST /certificates/sync).
 * O tipo e a validade saem do nome do arquivo; sem data no nome (falência), a API pede o PDF e lê o texto.
 * Só grava quando a certidão do arquivo vence depois da que está no SGI (nunca volta para uma mais antiga).
 */
import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { CERT_KIND_INFO, CERT_KINDS, certificateStatus, localDate, parseCertificateName, parseCertificateText, suggestedExpiry, type CertKind } from '@sgi/core';
import { auditLog, certificates, companies, organizations } from '../db/schema.js';
import { HttpError, isoDate, notFound, parse, uuid } from '../plugins/http.js';
import { WRITE_ROLES } from '../plugins/auth.js';
import { audit } from '../services/audit.js';
import { mergeSettings, newToken, orgByToken, sha256 } from '../services/settings.js';

const idParam = z.object({ id: uuid });
const optText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);
const link = z.string().trim().max(2000).nullable().optional().transform((v) => v || null)
  .refine((v) => !v || /^https:\/\//i.test(v), 'O link deve começar com https://');

const companyBody = z.object({
  shortName: z.string().trim().min(2, 'Informe o apelido.').max(60),
  name: z.string().trim().min(2, 'Informe a razão social.').max(200),
  cnpj: z.string().trim().regex(/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/, 'CNPJ inválido.')
    .transform((v) => v.replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')),
  driveFolder: link,
  active: z.boolean().optional(),
});

const syncBody = z.object({
  files: z.array(z.object({
    companyId: uuid, fileId: z.string().regex(/^[\w-]{10,100}$/), name: z.string().max(300),
    url: z.string().max(500).refine((v) => /^https:\/\/(drive|docs)\.google\.com\//.test(v), 'Link do Drive inválido.'),
  })).max(1000),
  /** PDFs pedidos pela API na resposta anterior (fileId → base64). */
  contents: z.record(z.string().max(8_000_000)).optional(),
});
export const folderIdFromUrl = (u: string | null) => u?.match(/\/folders\/([\w-]{10,})/)?.[1] ?? null;

async function pdfText(base64: string) {
  const { extractText, getDocumentProxy } = await import('unpdf'); // carregada só quando há PDF para ler
  const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(base64, 'base64')));
  return (await extractText(pdf, { mergePages: true })).text;
}

const certBody = z.object({
  companyId: uuid,
  kind: z.enum(CERT_KINDS),
  issuedOn: isoDate.nullable().optional(),
  expiresOn: isoDate.nullable().optional(),
  alertDays: z.number().int().min(0).max(365).nullable().optional(),
  link,
  notes: optText(1000),
});

export default async function certificateRoutes(app: FastifyInstance) {
  const { db } = app;
  const read = { onRequest: [app.authenticate, app.requireRole('ADMIN', 'GESTOR', 'LEITOR')] };
  const write = { onRequest: [app.authenticate, app.requireRole(...WRITE_ROLES)] };

  /** Sem vencimento informado, mas com emissão: usa a validade habitual do tipo (e marca como estimado). */
  const withExpiry = (b: z.infer<typeof certBody>) => {
    const estimated = !b.expiresOn && !!b.issuedOn;
    return {
      kind: b.kind, issuedOn: b.issuedOn ?? null, alertDays: b.alertDays ?? null, link: b.link, notes: b.notes,
      expiresOn: b.expiresOn ?? (b.issuedOn ? suggestedExpiry(b.kind, b.issuedOn) : null), expiryEstimated: estimated,
    };
  };
  const ownCompany = async (id: string, org: string) => {
    const [c] = await db.select({ id: companies.id }).from(companies).where(and(eq(companies.id, id), eq(companies.organizationId, org)));
    if (!c) throw notFound('Empresa');
  };

  /** Painel: empresas com as certidões e a situação de cada uma; tipos sem certidão aparecem como SEM_DADO. */
  app.get('/certificates', read, async (req) => {
    const today = localDate(Date.now());
    const cos = await db.select().from(companies).where(eq(companies.organizationId, req.user.org)).orderBy(asc(companies.shortName));
    const certs = await db.select().from(certificates).where(eq(certificates.organizationId, req.user.org));
    return {
      today,
      kinds: CERT_KINDS.map((k) => ({ kind: k, ...CERT_KIND_INFO[k] })),
      companies: cos.map((c) => ({
        ...c,
        certificates: CERT_KINDS.map((kind) => {
          const r = certs.find((x) => x.companyId === c.id && x.kind === kind);
          const alertDays = r?.alertDays ?? CERT_KIND_INFO[kind].alertDays;
          return {
            id: r?.id ?? null, kind, label: CERT_KIND_INFO[kind].label, issuedOn: r?.issuedOn ?? null, expiresOn: r?.expiresOn ?? null,
            expiryEstimated: r?.expiryEstimated ?? false, alertDays, customAlert: r?.alertDays != null, link: r?.link ?? null, notes: r?.notes ?? null,
            ...certificateStatus(r?.expiresOn ?? null, today, alertDays),
          };
        }),
      })),
    };
  });

  /** Grava a certidão de um tipo da empresa (cria ou renova a existente). */
  app.put('/certificates', write, async (req) => {
    const b = parse(certBody, req.body);
    await ownCompany(b.companyId, req.user.org);
    if (b.issuedOn && b.expiresOn && b.expiresOn < b.issuedOn) throw new HttpError(400, 'validation', 'O vencimento é anterior à emissão.');
    const v = withExpiry(b);
    const [r] = await db.insert(certificates).values({ ...v, companyId: b.companyId, organizationId: req.user.org })
      .onConflictDoUpdate({ target: [certificates.companyId, certificates.kind], set: v }).returning();
    await audit(db, req, 'upsert', 'certificate', r.id, { companyId: b.companyId, kind: b.kind as CertKind, issuedOn: r.issuedOn, expiresOn: r.expiresOn, link: r.link });
    return r;
  });

  app.delete('/certificates/:id', write, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const [r] = await db.delete(certificates).where(and(eq(certificates.id, id), eq(certificates.organizationId, req.user.org))).returning();
    if (!r) throw notFound('Certidão');
    await audit(db, req, 'delete', 'certificate', id, { companyId: r.companyId, kind: r.kind, expiresOn: r.expiresOn });
    return reply.code(204).send();
  });

  app.post('/companies', write, async (req, reply) => {
    const b = parse(companyBody, req.body);
    const [c] = await db.insert(companies).values({ ...b, active: b.active ?? true, organizationId: req.user.org }).returning();
    await audit(db, req, 'create', 'company', c.id, { shortName: c.shortName, cnpj: c.cnpj });
    return reply.code(201).send(c);
  });

  app.patch('/companies/:id', write, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(companyBody, req.body);
    const [c] = await db.update(companies).set(b).where(and(eq(companies.id, id), eq(companies.organizationId, req.user.org))).returning();
    if (!c) throw notFound('Empresa');
    await audit(db, req, 'update', 'company', id, { shortName: c.shortName, cnpj: c.cnpj, active: c.active });
    return c;
  });

  /* ---- leitura automática da pasta do Drive ---- */
  const adminOnly = { onRequest: [app.authenticate, app.requireRole('ADMIN')] };
  const syncOrg = async (token: unknown) => {
    const o = await orgByToken(db, 'certSyncTokenHash', token);
    if (!o) throw new HttpError(401, 'sync_token', 'Chave inválida. Gere uma nova em Administrativo → Certidões.');
    return o;
  };

  app.get('/certificates/sync', adminOnly, async (req) => {
    const [o] = await db.select().from(organizations).where(eq(organizations.id, req.user.org));
    const st = (o?.settings ?? {}) as Record<string, string | null | undefined>;
    return { configured: !!st.certSyncTokenHash, lastCheckAt: st.certSyncLastCheckAt ?? null, lastUpdateAt: st.certSyncLastUpdateAt ?? null };
  });
  app.post('/certificates/sync/token', adminOnly, async (req) => {
    const token = newToken();
    await mergeSettings(db, req.user.org, { certSyncTokenHash: sha256(token), certSyncTokenCreatedAt: new Date().toISOString() });
    await audit(db, req, 'create', 'cert_sync_token', req.user.org);
    return { token };
  });
  app.delete('/certificates/sync/token', adminOnly, async (req, reply) => {
    await mergeSettings(db, req.user.org, { certSyncTokenHash: null });
    await audit(db, req, 'delete', 'cert_sync_token', req.user.org);
    return reply.code(204).send();
  });

  /** Pastas do Drive a ler (empresas ativas com o link da pasta). */
  app.get('/certificates/sync/folders', async (req) => {
    const o = await syncOrg(req.headers['x-sync-token']);
    const cos = await db.select().from(companies).where(and(eq(companies.organizationId, o.id), eq(companies.active, true)));
    return cos.map((c) => ({ companyId: c.id, shortName: c.shortName, folderId: folderIdFromUrl(c.driveFolder) })).filter((c) => c.folderId);
  });

  app.post('/certificates/sync', { bodyLimit: 12 * 1024 * 1024 }, async (req) => {
    const o = await syncOrg(req.headers['x-sync-token']);
    const b = parse(syncBody, req.body);
    const own = new Set((await db.select({ id: companies.id }).from(companies).where(eq(companies.organizationId, o.id))).map((c) => c.id));
    const current = await db.select().from(certificates).where(eq(certificates.organizationId, o.id));
    const need: string[] = [];
    const unreadable: string[] = [];
    type Cand = { companyId: string; kind: CertKind; expiresOn: string; issuedOn: string | null; expiryEstimated: boolean; url: string; name: string };
    const best = new Map<string, Cand>();
    for (const f of b.files) {
      if (!own.has(f.companyId)) continue;
      const p = parseCertificateName(f.name);
      if (!p) continue;
      const cur = current.find((c) => c.companyId === f.companyId && c.kind === p.kind);
      let cand: Cand | null = null;
      if (p.expiresOn) cand = { companyId: f.companyId, kind: p.kind, expiresOn: p.expiresOn, issuedOn: null, expiryEstimated: false, url: f.url, name: f.name };
      else if (cur?.link?.includes(f.fileId)) continue; // já lido antes
      else if (b.contents?.[f.fileId]) {
        try {
          const t = parseCertificateText(p.kind, await pdfText(b.contents[f.fileId]));
          if (t.expiresOn) cand = { companyId: f.companyId, kind: p.kind, expiresOn: t.expiresOn, issuedOn: t.issuedOn, expiryEstimated: t.expiryEstimated, url: f.url, name: f.name };
          else unreadable.push(f.name);
        } catch { unreadable.push(f.name); }
      } else { need.push(f.fileId); continue; }
      if (!cand) continue;
      const key = cand.companyId + cand.kind;
      const prev = best.get(key);
      if (!prev || cand.expiresOn > prev.expiresOn) best.set(key, cand);
    }
    const updated: { company: string; kind: string; expiresOn: string; file: string }[] = [];
    for (const c of best.values()) {
      const cur = current.find((x) => x.companyId === c.companyId && x.kind === c.kind);
      if (cur?.expiresOn && cur.expiresOn >= c.expiresOn) continue; // o SGI já tem uma igual ou mais nova
      const v = { expiresOn: c.expiresOn, issuedOn: c.issuedOn, expiryEstimated: c.expiryEstimated, link: c.url };
      const [r] = await db.insert(certificates).values({ ...v, organizationId: o.id, companyId: c.companyId, kind: c.kind })
        .onConflictDoUpdate({ target: [certificates.companyId, certificates.kind], set: v }).returning();
      await db.insert(auditLog).values({ organizationId: o.id, userId: null, action: 'sync', entity: 'certificate', entityId: r.id, data: { kind: c.kind, file: c.name, expiresOn: c.expiresOn, before: cur?.expiresOn ?? null } });
      updated.push({ company: c.companyId, kind: c.kind, expiresOn: c.expiresOn, file: c.name });
    }
    const now = new Date().toISOString();
    if (!need.length) await mergeSettings(db, o.id, { certSyncLastCheckAt: now, ...(updated.length ? { certSyncLastUpdateAt: now } : {}) });
    return { need, updated, unreadable };
  });
}
