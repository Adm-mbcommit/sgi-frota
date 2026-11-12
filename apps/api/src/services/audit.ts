import type { FastifyRequest } from 'fastify';
import type { DB } from '../db/client.js';
import { auditLog } from '../db/schema.js';

export async function audit(db: DB, req: FastifyRequest, action: string, entity: string, entityId: string | null, data?: unknown) {
  await db.insert(auditLog).values({ organizationId: req.user.org, userId: req.user.sub, action, entity, entityId, data: data as object });
}
