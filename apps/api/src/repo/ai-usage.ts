import { newId } from '../id.js';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { aiUsage } from '../db/schema.js';
import type { AiUsage } from '../ai/provider.js';

/** Append-only AI usage ledger + monthly aggregation for quota enforcement (per-user + global). */
export class AiUsageRepository {
  constructor(private readonly db: Database) {}

  /** Records one completion's token usage. `projectId` is null for non-project ops. */
  async record(
    userId: string,
    projectId: string | null,
    model: string,
    usage: AiUsage,
  ): Promise<void> {
    await this.db.insert(aiUsage).values({
      id: newId(),
      userId,
      projectId,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      createdAt: new Date(),
    });
  }

  /**
   * Total tokens (input + output) charged since `since` — across the whole platform, or scoped to a
   * single user when `userId` is given. The basis for the monthly platform/per-user quotas.
   */
  async tokensSince(since: Date, userId?: string): Promise<number> {
    const where = userId
      ? and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, since))
      : gte(aiUsage.createdAt, since);
    const [row] = await this.db
      .select({
        total: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)`,
      })
      .from(aiUsage)
      .where(where);
    return Number(row?.total ?? 0);
  }
}
