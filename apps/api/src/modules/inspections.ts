/**
 * Frota → Checklist periódico: vistoria dos veículos com fotos, feita pela administração (quinzenal por padrão).
 * Não confundir com o checklist diário dos motoristas (tabela `checklists`, vinda do Comando de Bordo).
 *
 * ADMIN e GESTOR fazem e alteram; LEITOR consulta; MOTORISTA não vê.
 * Item marcado como PROBLEMA vira uma Pendência (tabela `tasks`) ligada ao veículo.
 * Fotos: o navegador reduz cada uma (~1600 px, JPEG) e envia uma por vez (POST /inspections/:id/photos);
 * ficam no próprio banco (inspection_photos.data) e são lidas com o token (GET /inspection-photos/:id).
 */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { FUEL_LEVELS, INSPECTION_ANSWERS, INSPECTION_ITEMS, INSPECTION_PHOTOS, inspectionStatus, inspectionSummary, localDate } from '@sgi/core';
import { inspectionPhotos, inspections, tasks, users, vehicles } from '../db/schema.js';
import { HttpError, isoDate, notFound, parse, uuid } from '../plugins/http.js';
import { WRITE_ROLES } from '../plugins/auth.js';
import { audit } from '../services/audit.js';
import { loadConfig } from '../services/fleet.js';

const idParam = z.object({ id: uuid });
const MAX_PHOTO = 6 * 1024 * 1024;
const MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const ITEM_BY_KEY = new Map(INSPECTION_ITEMS.map((i) => [i.key, i]));

const itemBody = z.object({
  key: z.string().max(60),
  /** Itens fora da lista padrão (acrescentados na hora) trazem o próprio nome. */
  label: z.string().trim().max(120).optional(),
  status: z.enum(INSPECTION_ANSWERS),
  note: z.string().trim().max(500).nullable().optional().transform((v) => v || null),
});
const body = z.object({
  vehicleId: uuid,
  date: isoDate,
  km: z.number().int().min(0).max(5_000_000).nullable().optional(),
  fuelLevel: z.enum(FUEL_LEVELS).nullable().optional(),
  items: z.array(itemBody).max(100),
  notes: z.string().trim().max(2000).nullable().optional().transform((v) => v || null),
});
const photoQuery = z.object({
  slot: z.string().refine((s) => INSPECTION_PHOTOS.some((p) => p.key === s), 'Posição da foto inválida.'),
  caption: z.string().trim().max(200).optional().transform((v) => v || null),
});

const normItems = (items: z.infer<typeof itemBody>[]) => items.map((i) => {
  const def = ITEM_BY_KEY.get(i.key);
  const label = def?.label ?? i.label;
  if (!label) throw new HttpError(400, 'validation', `Item sem nome: ${i.key}.`);
  return { key: i.key, label, group: def?.group ?? 'Outros', status: i.status, note: i.note ?? null };
});

export default async function inspectionRoutes(app: FastifyInstance) {
  const { db } = app;
  const read = { onRequest: [app.authenticate, app.requireRole('ADMIN', 'GESTOR', 'LEITOR')] };
  const write = { onRequest: [app.authenticate, app.requireRole(...WRITE_ROLES)] };

  const ownVehicle = async (id: string, org: string) => {
    const [v] = await db.select({ id: vehicles.id, name: vehicles.name }).from(vehicles).where(and(eq(vehicles.id, id), eq(vehicles.organizationId, org)));
    if (!v) throw notFound('Veículo');
    return v;
  };
  const ownInspection = async (id: string, org: string) => {
    const [r] = await db.select().from(inspections).where(and(eq(inspections.id, id), eq(inspections.organizationId, org)));
    if (!r) throw notFound('Checklist');
    return r;
  };
  /** Itens com PROBLEMA (que antes não estavam) viram pendências do veículo. */
  const openTasks = async (org: string, vehicleName: string, vehicleId: string, date: string, items: ReturnType<typeof normItems>, before: Set<string> = new Set()) => {
    const rows = items.filter((i) => i.status === 'PROBLEMA' && !before.has(i.key)).map((i) => ({
      organizationId: org, vehicleId, title: `${vehicleName}: ${i.label}`,
      description: `Checklist de ${date.split('-').reverse().join('/')}${i.note ? ': ' + i.note : ''}`,
    }));
    if (rows.length) await db.insert(tasks).values(rows);
    return rows.length;
  };

  /** Modelo do formulário: itens, fotos pedidas, níveis de combustível e o prazo. */
  app.get('/inspections/template', read, async (req) => {
    const cfg = await loadConfig(db, req.user.org);
    return { items: INSPECTION_ITEMS, photos: INSPECTION_PHOTOS, fuelLevels: FUEL_LEVELS, intervalDays: cfg.inspectionDays, alertDays: cfg.inspectionAlertDays };
  });

  /** Quadro: cada veículo ativo com a última vistoria e quando vence a próxima. */
  app.get('/inspections/board', read, async (req) => {
    const org = req.user.org;
    const cfg = await loadConfig(db, org);
    const today = localDate(Date.now());
    const vs = await db.select().from(vehicles).where(and(eq(vehicles.organizationId, org), eq(vehicles.active, true))).orderBy(vehicles.name);
    const last = await db.selectDistinctOn([inspections.vehicleId]).from(inspections).where(eq(inspections.organizationId, org))
      .orderBy(inspections.vehicleId, desc(inspections.date), desc(inspections.createdAt));
    const front = last.length ? await db.select({ id: inspectionPhotos.id, inspectionId: inspectionPhotos.inspectionId }).from(inspectionPhotos)
      .where(and(inArray(inspectionPhotos.inspectionId, last.map((l) => l.id)), eq(inspectionPhotos.slot, 'frente'))) : [];
    return {
      today, intervalDays: cfg.inspectionDays, alertDays: cfg.inspectionAlertDays,
      vehicles: vs.filter((v) => v.status !== 'INATIVO').map((v) => {
        const l = last.find((x) => x.vehicleId === v.id);
        return {
          vehicleId: v.id, name: v.name, plate: v.plate, model: v.model,
          last: l ? { id: l.id, date: l.date, km: l.km, ...inspectionSummary(l.items), photoId: front.find((f) => f.inspectionId === l.id)?.id ?? null } : null,
          ...inspectionStatus(l?.date ?? null, today, cfg.inspectionDays, cfg.inspectionAlertDays),
        };
      }),
    };
  });

  /** Histórico (mais recente primeiro), opcionalmente de um veículo. */
  app.get('/inspections', read, async (req) => {
    const q = parse(z.object({ vehicleId: uuid.optional() }), req.query);
    const rows = await db.select({
      i: inspections, vehicleName: vehicles.name, plate: vehicles.plate, userName: users.name,
      photos: sql<number>`(select count(*)::int from ${inspectionPhotos} p where p.inspection_id = ${inspections.id})`,
    }).from(inspections).innerJoin(vehicles, eq(vehicles.id, inspections.vehicleId)).leftJoin(users, eq(users.id, inspections.userId))
      .where(and(eq(inspections.organizationId, req.user.org), q.vehicleId ? eq(inspections.vehicleId, q.vehicleId) : undefined))
      .orderBy(desc(inspections.date), desc(inspections.createdAt)).limit(500);
    return rows.map(({ i, ...r }) => ({ id: i.id, vehicleId: i.vehicleId, date: i.date, km: i.km, fuelLevel: i.fuelLevel, notes: i.notes, ...r, ...inspectionSummary(i.items) }));
  });

  app.get('/inspections/:id', read, async (req) => {
    const { id } = parse(idParam, req.params);
    const i = await ownInspection(id, req.user.org);
    const [v] = await db.select({ name: vehicles.name, plate: vehicles.plate }).from(vehicles).where(eq(vehicles.id, i.vehicleId));
    const [u] = i.userId ? await db.select({ name: users.name }).from(users).where(eq(users.id, i.userId)) : [];
    const photos = await db.select({ id: inspectionPhotos.id, slot: inspectionPhotos.slot, caption: inspectionPhotos.caption, size: inspectionPhotos.size })
      .from(inspectionPhotos).where(eq(inspectionPhotos.inspectionId, id)).orderBy(inspectionPhotos.createdAt);
    return { ...i, vehicleName: v?.name, plate: v?.plate, userName: u?.name ?? null, photos };
  });

  app.post('/inspections', write, async (req, reply) => {
    const b = parse(body, req.body);
    const v = await ownVehicle(b.vehicleId, req.user.org);
    if (b.date > localDate(Date.now())) throw new HttpError(400, 'validation', 'A data do checklist não pode ser no futuro.');
    const items = normItems(b.items);
    const [r] = await db.insert(inspections).values({
      organizationId: req.user.org, vehicleId: b.vehicleId, date: b.date, km: b.km ?? null, fuelLevel: b.fuelLevel ?? null, items, notes: b.notes, userId: req.user.sub,
    }).returning();
    const created = await openTasks(req.user.org, v.name, v.id, b.date, items);
    await audit(db, req, 'create', 'inspection', r.id, { vehicleId: b.vehicleId, date: b.date, km: r.km, ...inspectionSummary(items), tasks: created });
    return reply.code(201).send({ ...r, tasksCreated: created });
  });

  app.patch('/inspections/:id', write, async (req) => {
    const { id } = parse(idParam, req.params);
    const cur = await ownInspection(id, req.user.org);
    const b = parse(body.omit({ vehicleId: true }).partial(), req.body);
    if (b.date && b.date > localDate(Date.now())) throw new HttpError(400, 'validation', 'A data do checklist não pode ser no futuro.');
    const items = b.items ? normItems(b.items) : undefined;
    const [r] = await db.update(inspections).set({ ...b, items }).where(eq(inspections.id, id)).returning();
    let created = 0;
    if (items) {
      const v = await ownVehicle(cur.vehicleId, req.user.org);
      created = await openTasks(req.user.org, v.name, v.id, r.date, items, new Set(cur.items.filter((i) => i.status === 'PROBLEMA').map((i) => i.key)));
    }
    await audit(db, req, 'update', 'inspection', id, { date: r.date, km: r.km, ...inspectionSummary(r.items), tasks: created });
    return { ...r, tasksCreated: created };
  });

  app.delete('/inspections/:id', write, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const cur = await ownInspection(id, req.user.org);
    await db.delete(inspections).where(eq(inspections.id, id));
    await audit(db, req, 'delete', 'inspection', id, { vehicleId: cur.vehicleId, date: cur.date });
    return reply.code(204).send();
  });

  /** Envia uma foto (multipart, campo "file"); a posição vai na URL: ?slot=frente&caption=... */
  app.post('/inspections/:id/photos', write, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const q = parse(photoQuery, req.query);
    await ownInspection(id, req.user.org);
    const file = await req.file();
    if (!file) throw new HttpError(400, 'file_required', 'Envie a foto.');
    if (!MIMES.includes(file.mimetype)) throw new HttpError(400, 'file_type', 'A foto precisa ser JPG, PNG ou WEBP.');
    const data = await file.toBuffer();
    if (!data.length) throw new HttpError(400, 'file_required', 'A foto está vazia.');
    if (data.length > MAX_PHOTO) throw new HttpError(400, 'file_size', 'Foto grande demais (máximo 6 MB).');
    const [p] = await db.insert(inspectionPhotos).values({ organizationId: req.user.org, inspectionId: id, slot: q.slot, caption: q.caption, mime: file.mimetype, size: data.length, data })
      .returning({ id: inspectionPhotos.id, slot: inspectionPhotos.slot, caption: inspectionPhotos.caption, size: inspectionPhotos.size });
    await audit(db, req, 'create', 'inspection_photo', p.id, { inspectionId: id, slot: q.slot, size: data.length });
    return reply.code(201).send(p);
  });

  app.get('/inspection-photos/:id', read, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const [p] = await db.select({ mime: inspectionPhotos.mime, data: inspectionPhotos.data }).from(inspectionPhotos)
      .where(and(eq(inspectionPhotos.id, id), eq(inspectionPhotos.organizationId, req.user.org)));
    if (!p) throw notFound('Foto');
    return reply.header('content-type', p.mime).header('cache-control', 'private, max-age=86400').send(p.data);
  });

  app.delete('/inspection-photos/:id', write, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const [p] = await db.delete(inspectionPhotos).where(and(eq(inspectionPhotos.id, id), eq(inspectionPhotos.organizationId, req.user.org)))
      .returning({ inspectionId: inspectionPhotos.inspectionId, slot: inspectionPhotos.slot });
    if (!p) throw notFound('Foto');
    await audit(db, req, 'delete', 'inspection_photo', id, p);
    return reply.code(204).send();
  });
}
