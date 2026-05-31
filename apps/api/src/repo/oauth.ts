import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  apiKeys,
  oauthAuthCodes,
  oauthRefreshTokens,
  type ApiKeyCapability,
  type OrgRole,
} from '../db/schema.js';
import { generateApiToken, hashApiToken } from '../auth/api-keys.js';
import { verifyPkceS256 } from '../auth/pkce.js';

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
 * token revokes the whole chain (theft detection). Access tokens are minted as
 * `source:'oauth'` rows in `api_keys`, so the existing bearer path validates them
 * unchanged — the OAuth layer is purely an issuance front-end.
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
    const { token, hash } = mintToken('swc_');
    await this.db.insert(oauthAuthCodes).values({
      id: hash,
      clientId: grant.clientId,
      userId: grant.userId,
      orgId: grant.orgId,
      projectId: grant.projectId,
      role: grant.role,
      scope: grant.scope,
      redirectUri,
      codeChallenge,
      expiresAt: new Date(now.getTime() + AUTH_CODE_TTL_MS),
      consumedAt: null,
      createdAt: now,
    });
    return token;
  }

  /**
   * Redeems an authorization code for tokens. Enforces (in order) atomic
   * single-use, expiry, client + redirect_uri match, and PKCE S256.
   */
  async redeemAuthCode(
    input: { code: string; clientId: string; redirectUri: string; codeVerifier: string },
    now: Date = new Date(),
  ): Promise<IssuedTokens> {
    const id = hashApiToken(input.code);
    const [row] = await this.db.select().from(oauthAuthCodes).where(eq(oauthAuthCodes.id, id));
    if (!row) throw new OAuthError('invalid_grant', 'unknown authorization code');
    // Atomic single-use: only the first redeemer flips consumedAt from null.
    const consumed = await this.db
      .update(oauthAuthCodes)
      .set({ consumedAt: now })
      .where(and(eq(oauthAuthCodes.id, id), isNull(oauthAuthCodes.consumedAt)))
      .returning({ id: oauthAuthCodes.id });
    if (consumed.length === 0) throw new OAuthError('invalid_grant', 'authorization code already used');
    if (row.expiresAt.getTime() <= now.getTime()) throw new OAuthError('invalid_grant', 'authorization code expired');
    if (row.clientId !== input.clientId) throw new OAuthError('invalid_grant', 'client mismatch');
    if (row.redirectUri !== input.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri mismatch');
    if (!verifyPkceS256(input.codeVerifier, row.codeChallenge)) {
      throw new OAuthError('invalid_grant', 'PKCE verification failed');
    }
    return this.issueTokens(
      {
        clientId: row.clientId,
        userId: row.userId,
        orgId: row.orgId,
        projectId: row.projectId,
        role: row.role,
        scope: row.scope,
      },
      now,
    );
  }

  /**
   * Rotates a refresh token into a fresh access + refresh pair. A token that was
   * already rotated (reuse) is treated as theft: the whole chain is revoked. The
   * new refresh inherits the original absolute expiry, so activity renews access
   * but can't extend the session past its cap.
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
      await this.revokeChain(row.id, now);
      throw new OAuthError('invalid_grant', 'refresh token reuse detected');
    }
    if (row.expiresAt.getTime() <= now.getTime()) throw new OAuthError('invalid_grant', 'refresh token expired');
    const issued = await this.issueTokens(
      {
        clientId: row.clientId,
        userId: row.userId,
        orgId: row.orgId,
        projectId: row.projectId,
        role: row.role,
        scope: row.scope,
      },
      now,
      row.expiresAt, // keep the original absolute cap
    );
    await this.db
      .update(oauthRefreshTokens)
      .set({ rotatedTo: hashApiToken(issued.refreshToken) })
      .where(eq(oauthRefreshTokens.id, id));
    return issued;
  }

  private async issueTokens(grant: Grant, now: Date, refreshExpiresAt?: Date): Promise<IssuedTokens> {
    const access = generateApiToken();
    await this.db.insert(apiKeys).values({
      id: randomUUID(),
      orgId: grant.orgId,
      projectId: grant.projectId,
      name: `oauth:${grant.clientId}`,
      role: grant.role,
      capabilities: grant.scope,
      tokenHash: access.tokenHash,
      tokenPrefix: access.tokenPrefix,
      expiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
      revokedAt: null,
      lastUsedAt: null,
      createdBy: grant.userId,
      source: 'oauth',
      createdAt: now,
    });
    const refresh = mintToken('swr_');
    await this.db.insert(oauthRefreshTokens).values({
      id: refresh.hash,
      clientId: grant.clientId,
      userId: grant.userId,
      orgId: grant.orgId,
      projectId: grant.projectId,
      role: grant.role,
      scope: grant.scope,
      expiresAt: refreshExpiresAt ?? new Date(now.getTime() + REFRESH_TTL_MS),
      revokedAt: null,
      rotatedTo: null,
      createdAt: now,
    });
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresInSeconds: Math.floor(ACCESS_TTL_MS / 1000),
      scope: grant.scope,
    };
  }

  /** Revokes a refresh token and every token it was rotated into (theft response). */
  private async revokeChain(startId: string, now: Date): Promise<void> {
    let next: string | null = startId;
    // Bounded walk along rotatedTo links (defensive cap against any cycle).
    for (let i = 0; i < 1000 && next !== null; i += 1) {
      const currentId: string = next;
      const rows = await this.db
        .update(oauthRefreshTokens)
        .set({ revokedAt: now })
        .where(eq(oauthRefreshTokens.id, currentId))
        .returning({ rotatedTo: oauthRefreshTokens.rotatedTo });
      next = rows[0]?.rotatedTo ?? null;
    }
  }
}
