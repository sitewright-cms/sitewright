import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  apiKeys,
  oauthAuthCodes,
  oauthRefreshTokens,
  API_KEY_CAPABILITIES,
  type ApiKeyCapability,
  type OrgRole,
} from '../db/schema.js';
import { generateApiToken, hashApiToken } from '../auth/api-keys.js';
import { isValidS256Challenge, verifyPkceS256 } from '../auth/pkce.js';

/** Access token lifetime — short; renewed by activity via refresh. */
export const ACCESS_TTL_MS = 1000 * 60 * 60; // 1 hour
/** Absolute refresh/session cap — re-auth required past this regardless of activity. */
export const REFRESH_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours
/** Authorization code lifetime — single-use and very short. */
export const AUTH_CODE_TTL_MS = 1000 * 60; // 60 seconds

/** An OAuth protocol error (maps to an RFC 6749 `error` code at the token endpoint). */
export class OAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

/** A drizzle DB or transaction handle (structurally identical for our queries). */
type Executor = Database;

/** The consented grant — bound to ONE project, with the user's role frozen at consent time. */
export interface Grant {
  clientId: string;
  userId: string;
  orgId: string;
  projectId: string;
  role: OrgRole;
  scope: ApiKeyCapability[];
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scope: ApiKeyCapability[];
}

function mintToken(prefix: string): { token: string; hash: string } {
  const token = prefix + randomBytes(32).toString('hex');
  return { token, hash: hashApiToken(token) };
}

/**
 * OAuth 2.1 token issuance — the security core. Authorization codes are
 * single-use + PKCE-bound; refresh tokens rotate and a reused (already-rotated)
 * token revokes the whole chain AND the user's in-flight OAuth access tokens for
 * that project (theft response). Access tokens are minted as `source:'oauth'`
 * rows in `api_keys`, so the existing bearer path validates them unchanged — the
 * OAuth layer is purely an issuance front-end.
 */
export class OAuthRepository {
  constructor(private readonly db: Database) {}

  /** Stores a single-use, short-lived authorization code; returns the raw code. */
  async createAuthCode(
    grant: Grant,
    redirectUri: string,
    codeChallenge: string,
    now: Date = new Date(),
  ): Promise<string> {
    if (!isValidS256Challenge(codeChallenge)) {
      throw new OAuthError('invalid_request', 'code_challenge must be a base64url S256 digest');
    }
    const { token, hash } = mintToken('swc_');
    await this.db.insert(oauthAuthCodes).values({
      id: hash,
      clientId: grant.clientId,
      userId: grant.userId,
      orgId: grant.orgId,
      projectId: grant.projectId,
      role: grant.role,
      scope: clampScope(grant.scope),
      redirectUri,
      codeChallenge,
      expiresAt: new Date(now.getTime() + AUTH_CODE_TTL_MS),
      consumedAt: null,
      createdAt: now,
    });
    return token;
  }

  /**
   * Redeems an authorization code for tokens. ALL checks (expiry, client,
   * redirect_uri, PKCE) run read-only BEFORE the code is consumed — so a wrong
   * verifier or redirect from an attacker who intercepted the code does not burn
   * it for the legitimate client. The consume + token issuance then run in one
   * transaction, so a failure rolls back the consume (the code stays usable).
   */
  async redeemAuthCode(
    input: { code: string; clientId: string; redirectUri: string; codeVerifier: string },
    now: Date = new Date(),
  ): Promise<IssuedTokens> {
    const id = hashApiToken(input.code);
    const [row] = await this.db.select().from(oauthAuthCodes).where(eq(oauthAuthCodes.id, id));
    if (!row) throw new OAuthError('invalid_grant', 'unknown authorization code');
    if (row.expiresAt.getTime() <= now.getTime()) throw new OAuthError('invalid_grant', 'authorization code expired');
    if (row.clientId !== input.clientId) throw new OAuthError('invalid_grant', 'client mismatch');
    if (row.redirectUri !== input.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri mismatch');
    if (row.consumedAt !== null) throw new OAuthError('invalid_grant', 'authorization code already used');
    if (!verifyPkceS256(input.codeVerifier, row.codeChallenge)) {
      throw new OAuthError('invalid_grant', 'PKCE verification failed');
    }
    const grant: Grant = {
      clientId: row.clientId,
      userId: row.userId,
      orgId: row.orgId,
      projectId: row.projectId,
      role: row.role,
      scope: row.scope,
    };
    return this.db.transaction(async (tx) => {
      const exec = tx as unknown as Executor; // tx exposes the same query builder
      // Atomic single-use: only the first redeemer flips consumedAt from null.
      const consumed = await exec
        .update(oauthAuthCodes)
        .set({ consumedAt: now })
        .where(and(eq(oauthAuthCodes.id, id), isNull(oauthAuthCodes.consumedAt)))
        .returning({ id: oauthAuthCodes.id });
      if (consumed.length === 0) throw new OAuthError('invalid_grant', 'authorization code already used');
      return this.issueTokens(exec, grant, now);
    });
  }

  /**
   * Rotates a refresh token into a fresh access + refresh pair. A token that was
   * already rotated (reuse) is theft: the whole chain AND the user's in-flight
   * OAuth access tokens for the project are revoked. The new refresh inherits the
   * original absolute expiry, so activity renews access but can't extend the
   * session past its cap.
   */
  async refresh(
    input: { refreshToken: string; clientId: string },
    now: Date = new Date(),
  ): Promise<IssuedTokens> {
    const id = hashApiToken(input.refreshToken);
    const [row] = await this.db.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.id, id));
    if (!row) throw new OAuthError('invalid_grant', 'unknown refresh token');
    if (row.clientId !== input.clientId) throw new OAuthError('invalid_grant', 'client mismatch');
    if (row.revokedAt !== null) throw new OAuthError('invalid_grant', 'refresh token revoked');
    if (row.rotatedTo !== null) {
      // Reuse of an already-rotated token → theft. Revoke outside any transaction
      // so the revocation commits even though we then reject the request.
      await this.revokeChain(row.id, row.userId, row.projectId, now);
      throw new OAuthError('invalid_grant', 'refresh token reuse detected');
    }
    if (row.expiresAt.getTime() <= now.getTime()) throw new OAuthError('invalid_grant', 'refresh token expired');
    const grant: Grant = {
      clientId: row.clientId,
      userId: row.userId,
      orgId: row.orgId,
      projectId: row.projectId,
      role: row.role,
      scope: row.scope,
    };
    return this.db.transaction(async (tx) => {
      const exec = tx as unknown as Executor; // tx exposes the same query builder
      // Pre-mint the successor so its hash is the rotation marker, and claim the
      // rotation atomically: only the first writer flips rotatedTo from null.
      const nextRefresh = mintToken('swr_');
      const claimed = await exec
        .update(oauthRefreshTokens)
        .set({ rotatedTo: nextRefresh.hash })
        .where(and(eq(oauthRefreshTokens.id, id), isNull(oauthRefreshTokens.rotatedTo), isNull(oauthRefreshTokens.revokedAt)))
        .returning({ id: oauthRefreshTokens.id });
      if (claimed.length === 0) throw new OAuthError('invalid_grant', 'refresh token reuse detected');
      return this.issueTokens(exec, grant, now, { refreshExpiresAt: row.expiresAt, refresh: nextRefresh });
    });
  }

  private async issueTokens(
    exec: Executor,
    grant: Grant,
    now: Date,
    opts?: { refreshExpiresAt?: Date; refresh?: { token: string; hash: string } },
  ): Promise<IssuedTokens> {
    const scope = clampScope(grant.scope);
    const access = generateApiToken();
    await exec.insert(apiKeys).values({
      id: randomUUID(),
      orgId: grant.orgId,
      projectId: grant.projectId,
      name: `oauth:${grant.clientId}`,
      role: grant.role,
      capabilities: scope,
      tokenHash: access.tokenHash,
      tokenPrefix: access.tokenPrefix,
      expiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
      revokedAt: null,
      lastUsedAt: null,
      createdBy: grant.userId,
      source: 'oauth',
      createdAt: now,
    });
    const refresh = opts?.refresh ?? mintToken('swr_');
    await exec.insert(oauthRefreshTokens).values({
      id: refresh.hash,
      clientId: grant.clientId,
      userId: grant.userId,
      orgId: grant.orgId,
      projectId: grant.projectId,
      role: grant.role,
      scope,
      expiresAt: opts?.refreshExpiresAt ?? new Date(now.getTime() + REFRESH_TTL_MS),
      revokedAt: null,
      rotatedTo: null,
      createdAt: now,
    });
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresInSeconds: Math.floor(ACCESS_TTL_MS / 1000),
      scope,
    };
  }

  /**
   * Theft response: revoke the refresh token and every token it was rotated into,
   * plus the user's still-valid OAuth access tokens for the project (closing the
   * access-token window that would otherwise survive until its 1h TTL). `startId`
   * is the presented (already-rotated) node; the walk follows `rotatedTo` forward
   * to reach the currently-valid successor too.
   */
  private async revokeChain(startId: string, userId: string, projectId: string, now: Date): Promise<void> {
    let next: string | null = startId;
    for (let i = 0; i < 1000 && next !== null; i += 1) {
      const currentId: string = next;
      const rows = await this.db
        .update(oauthRefreshTokens)
        .set({ revokedAt: now })
        .where(eq(oauthRefreshTokens.id, currentId))
        .returning({ rotatedTo: oauthRefreshTokens.rotatedTo });
      next = rows[0]?.rotatedTo ?? null;
    }
    // Kill in-flight OAuth access tokens for this user+project (aggressive by design).
    await this.db
      .update(apiKeys)
      .set({ revokedAt: now })
      .where(
        and(
          eq(apiKeys.source, 'oauth'),
          eq(apiKeys.createdBy, userId),
          eq(apiKeys.projectId, projectId),
          isNull(apiKeys.revokedAt),
        ),
      );
  }
}

/** Keep only known capabilities, in canonical order (defends against tampered/stale rows). */
function clampScope(scope: ApiKeyCapability[]): ApiKeyCapability[] {
  return API_KEY_CAPABILITIES.filter((c) => scope.includes(c));
}
