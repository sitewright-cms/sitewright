import { and, eq, or } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { content } from '../db/schema.js';

/** The row id older projects kept their single binding under (see GatewayRepository). */
const LEGACY_BINDING_ID = 'settings';

/**
 * How many projects hold keys for a gateway id — across the whole instance, soft-deleted ones
 * included (a restore brings their keys back).
 *
 * ★ Keys are filed under the gateway ID, not under a particular definition, so they outlive a
 * definition that is deleted. Whoever writes a definition under that id next decides where those
 * keys are presented — which is why this is the question to ask before letting an agent do it.
 */
export async function projectsHoldingKeys(db: Database, gatewayId: string): Promise<number> {
  const rows = await db
    .select({ projectId: content.projectId, entityId: content.entityId, data: content.data })
    .from(content)
    .where(and(eq(content.kind, 'project_payment'), or(eq(content.entityId, gatewayId), eq(content.entityId, LEGACY_BINDING_ID))));
  const holding = rows.filter(
    (r) => r.entityId === gatewayId || (r.data as { gatewayId?: unknown } | null)?.gatewayId === gatewayId,
  );
  return new Set(holding.map((r) => r.projectId)).size;
}
