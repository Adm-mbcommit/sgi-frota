/** Utilidades das chaves de sincronização (guardadas só como hash) e de organizations.settings. */
import { createHash, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { organizations } from '../db/schema.js';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => 'sgi_' + randomBytes(24).toString('base64url');

/** Grava campos em organizations.settings sem sobrescrever os demais (merge no próprio banco). */
export const mergeSettings = (db: DB, orgId: string, patch: Record<string, unknown>) =>
  db.update(organizations).set({ settings: sql`${organizations.settings} || ${JSON.stringify(patch)}::jsonb` }).where(eq(organizations.id, orgId));

/** Organização dona da chave (hash em settings[field]) ou null. */
export async function orgByToken(db: DB, field: string, token: unknown) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const [o] = await db.select().from(organizations).where(sql`${organizations.settings}->>${field} = ${sha256(token)}`);
  return o ?? null;
}
