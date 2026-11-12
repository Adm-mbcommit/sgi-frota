/**
 * Modelo de dados do SGI Frota (PostgreSQL).
 *
 * Princípios:
 * - Multiempresa: toda tabela de negócio tem `organization_id`. Um usuário pertence a uma empresa.
 * - Dados importados guardam o texto original (`*_raw`) ao lado do valor normalizado,
 *   para auditoria e para reprocessar quando um apelido for cadastrado.
 * - Instantes em `timestamptz` (UTC); vencimentos e datas de serviço em `date`.
 * - Nada é apagado fisicamente nos cadastros principais: usa-se `active = false`.
 */
import { sql } from 'drizzle-orm';
import {
  boolean, date, doublePrecision, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const org = () => uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: 'number' });

export const roleEnum = pgEnum('role', ['ADMIN', 'GESTOR', 'MOTORISTA', 'LEITOR']);
export const vehicleStatusEnum = pgEnum('vehicle_status', ['ATIVO', 'PARALISADO', 'INATIVO']);
export const sourceEnum = pgEnum('record_source', ['LEGADO', 'COMANDO_BORDO', 'CHRONOS', 'SGI']);
export const taskStatusEnum = pgEnum('task_status', ['ABERTO', 'RESOLVIDO', 'SUGESTAO']);

/* ---------- empresa, usuários, configuração ---------- */

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  /** Nome como aparece na coluna "Empresa" dos formulários (filtra os registros próprios). */
  companyLabel: text('company_label').notNull(),
  /** Parâmetros das regras (FleetConfig parcial). */
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable('users', {
  id: id(),
  organizationId: org(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull().default('LEITOR'),
  /** Motorista vinculado (para o perfil MOTORISTA registrar as próprias viagens). */
  driverId: uuid('driver_id'),
  active: boolean('active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`)]);

export const auditLog = pgTable('audit_log', {
  id: id(),
  organizationId: org(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  data: jsonb('data'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_org_at_idx').on(t.organizationId, t.at)]);

/* ---------- cadastros ---------- */

export const vehicles = pgTable('vehicles', {
  id: id(),
  organizationId: org(),
  plate: text('plate').notNull(),
  name: text('name').notNull(),
  model: text('model'),
  /** Km de referência: âncora para rejeitar hodômetros digitados errado. Atualize a cada revisão. */
  refKm: integer('ref_km').notNull(),
  status: vehicleStatusEnum('status').notNull().default('ATIVO'),
  /** Grafias alternativas da placa usadas nos formulários (ex.: "QXI - 9675"). */
  aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('vehicles_org_plate_uq').on(t.organizationId, t.plate)]);

export const drivers = pgTable('drivers', {
  id: id(),
  organizationId: org(),
  name: text('name').notNull(),
  aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`),
  cnhNumber: text('cnh_number'),
  cnhCategory: text('cnh_category'),
  cnhExpiry: date('cnh_expiry'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('drivers_org_name_uq').on(t.organizationId, t.name)]);

export const stations = pgTable('stations', {
  id: id(),
  organizationId: org(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
}, (t) => [uniqueIndex('stations_org_name_uq').on(t.organizationId, t.name)]);

/* ---------- registros operacionais ---------- */

export const trips = pgTable('trips', {
  id: id(),
  organizationId: org(),
  source: sourceEnum('source').notNull(),
  /** Chave de deduplicação na reimportação (hash da linha de origem). */
  externalKey: text('external_key'),
  company: text('company').notNull(),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  driverId: uuid('driver_id').references(() => drivers.id),
  plateRaw: text('plate_raw'),
  driverRaw: text('driver_raw'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  kmStart: doublePrecision('km_start'),
  kmEnd: doublePrecision('km_end'),
  kmStartRaw: text('km_start_raw'),
  kmEndRaw: text('km_end_raw'),
  locationStart: text('location_start'),
  locationEnd: text('location_end'),
  open: boolean('open').notNull().default(false),
  status: text('status'),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('trips_org_ext_uq').on(t.organizationId, t.externalKey),
  index('trips_org_started_idx').on(t.organizationId, t.startedAt),
  index('trips_vehicle_idx').on(t.vehicleId),
]);

export const fuelings = pgTable('fuelings', {
  id: id(),
  organizationId: org(),
  source: sourceEnum('source').notNull(),
  externalKey: text('external_key'),
  company: text('company').notNull(),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  driverId: uuid('driver_id').references(() => drivers.id),
  plateRaw: text('plate_raw'),
  driverRaw: text('driver_raw'),
  at: timestamp('at', { withTimezone: true }).notNull(),
  km: doublePrecision('km'),
  liters: doublePrecision('liters'),
  total: money('total'),
  station: text('station'),
  fuelType: text('fuel_type'),
  fullTank: boolean('full_tank'),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('fuelings_org_ext_uq').on(t.organizationId, t.externalKey),
  index('fuelings_org_at_idx').on(t.organizationId, t.at),
]);

/** Checklist diário / manutenção diária informada pelo motorista. */
export const checklists = pgTable('checklists', {
  id: id(),
  organizationId: org(),
  source: sourceEnum('source').notNull(),
  externalKey: text('external_key'),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  driverId: uuid('driver_id').references(() => drivers.id),
  plateRaw: text('plate_raw'),
  driverRaw: text('driver_raw'),
  at: timestamp('at', { withTimezone: true }).notNull(),
  km: doublePrecision('km'),
  /** Respostas do formulário (colunas variáveis). */
  answers: jsonb('answers').$type<unknown[]>(),
  notes: text('notes'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('checklists_org_ext_uq').on(t.organizationId, t.externalKey)]);

/** Eventos do rastreador (Chronos, relatório "Períodos de utilização"). */
export const speedEvents = pgTable('speed_events', {
  id: id(),
  organizationId: org(),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  plateRaw: text('plate_raw'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  durationH: doublePrecision('duration_h'),
  vmax: doublePrecision('vmax').notNull(),
  vavg: doublePrecision('vavg'),
  addressStart: text('address_start'),
  addressEnd: text('address_end'),
  importId: uuid('import_id'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('speed_org_vehicle_start_uq').on(t.organizationId, t.plateRaw, t.startedAt),
  index('speed_org_start_idx').on(t.organizationId, t.startedAt),
]);

/* ---------- manutenção, documentos, custos ---------- */

export const maintenancePlan = pgTable('maintenance_plan', {
  id: id(),
  organizationId: org(),
  vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
  item: text('item').notNull(),
  intervalKm: integer('interval_km'),
  intervalMonths: integer('interval_months'),
  lastKm: integer('last_km'),
  lastDate: date('last_date'),
  needsCheck: boolean('needs_check').notNull().default(false),
  source: text('source'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('plan_vehicle_item_uq').on(t.vehicleId, t.item)]);

/** Histórico de serviços: cada registro atualiza o último km/data do item do plano. */
export const maintenanceRecords = pgTable('maintenance_records', {
  id: id(),
  organizationId: org(),
  planItemId: uuid('plan_item_id').references(() => maintenancePlan.id, { onDelete: 'set null' }),
  vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id),
  item: text('item').notNull(),
  km: integer('km'),
  date: date('date').notNull(),
  supplier: text('supplier'),
  invoice: text('invoice'),
  /** Custo que originou o registro (lançado na tela Custos). Excluir o custo exclui o registro. */
  costId: uuid('cost_id').references(() => costs.id, { onDelete: 'cascade' }),
  notes: text('notes'),
  /** COMANDO_BORDO = aba "Manutencao" da planilha; SGI = Custos ou botão Registrar. */
  source: sourceEnum('source').notNull().default('SGI'),
  externalKey: text('external_key'),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('maint_records_org_ext_uq').on(t.organizationId, t.externalKey),
  index('maint_records_cost_idx').on(t.costId),
]);

export const vehicleDocuments = pgTable('vehicle_documents', {
  id: id(),
  organizationId: org(),
  vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
  crlv: date('crlv'),
  ipva: date('ipva'),
  licensing: date('licensing'),
  insurance: date('insurance'),
  insurer: text('insurer'),
  policy: text('policy'),
  confirmed: boolean('confirmed').notNull().default(false),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('docs_vehicle_uq').on(t.vehicleId)]);

export const costCategories = ['Manutenção', 'Conserto', 'Pneus', 'Seguro', 'IPVA', 'Licenciamento', 'Multa', 'Pedágios', 'Lavação', 'Outros'] as const;

export const costs = pgTable('costs', {
  id: id(),
  organizationId: org(),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  date: date('date').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  supplier: text('supplier'),
  amount: money('amount'),
  invoice: text('invoice'),
  notes: text('notes'),
  source: sourceEnum('source').notNull().default('SGI'),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('costs_org_date_idx').on(t.organizationId, t.date)]);

export const tasks = pgTable('tasks', {
  id: id(),
  organizationId: org(),
  title: text('title').notNull(),
  description: text('description'),
  status: taskStatusEnum('status').notNull().default('ABERTO'),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  dueDate: date('due_date'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Histórico de importações de planilhas. */
export const imports = pgTable('imports', {
  id: id(),
  organizationId: org(),
  kind: text('kind').notNull(),
  fileName: text('file_name'),
  stats: jsonb('stats'),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
