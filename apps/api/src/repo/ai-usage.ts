import { randomUUID } from 'node:crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { aiUsage } from '../db/schema.js';
import type { AiUsage } from '../ai/provider.js';

/** Append-only AI usage ledger + monthly aggregation for quota enforcement. */
export class AiUsageRepository {
  constructor(private readonly db: Database) {}

  /** Records one completion's token usage. `projectId` is null for org-level ops. */
  async record(
    orgId: string,
    userId: string,
    projectId: string | null,
    model: string,
    usage: AiUsage,
  ): Promise<void> {
    await this.db.insert(aiUsage).values({
      id: randomUUID(),
      orgId,
      userId,
      projectId,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      createdAt: new Date(),
    });
  }

  /**
   * Total tokens (input + output) charged to an org since `since`, optionally
   * scoped to a single user — the basis for monthly per-org/per-user quotas.
   */
  async tokensSince(orgId: string, since: Date, userId?: string): Promise<number> {
    const where = userId
      ? and(eq(aiUsage.orgId, orgId), eq(aiUsage.userId, userId), gte(aiUsage.createdAt, since))
      : and(eq(aiUsage.orgId, orgId), gte(aiUsage.createdAt, since));
    const [row] = await this.db
      .select({
        total: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)`,
      })
      .from(aiUsage)
      .where(where);
    return Number(row?.total ?? 0);
  }
}
