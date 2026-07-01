import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { apiKeys, type ApiKeyCapability } from '../db/schema.js';
import { newId } from '../id.js';
import { generateApiToken } from '../auth/api-keys.js';

export interface MintedAgentToken {
  /** The raw `swk_` token — held only in the server-side loop, never sent to the browser. */
  token: string;
  /** The row id, so the loop can revoke it when it finishes. */
  keyId: string;
}

/**
 * Mint a short-lived, project-scoped `swk_` token for a server-side agent loop.
 * Mirrors {@link OAuthRepository.issueTokens}: inserts an `apiKeys` row with
 * `source:'oauth'` (validated the same way as any bearer, but hidden from the PAT
 * management list) carrying the granted capabilities + a short expiry. All tool calls
 * ride this token so they land as `actor:'agent'` writes through the gated REST path.
 *
 * Callers MUST clamp `capabilities`/`role` to the requesting user's ceiling first —
 * this helper trusts its inputs.
 */
export async function mintAgentToken(
  db: Database,
  opts: { projectId: string; userId: string; role: 'owner' | 'member'; capabilities: ApiKeyCapability[]; ttlMs: number; now?: Date },
): Promise<MintedAgentToken> {
  const now = opts.now ?? new Date();
  const keyId = newId();
  const gen = generateApiToken();
  await db.insert(apiKeys).values({
    id: keyId,
    projectId: opts.projectId,
    name: `agent:${opts.userId}`,
    role: opts.role,
    capabilities: opts.capabilities,
    tokenHash: gen.tokenHash,
    tokenPrefix: gen.tokenPrefix,
    expiresAt: new Date(now.getTime() + opts.ttlMs),
    revokedAt: null,
    lastUsedAt: null,
    createdBy: opts.userId,
    source: 'oauth',
    createdAt: now,
  });
  return { token: gen.token, keyId };
}

/** Revoke a minted agent token (best-effort; called when the loop ends or aborts). */
export async function revokeAgentToken(db: Database, keyId: string, now: Date = new Date()): Promise<void> {
  await db.update(apiKeys).set({ revokedAt: now }).where(eq(apiKeys.id, keyId));
}
