import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  apiKeys,
  API_KEY_CAPABILITIES,
  type ApiKeyCapability,
  type ProjectRole,
} from '../db/schema.js';
import { generateApiToken, hashApiToken, isApiTokenFormat } from '../auth/api-keys.js';
import { ForbiddenError, NotFoundError, type ProjectContext } from './context.js';

/** Only a project owner (a platform admin resolves to owner) may mint/list/revoke keys. */
const WRITE_ROLES: ReadonlySet<ProjectRole> = new Set(['owner']);

/** Role precedence — a key may never be minted above its creator's role. */
const ROLE_RANK: Record<ProjectRole, number> = { member: 1, owner: 2 };

/** Maximum lifetime of a key from creation: one year. */
export const MAX_API_KEY_TTL_MS = 1000 * 60 * 60 * 24 * 365;

const CAPABILITY_SET: ReadonlySet<string> = new Set(API_KEY_CAPABILITIES);

export interface CreateApiKeyInput {
  name: string;
  role: ProjectRole;
  capabilities: ApiKeyCapability[];
  expiresAt: Date;
}

/** Redacted view of a key — never includes the hash or the raw token. */
export interface ApiKeyView {
  id: string;
  name: string;
  role: ProjectRole;
  capabilities: ApiKeyCapability[];
  tokenPrefix: string;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

/** What a successfully-resolved bearer token grants. */
export interface ResolvedApiKey {
  keyId: string;
  projectId: string;
  role: ProjectRole;
  capabilities: ApiKeyCapability[];
  createdBy: string;
}

function toView(row: typeof apiKeys.$inferSelect): ApiKeyView {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    capabilities: row.capabilities,
    tokenPrefix: row.tokenPrefix,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}

/**
 * Project-scoped store for project API keys. Management operations
 * ({@link create}/{@link list}/{@link revoke}) require a verified
 * {@link ProjectContext} and filter by `projectId`. {@link resolve} is the
 * unscoped auth entry point: it looks a token up by hash and returns its scope,
 * which the HTTP layer then matches against the requested project.
 */
export class ApiKeyRepository {
  constructor(private readonly db: Database) {}

  async create(
    ctx: ProjectContext,
    input: CreateApiKeyInput,
    now: Date = new Date(),
  ): Promise<{ token: string; key: ApiKeyView }> {
    if (!WRITE_ROLES.has(ctx.role)) {
      throw new ForbiddenError('insufficient role to create API keys');
    }
    if (ROLE_RANK[input.role] > ROLE_RANK[ctx.role]) {
      throw new ForbiddenError('cannot create a key with a role above your own');
    }
    if (input.capabilities.length === 0) {
      throw new ForbiddenError('a key must grant at least one capability');
    }
    for (const cap of input.capabilities) {
      if (!CAPABILITY_SET.has(cap)) throw new ForbiddenError(`unknown capability: ${cap}`);
    }
    const ttl = input.expiresAt.getTime() - now.getTime();
    if (ttl <= 0) throw new ForbiddenError('expiry must be in the future');
    if (ttl > MAX_API_KEY_TTL_MS) throw new ForbiddenError('expiry exceeds the maximum key lifetime');

    const { token, tokenHash, tokenPrefix } = generateApiToken();
    const id = randomUUID();
    // De-duplicate + freeze the capability list (stable order, no surprises).
    const capabilities = API_KEY_CAPABILITIES.filter((c) => input.capabilities.includes(c));
    const row: typeof apiKeys.$inferInsert = {
      id,
      projectId: ctx.projectId,
      name: input.name,
      role: input.role,
      capabilities,
      tokenHash,
      tokenPrefix,
      expiresAt: input.expiresAt,
      revokedAt: null,
      lastUsedAt: null,
      createdBy: ctx.userId,
      createdAt: now,
    };
    await this.db.insert(apiKeys).values(row);
    return {
      token,
      key: {
        id,
        name: input.name,
        role: input.role,
        capabilities,
        tokenPrefix,
        expiresAt: input.expiresAt,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: now,
      },
    };
  }

  /** Keys for the caller's project only, redacted. Writers only (keys reveal what
   * automation can reach the project). */
  async list(ctx: ProjectContext): Promise<ApiKeyView[]> {
    if (!WRITE_ROLES.has(ctx.role)) {
      throw new ForbiddenError('insufficient role to list API keys');
    }
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.projectId, ctx.projectId),
          // Only user-minted PATs; ephemeral OAuth access tokens are not "keys" to manage.
          eq(apiKeys.source, 'pat'),
          // The management list shows ACTIVE keys; revoked rows are retained for audit
          // but never listed (a revoked key is dead).
          isNull(apiKeys.revokedAt),
        ),
      );
    return rows.map(toView);
  }

  /** Revokes a key in the caller's project. Throws NotFound if it isn't theirs. */
  async revoke(ctx: ProjectContext, keyId: string, now: Date = new Date()): Promise<void> {
    if (!WRITE_ROLES.has(ctx.role)) {
      throw new ForbiddenError('insufficient role to revoke API keys');
    }
    const [row] = await this.db
      .select()
      .from(apiKeys)
      .where(
        and(eq(apiKeys.id, keyId), eq(apiKeys.projectId, ctx.projectId)),
      );
    if (!row) throw new NotFoundError('api key not found');
    await this.db.update(apiKeys).set({ revokedAt: now }).where(eq(apiKeys.id, keyId));
  }

  /**
   * Resolves a raw token to its scope, or null if unknown/revoked/expired. On
   * success, best-effort stamps `lastUsedAt`. NOT tenant-scoped — the HTTP layer
   * must verify the returned org/project match the requested route.
   */
  async resolve(token: string, now: Date = new Date()): Promise<ResolvedApiKey | null> {
    // Skip the DB entirely for anything not even shaped like one of our tokens
    // (random Authorization headers, other bearer schemes).
    if (!isApiTokenFormat(token)) return null;
    const tokenHash = hashApiToken(token);
    const [row] = await this.db.select().from(apiKeys).where(eq(apiKeys.tokenHash, tokenHash));
    if (!row) return null;
    if (row.revokedAt !== null) return null;
    if (row.expiresAt.getTime() <= now.getTime()) return null;
    // Best-effort audit stamp — fire-and-forget so a transient write failure never
    // fails an otherwise-valid request, and we don't pay a round-trip in the hot path.
    void this.db
      .update(apiKeys)
      .set({ lastUsedAt: now })
      .where(eq(apiKeys.id, row.id))
      .catch(() => {});
    return {
      keyId: row.id,
      projectId: row.projectId,
      role: row.role,
      capabilities: row.capabilities,
      createdBy: row.createdBy,
    };
  }
}
