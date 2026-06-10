import { randomBytes } from 'node:crypto';
import { newId } from '../id.js';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  apiKeys,
  oauthAuthCodes,
  oauthDeviceCodes,
  oauthRefreshTokens,
  API_KEY_CAPABILITIES,
  type ApiKeyCapability,
  type ProjectRole,
} from '../db/schema.js';
import { generateApiToken, hashApiToken } from '../auth/api-keys.js';
import { isValidS256Challenge, verifyPkceS256 } from '../auth/pkce.js';

/** Access token lifetime — short; renewed by activity via refresh. */
export const ACCESS_TTL_MS = 1000 * 60 * 60; // 1 hour
/** Absolute refresh/session cap — re-auth required past this regardless of activity. */
export const REFRESH_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours
/** Authorization code lifetime — single-use and very short. */
export const AUTH_CODE_TTL_MS = 1000 * 60; // 60 seconds
/** Device-code lifetime + minimum CLI polling interval (RFC 8628). */
export const DEVICE_CODE_TTL_MS = 1000 * 60 * 10; // 10 minutes
export const DEVICE_POLL_INTERVAL_SEC = 5;
/** User-code alphabet — unambiguous (no 0/O/1/I/etc.) and easy to type. */
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';

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
  projectId: string;
  role: ProjectRole;
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

/** A short, unambiguous, human-typable user code, e.g. `WDJB-MJHT`. */
function generateUserCode(): string {
  // Rejection sampling — discard bytes in the biased tail so every alphabet char
  // is equally likely (no modulo bias).
  const maxValid = 256 - (256 % USER_CODE_ALPHABET.length);
  let out = '';
  while (out.length < 8) {
    const b = randomBytes(1)[0]!;
    if (b >= maxValid) continue;
    out += USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** What's pending approval for a user code (shown on the device-verification page). */
export interface DeviceAuthorizationView {
  userCode: string;
  clientId: string;
  scope: ApiKeyCapability[];
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
    refreshExpiresAt?: Date,
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
      return this.issueTokens(exec, grant, now, refreshExpiresAt ? { refreshExpiresAt } : undefined);
    });
  }

  /**
   * Rotates a refresh token into a fresh access + refresh pair. A token that was
   * already rotated (reuse) is theft: the whole chain AND the user's in-flight
   * OAuth access tokens for the project are revoked. The new refresh inherits the
   * original absolute expiry, so activity renews access but can't extend the
   * session past its cap. `maxRefreshExpiresAt` (the CURRENT instance cap) clamps it
   * further so that an admin lowering the session length tightens existing sessions
   * on their next refresh — the rotated token never outlives the smaller of the two.
   */
  async refresh(
    input: { refreshToken: string; clientId: string },
    now: Date = new Date(),
    maxRefreshExpiresAt?: Date,
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
      // Clamp to the SMALLER of the original cap and the current instance cap — only ever
      // shortens the window (a tightened cap takes effect now; a raised one never extends past
      // what was originally issued).
      const refreshExpiresAt = maxRefreshExpiresAt
        ? new Date(Math.min(row.expiresAt.getTime(), maxRefreshExpiresAt.getTime()))
        : row.expiresAt;
      return this.issueTokens(exec, grant, now, { refreshExpiresAt, refresh: nextRefresh });
    });
  }

  // ---- Device Authorization Grant (RFC 8628) ----

  /** Starts a device flow: returns the polled `device_code` + the user-facing `user_code`. */
  async startDeviceAuthorization(
    input: { clientId: string; scope: ApiKeyCapability[] },
    now: Date = new Date(),
  ): Promise<{ deviceCode: string; userCode: string; expiresAt: Date; interval: number }> {
    // Opportunistic GC so the table can't grow unbounded (expired + leftover
    // pending codes whose project may since have been deleted).
    await this.db.delete(oauthDeviceCodes).where(lt(oauthDeviceCodes.expiresAt, now));
    const { token: deviceCode, hash } = mintToken('swd_');
    const userCode = generateUserCode();
    const expiresAt = new Date(now.getTime() + DEVICE_CODE_TTL_MS);
    await this.db.insert(oauthDeviceCodes).values({
      id: hash,
      userCode,
      clientId: input.clientId,
      scope: clampScope(input.scope),
      status: 'pending',
      userId: null,
      projectId: null,
      role: null,
      expiresAt,
      consumedAt: null,
      lastPolledAt: null,
      createdAt: now,
    });
    return { deviceCode, userCode, expiresAt, interval: DEVICE_POLL_INTERVAL_SEC };
  }

  /** Looks up a pending, unexpired device authorization by its user code. */
  async findDeviceByUserCode(
    userCode: string,
    now: Date = new Date(),
  ): Promise<DeviceAuthorizationView | null> {
    const [row] = await this.db
      .select()
      .from(oauthDeviceCodes)
      .where(eq(oauthDeviceCodes.userCode, userCode));
    if (!row || row.status !== 'pending' || row.expiresAt.getTime() <= now.getTime()) return null;
    return { userCode: row.userCode, clientId: row.clientId, scope: row.scope };
  }

  /** Approves a pending device authorization, freezing the grant (project/role). */
  async approveDevice(
    input: { userCode: string; userId: string; projectId: string; role: ProjectRole },
    now: Date = new Date(),
  ): Promise<void> {
    const [row] = await this.db
      .select()
      .from(oauthDeviceCodes)
      .where(eq(oauthDeviceCodes.userCode, input.userCode));
    if (!row) throw new OAuthError('invalid_request', 'unknown user code');
    if (row.expiresAt.getTime() <= now.getTime()) throw new OAuthError('expired_token', 'user code expired');
    const updated = await this.db
      .update(oauthDeviceCodes)
      .set({ status: 'approved', userId: input.userId, projectId: input.projectId, role: input.role })
      .where(and(eq(oauthDeviceCodes.userCode, input.userCode), eq(oauthDeviceCodes.status, 'pending')))
      .returning({ userCode: oauthDeviceCodes.userCode });
    if (updated.length === 0) throw new OAuthError('invalid_request', 'code already decided');
  }

  /** Denies a pending device authorization. */
  async denyDevice(userCode: string): Promise<void> {
    await this.db
      .update(oauthDeviceCodes)
      .set({ status: 'denied' })
      .where(and(eq(oauthDeviceCodes.userCode, userCode), eq(oauthDeviceCodes.status, 'pending')));
  }

  /**
   * Redeems a device_code (the CLI poll). Throws the RFC 8628 polling errors —
   * `authorization_pending`, `slow_down`, `access_denied`, `expired_token` — until
   * approved, then atomically consumes it (single-use) and issues tokens.
   */
  async redeemDeviceCode(
    input: { deviceCode: string; clientId: string },
    now: Date = new Date(),
    refreshExpiresAt?: Date,
  ): Promise<IssuedTokens> {
    const id = hashApiToken(input.deviceCode);
    const [row] = await this.db.select().from(oauthDeviceCodes).where(eq(oauthDeviceCodes.id, id));
    if (!row) throw new OAuthError('invalid_grant', 'unknown device code');
    if (row.clientId !== input.clientId) throw new OAuthError('invalid_grant', 'client mismatch');
    if (row.expiresAt.getTime() <= now.getTime()) throw new OAuthError('expired_token', 'device code expired');
    if (row.status === 'denied') throw new OAuthError('access_denied', 'authorization was denied');
    if (row.status === 'pending') {
      const tooFast =
        row.lastPolledAt !== null && now.getTime() - row.lastPolledAt.getTime() < DEVICE_POLL_INTERVAL_SEC * 1000;
      await this.db.update(oauthDeviceCodes).set({ lastPolledAt: now }).where(eq(oauthDeviceCodes.id, id));
      throw new OAuthError(tooFast ? 'slow_down' : 'authorization_pending', 'authorization pending');
    }
    // Approved → the grant fields must be set. Fail loud (not a degraded token)
    // if a data-integrity issue ever produced an approved row with null grant.
    if (!row.userId || !row.projectId || !row.role) {
      throw new OAuthError('server_error', 'approved device grant is missing required fields');
    }
    const grant: Grant = {
      clientId: row.clientId,
      userId: row.userId,
      projectId: row.projectId,
      role: row.role,
      scope: row.scope,
    };
    return this.db.transaction(async (tx) => {
      const exec = tx as unknown as Executor;
      const consumed = await exec
        .update(oauthDeviceCodes)
        .set({ consumedAt: now })
        .where(and(eq(oauthDeviceCodes.id, id), isNull(oauthDeviceCodes.consumedAt)))
        .returning({ id: oauthDeviceCodes.id });
      if (consumed.length === 0) throw new OAuthError('invalid_grant', 'device code already redeemed');
      return this.issueTokens(exec, grant, now, refreshExpiresAt ? { refreshExpiresAt } : undefined);
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
      id: newId(),
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

  /**
   * Fully disconnect a user's OAuth agent sessions for a project: revoke every non-revoked refresh
   * token (so it can't refresh back in) AND every in-flight OAuth access token. Used by the editor's
   * "disconnect agent" action — the per-key access-token revoke alone wouldn't stop a refresh.
   */
  async revokeAllForUserProject(userId: string, projectId: string, now: Date = new Date()): Promise<void> {
    // Both revokes in one transaction so a concurrent refresh can't slip a freshly-rotated
    // token + access key in between them: SQLite serializes writers, so the rotation either
    // commits first (and we then catch its new rows) or after (where its isNull(revokedAt)
    // rotation claim fails) — disconnect is therefore complete with no surviving access token.
    await this.db.transaction(async (tx) => {
      const exec = tx as unknown as Executor;
      await exec
        .update(oauthRefreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(oauthRefreshTokens.userId, userId), eq(oauthRefreshTokens.projectId, projectId), isNull(oauthRefreshTokens.revokedAt)));
      await exec
        .update(apiKeys)
        .set({ revokedAt: now })
        .where(and(eq(apiKeys.source, 'oauth'), eq(apiKeys.createdBy, userId), eq(apiKeys.projectId, projectId), isNull(apiKeys.revokedAt)));
    });
  }

  /**
   * Live OAuth/MCP agent sessions for a project — one entry per user that still holds a usable
   * session, i.e. a refresh-token chain whose tip is non-rotated, non-revoked and unexpired. This
   * represents a connection for the WHOLE session window (up to the absolute cap), NOT just while a
   * 1h access token happens to be valid — so a connected-but-idle agent stays visible. Grouped by
   * user because that's the disconnect granularity ({@link revokeAllForUserProject}).
   */
  async listActiveSessions(projectId: string, now: Date = new Date()): Promise<ActiveOAuthSession[]> {
    // One read transaction so the three queries see a consistent snapshot — a concurrent revoke
    // can't leave a tip present here but absent from the connectedAt set.
    return this.db.transaction(async (tx) => {
      const exec = tx as unknown as Executor;
      // Live tips: a non-rotated, non-revoked, unexpired refresh token = an agent that can still act.
      const tips = await exec
        .select()
        .from(oauthRefreshTokens)
        .where(
          and(
            eq(oauthRefreshTokens.projectId, projectId),
            isNull(oauthRefreshTokens.rotatedTo),
            isNull(oauthRefreshTokens.revokedAt),
            gt(oauthRefreshTokens.expiresAt, now),
          ),
        );
      if (tips.length === 0) return [];
      // Session start = earliest createdAt among the user's non-revoked refresh tokens (the chain root;
      // predecessors keep revokedAt=null for reuse-detection, so MIN spans the whole chain).
      const chainRows = await exec
        .select({ userId: oauthRefreshTokens.userId, createdAt: oauthRefreshTokens.createdAt })
        .from(oauthRefreshTokens)
        .where(and(eq(oauthRefreshTokens.projectId, projectId), isNull(oauthRefreshTokens.revokedAt)));
      const connectedAtByUser = new Map<string, number>();
      for (const r of chainRows) {
        const prev = connectedAtByUser.get(r.userId);
        if (prev === undefined || r.createdAt.getTime() < prev) connectedAtByUser.set(r.userId, r.createdAt.getTime());
      }
      // Last activity = the user's most recent still-valid (non-revoked) OAuth access-token use; a
      // disconnected session's old tokens must not back-date a freshly-reconnected one.
      const accessRows = await exec
        .select({ createdBy: apiKeys.createdBy, lastUsedAt: apiKeys.lastUsedAt })
        .from(apiKeys)
        .where(and(eq(apiKeys.projectId, projectId), eq(apiKeys.source, 'oauth'), isNull(apiKeys.revokedAt)));
      const lastUsedByUser = new Map<string, number>();
      for (const a of accessRows) {
        if (!a.lastUsedAt) continue;
        const prev = lastUsedByUser.get(a.createdBy) ?? 0;
        if (a.lastUsedAt.getTime() > prev) lastUsedByUser.set(a.createdBy, a.lastUsedAt.getTime());
      }
      // One row per user; if a user has multiple live tips keep the longest-lived (latest cap).
      const byUser = new Map<string, (typeof tips)[number]>();
      for (const t of tips) {
        const cur = byUser.get(t.userId);
        if (!cur || t.expiresAt.getTime() > cur.expiresAt.getTime()) byUser.set(t.userId, t);
      }
      return [...byUser.values()]
        .map((t) => ({
          userId: t.userId,
          clientId: t.clientId,
          role: t.role,
          capabilities: clampScope(t.scope),
          // The tip is non-revoked, so its user is always present in connectedAtByUser (same snapshot).
          connectedAt: new Date(connectedAtByUser.get(t.userId)!),
          expiresAt: t.expiresAt,
          lastUsedAt: lastUsedByUser.has(t.userId) ? new Date(lastUsedByUser.get(t.userId)!) : null,
        }))
        .sort((a, b) => (b.lastUsedAt?.getTime() ?? 0) - (a.lastUsedAt?.getTime() ?? 0) || b.connectedAt.getTime() - a.connectedAt.getTime());
    });
  }
}

/** A live OAuth/MCP agent session for a project (one per connected user). */
export interface ActiveOAuthSession {
  userId: string;
  clientId: string;
  role: ProjectRole;
  capabilities: ApiKeyCapability[];
  /** When the session was first established (chain root). */
  connectedAt: Date;
  /** Absolute session cap — re-auth required past this. */
  expiresAt: Date;
  /** Most recent agent activity, or null if it has connected but not yet acted. */
  lastUsedAt: Date | null;
}

/** Keep only known capabilities, in canonical order (defends against tampered/stale rows). */
function clampScope(scope: ApiKeyCapability[]): ApiKeyCapability[] {
  return API_KEY_CAPABILITIES.filter((c) => scope.includes(c));
}
