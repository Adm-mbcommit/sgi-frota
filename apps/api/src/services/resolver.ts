import { eq } from 'drizzle-orm';
import { makeResolver } from '@sgi/core';
import type { DB } from '../db/client.js';
import { drivers, vehicles } from '../db/schema.js';

export interface OrgResolver {
  vehicleId(raw: unknown): string | null;
  driverId(raw: unknown): string | null;
}

/** Resolve placas e grafias de motorista para IDs, usando os apelidos cadastrados. */
export async function loadResolver(db: DB, orgId: string): Promise<OrgResolver> {
  const vs = await db.select().from(vehicles).where(eq(vehicles.organizationId, orgId));
  const ds = await db.select().from(drivers).where(eq(drivers.organizationId, orgId));
  const r = makeResolver(vs.map((v) => ({ plate: v.plate, aliases: v.aliases })), ds.map((d) => ({ name: d.name, aliases: d.aliases })));
  const vByPlate = new Map(vs.map((v) => [v.plate, v.id]));
  const dByName = new Map(ds.map((d) => [d.name, d.id]));
  return {
    vehicleId: (raw) => { const p = r.plate(raw); return p ? vByPlate.get(p) ?? null : null; },
    driverId: (raw) => { const n = r.driver(raw); return n ? dByName.get(n) ?? null : null; },
  };
}
