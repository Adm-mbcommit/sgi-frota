/**
 * Administrativo → Certidões (CNDs): empresas do grupo e a certidão vigente de cada tipo, com a situação do
 * vencimento (regra em @sgi/core: certificateStatus). ADMIN, GESTOR e LEITOR consultam; ADMIN e GESTOR alteram.
 */
import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { CERT_KIND_INFO, CERT_KINDS, certificateStatus, localDate, suggestedExpiry, type CertKind } from '@sgi/core';
import { certificates, companies } from '../db/schema.js';
import { HttpError, isoDate, notFound, parse, uuid } from '../plugins/http.js';
import { WRITE_ROLES } from '../plugins/auth.js';
import { audit } from '../services/audit.js';

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
}
