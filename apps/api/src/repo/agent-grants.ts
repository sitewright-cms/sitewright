import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { agentGrants, type ApiKeyCapability } from '../db/schema.js';
import { newId } from '../id.js';

export type AgentAutonomy = 'full' | 'ask';

export interface AgentGrant {
  capabilities: ApiKeyCapability[];
  autonomy: AgentAutonomy;
}

/**
 * The per-(user, project) consent grant for the on-page AI assistant — which capabilities the user
 * approved on first connect + its autonomy. One row per pair (upserted).
 */
export class AgentGrantsRepository {
  constructor(private readonly db: Database) {}

  async get(userId: string, projectId: string): Promise<AgentGrant | null> {
    const [row] = await this.db
      .select()
      .from(agentGrants)
      .where(and(eq(agentGrants.userId, userId), eq(agentGrants.projectId, projectId)));
    return row ? { capabilities: row.capabilities, autonomy: row.autonomy } : null;
  }

  async upsert(userId: string, projectId: string, grant: AgentGrant, now: Date = new Date()): Promise<AgentGrant> {
    await this.db
      .insert(agentGrants)
      .values({ id: newId(), userId, projectId, capabilities: grant.capabilities, autonomy: grant.autonomy, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [agentGrants.userId, agentGrants.projectId],
        set: { capabilities: grant.capabilities, autonomy: grant.autonomy, updatedAt: now },
      });
    return grant;
  }

  async revoke(userId: string, projectId: string): Promise<void> {
    await this.db.delete(agentGrants).where(and(eq(agentGrants.userId, userId), eq(agentGrants.projectId, projectId)));
  }
}
