import { newId } from '../id.js';
import { and, count, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  memberTokenCreations,
  memberTokenProjects,
  memberTokens,
  MEMBER_TOKEN_CAPABILITIES,
  users,
  type MemberTokenCapability,
} from '../db/schema.js';
import { generateMemberToken, hashApiToken, isMemberTokenFormat } from '../auth/api-keys.js';
import { MAX_API_KEY_TTL_MS } from './api-keys.js';
import { ForbiddenError, NotFoundError } from './context.js';

/** Live (unrevoked, unexpired) member tokens one account may hold at a time. */
export const MAX_ACTIVE_MEMBER_TOKENS = 25;

/** How often, at most, a token's last-use (overall, and per project) is written back. Activity is a
 *  display signal, not an audit log — one write a minute says "still in use" without two DB writes on
 *  every agent request. */
const USE_WRITE_INTERVAL_MS = 60_000;
const USE_CACHE_MAX = 5_000;

const CAPABILITY_SET: ReadonlySet<string> = new Set(MEMBER_TOKEN_CAPABILITIES);

export interface CreateMemberTokenInput {
  name: string;
  capabilities: MemberTokenCapability[];
  expiresAt: Date;
  /** New projects per 24 hours; omitted → the instance maximum. Kept only with `projects:create`. */
  dailyProjectLimit?: number;
}

/** Redacted view of a member token — never includes the hash or the raw token. */
export interface MemberTokenView {
  id: string;
  name: string;
  capabilities: MemberTokenCapability[];
  tokenPrefix: string;
  /** The token's own cap on new projects per 24 hours, or null for "the instance maximum". */
  dailyProjectLimit: number | null;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

/** Why a token does or does not work right now. `suspended`: its owner is no longer staff. */
export type MemberTokenStatus = 'active' | 'expired' | 'revoked' | 'suspended';

/** One row of the instance-wide list an admin sees: every member's tokens, with who owns each. */
export interface MemberTokenAdminView extends MemberTokenView {
  owner: { userId: string; email: string; role: 'admin' | 'developer' | null };
  status: MemberTokenStatus;
  /** Projects this token has acted on (the rows a project's agent-connections list is built from). */
  projectsUsed: number;
  /** Projects it created in the last 24 hours — what its daily limit is counted against. */
  projectsCreatedToday: number;
}

/** What a successfully-resolved member token grants: an identity and a capability ceiling. The role
 *  is NOT here — it is looked up per project, per request, from the member's current access. */
export interface ResolvedMemberToken {
  tokenId: string;
  userId: string;
  capabilities: MemberTokenCapability[];
  /** The token's own daily cap on new projects, or null — see `memberTokens.dailyProjectLimit`. */
  dailyProjectLimit: number | null;
}

/** A member token that has acted on a project, for that project's "connected agents" list. */
export interface MemberTokenConnection {
  tokenId: string;
  userId: string;
  ownerEmail: string;
  name: string;
  capabilities: MemberTokenCapability[];
  expiresAt: Date;
  firstUsedAt: Date;
  lastUsedAt: Date;
}

function toView(row: typeof memberTokens.$inferSelect): MemberTokenView {
  return {
    id: row.id,
    name: row.name,
    capabilities: row.capabilities,
    tokenPrefix: row.tokenPrefix,
    dailyProjectLimit: row.dailyProjectLimit ?? null,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}

const isStaffRole = (role: string | null | undefined): boolean => role === 'admin' || role === 'developer';

/**
 * Store for member tokens — bearer tokens owned by a staff MEMBER, not by a project.
 *
 * Management ({@link create}/{@link list}/{@link revoke}) is scoped to the owning user; the HTTP layer
 * makes it session-only, so a token can never mint, list or revoke tokens. {@link resolve} is the auth
 * entry point: it answers "whose token is this and what may it do", and leaves "on which project, at
 * what role" to the caller, which asks the membership tables on every request.
 */
export class MemberTokenRepository {
  /** `${tokenId}` and `${tokenId}:${projectId}` → when that use was last written (see
   *  USE_WRITE_INTERVAL_MS). */
  private readonly useWrittenAt = new Map<string, number>();

  /** Whether a use under `key` is due to be written, claiming the slot if so. */
  private dueForWrite(key: string, now: Date): boolean {
    const last = this.useWrittenAt.get(key);
    if (last !== undefined && now.getTime() - last < USE_WRITE_INTERVAL_MS) return false;
    if (this.useWrittenAt.size >= USE_CACHE_MAX) this.useWrittenAt.clear(); // bound memory; refill is one write each
    this.useWrittenAt.set(key, now.getTime());
    return true;
  }

  constructor(private readonly db: Database) {}

  async create(
    userId: string,
    input: CreateMemberTokenInput,
    now: Date = new Date(),
  ): Promise<{ token: string; key: MemberTokenView }> {
    // Staff only, checked HERE as well as at the route: this is the one place a token comes into
    // being, so the rule cannot be skipped by a second caller that forgot the gate.
    const [owner] = await this.db.select({ role: users.platformRole }).from(users).where(eq(users.id, userId));
    if (!isStaffRole(owner?.role)) throw new ForbiddenError('only agency staff can create member tokens');
    if (input.capabilities.length === 0) throw new ForbiddenError('a token must grant at least one capability');
    for (const cap of input.capabilities) {
      if (!CAPABILITY_SET.has(cap)) throw new ForbiddenError(`unknown capability: ${cap}`);
    }
    if (input.dailyProjectLimit !== undefined && !(Number.isInteger(input.dailyProjectLimit) && input.dailyProjectLimit >= 1)) {
      throw new ForbiddenError('the daily project limit must be a whole number of at least 1');
    }
    const ttl = input.expiresAt.getTime() - now.getTime();
    if (ttl <= 0) throw new ForbiddenError('expiry must be in the future');
    if (ttl > MAX_API_KEY_TTL_MS) throw new ForbiddenError('expiry exceeds the maximum token lifetime');
    const [active] = await this.db
      .select({ n: count() })
      .from(memberTokens)
      .where(and(eq(memberTokens.userId, userId), isNull(memberTokens.revokedAt), gt(memberTokens.expiresAt, now)));
    if ((active?.n ?? 0) >= MAX_ACTIVE_MEMBER_TOKENS) {
      throw new ForbiddenError(`you already have ${MAX_ACTIVE_MEMBER_TOKENS} active member tokens — revoke one first`);
    }

    const { token, tokenHash, tokenPrefix } = generateMemberToken();
    const id = newId();
    // De-duplicate + freeze the capability list in canonical order.
    const capabilities = MEMBER_TOKEN_CAPABILITIES.filter((c) => input.capabilities.includes(c));
    const row: typeof memberTokens.$inferInsert = {
      id,
      userId,
      name: input.name,
      capabilities,
      tokenHash,
      tokenPrefix,
      // A limit on creating projects means nothing on a token that cannot create them.
      dailyProjectLimit: capabilities.includes('projects:create') ? (input.dailyProjectLimit ?? null) : null,
      expiresAt: input.expiresAt,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: now,
    };
    await this.db.insert(memberTokens).values(row);
    return { token, key: toView({ ...row, dailyProjectLimit: row.dailyProjectLimit ?? null, revokedAt: null, lastUsedAt: null }) };
  }

  /** The caller's own unrevoked tokens, newest first. An expired one is still listed, so its owner
   *  can see why an automation stopped and rotate it. */
  async list(userId: string): Promise<MemberTokenView[]> {
    const rows = await this.db
      .select()
      .from(memberTokens)
      .where(and(eq(memberTokens.userId, userId), isNull(memberTokens.revokedAt)));
    return rows.map(toView).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** Revokes one of the caller's OWN tokens. NotFound if it is not theirs (or is already revoked) —
   *  the same answer either way, so a token id cannot be probed across accounts. */
  async revoke(userId: string, tokenId: string, now: Date = new Date()): Promise<void> {
    const [row] = await this.db
      .select({ id: memberTokens.id })
      .from(memberTokens)
      .where(and(eq(memberTokens.id, tokenId), eq(memberTokens.userId, userId), isNull(memberTokens.revokedAt)));
    if (!row) throw new NotFoundError('member token not found');
    await this.db.update(memberTokens).set({ revokedAt: now }).where(eq(memberTokens.id, tokenId));
  }

  /** The owner of a live (unrevoked) token, or null. For the routes that let someone OTHER than the
   *  owner cut a token off, which must decide who is asking before they revoke. */
  async ownerOf(tokenId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ userId: memberTokens.userId })
      .from(memberTokens)
      .where(and(eq(memberTokens.id, tokenId), isNull(memberTokens.revokedAt)));
    return row?.userId ?? null;
  }

  /** Revokes every live token an account holds, and says how many that was. */
  async revokeAllForUser(userId: string, now: Date = new Date()): Promise<number> {
    const revoked = await this.db
      .update(memberTokens)
      .set({ revokedAt: now })
      .where(and(eq(memberTokens.userId, userId), isNull(memberTokens.revokedAt)))
      .returning({ id: memberTokens.id });
    return revoked.length;
  }

  /** How many tokens of this account still work (unrevoked and unexpired). */
  async countLive(userId: string, now: Date = new Date()): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(memberTokens)
      .where(and(eq(memberTokens.userId, userId), isNull(memberTokens.revokedAt), gt(memberTokens.expiresAt, now)));
    return row?.n ?? 0;
  }

  /**
   * Every member token on the instance that housekeeping has not yet removed, with its owner — the
   * admin's view. Working tokens first, then the most recently used. Dead ones stay listed for as
   * long as their rows do (see `reapDeadPats`), because "which token was that, and when did it stop"
   * is exactly what an admin opens this list to answer.
   */
  async listAll(now: Date = new Date()): Promise<MemberTokenAdminView[]> {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [rows, used, created] = await Promise.all([
      this.db
        .select({ token: memberTokens, ownerEmail: users.email, ownerRole: users.platformRole })
        .from(memberTokens)
        .innerJoin(users, eq(users.id, memberTokens.userId)),
      this.db
        .select({ tokenId: memberTokenProjects.tokenId, n: count() })
        .from(memberTokenProjects)
        .groupBy(memberTokenProjects.tokenId),
      this.db
        .select({ tokenId: memberTokenCreations.tokenId, n: count() })
        .from(memberTokenCreations)
        .where(gt(memberTokenCreations.createdAt, since))
        .groupBy(memberTokenCreations.tokenId),
    ]);
    const usedBy = new Map(used.map((r) => [r.tokenId, r.n]));
    const createdBy = new Map(created.map((r) => [r.tokenId, r.n]));
    const statusOf = (row: (typeof rows)[number]): MemberTokenStatus => {
      if (row.token.revokedAt !== null) return 'revoked';
      if (row.token.expiresAt.getTime() <= now.getTime()) return 'expired';
      return isStaffRole(row.ownerRole) ? 'active' : 'suspended';
    };
    const lastActivity = (v: MemberTokenAdminView): number => (v.lastUsedAt ?? v.createdAt).getTime();
    return rows
      .map((row): MemberTokenAdminView => ({
        ...toView(row.token),
        owner: { userId: row.token.userId, email: row.ownerEmail, role: row.ownerRole },
        status: statusOf(row),
        projectsUsed: usedBy.get(row.token.id) ?? 0,
        projectsCreatedToday: createdBy.get(row.token.id) ?? 0,
      }))
      .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || lastActivity(b) - lastActivity(a));
  }

  /**
   * Resolves a raw token to its owner + capabilities, or null if it is unknown, revoked, expired, or
   * its owner is no longer staff. On success, best-effort stamps `lastUsedAt`.
   *
   * ★ The staff check reads the owner's role NOW. A member token is a staff privilege, so it has to
   * end the moment the privilege does — not whenever someone remembers to revoke it.
   */
  async resolve(token: string, now: Date = new Date()): Promise<ResolvedMemberToken | null> {
    if (!isMemberTokenFormat(token)) return null;
    const [row] = await this.db
      .select({
        id: memberTokens.id,
        userId: memberTokens.userId,
        capabilities: memberTokens.capabilities,
        dailyProjectLimit: memberTokens.dailyProjectLimit,
        revokedAt: memberTokens.revokedAt,
        expiresAt: memberTokens.expiresAt,
        ownerRole: users.platformRole,
      })
      .from(memberTokens)
      .innerJoin(users, eq(users.id, memberTokens.userId))
      .where(eq(memberTokens.tokenHash, hashApiToken(token)));
    if (!row) return null;
    if (row.revokedAt !== null) return null;
    if (row.expiresAt.getTime() <= now.getTime()) return null;
    if (!isStaffRole(row.ownerRole)) return null;
    // Fire-and-forget: a failed stamp must never fail an otherwise-valid request (and is simply
    // retried by the next one).
    if (this.dueForWrite(row.id, now)) {
      void this.db
        .update(memberTokens)
        .set({ lastUsedAt: now })
        .where(eq(memberTokens.id, row.id))
        .catch(() => {
          this.useWrittenAt.delete(row.id);
        });
    }
    return { tokenId: row.id, userId: row.userId, capabilities: row.capabilities, dailyProjectLimit: row.dailyProjectLimit ?? null };
  }

  /**
   * Notes that a token acted on a project. Best-effort and rate-limited per (token, project): the
   * caller does not wait on it and a failure is swallowed, because nothing a request does may depend
   * on this row existing.
   */
  recordUse(tokenId: string, projectId: string, now: Date = new Date()): void {
    const key = `${tokenId}:${projectId}`;
    if (!this.dueForWrite(key, now)) return;
    void this.db
      .insert(memberTokenProjects)
      .values({ tokenId, projectId, firstUsedAt: now, lastUsedAt: now })
      .onConflictDoUpdate({
        target: [memberTokenProjects.tokenId, memberTokenProjects.projectId],
        set: { lastUsedAt: now },
      })
      .catch(() => {
        // Let the next request retry rather than treating a failed write as "recorded".
        this.useWrittenAt.delete(key);
      });
  }

  /**
   * Records that THIS token created a project: provenance, and what the daily cap counts. Awaited,
   * unlike {@link recordUse} — a creation that is not counted would not be capped.
   *
   * The ledger row does not follow its project: it is not removed if the project is later rolled back
   * or reaped (see `memberTokenCreations`). The activity row beside it is the ordinary per-project
   * one, so the new project lists this token as connected straight away.
   */
  async recordProjectCreated(tokenId: string, projectId: string, now: Date = new Date()): Promise<void> {
    await this.db.insert(memberTokenCreations).values({ id: newId(), tokenId, projectId, createdAt: now });
    await this.db
      .insert(memberTokenProjects)
      .values({ tokenId, projectId, firstUsedAt: now, lastUsedAt: now })
      .onConflictDoUpdate({
        target: [memberTokenProjects.tokenId, memberTokenProjects.projectId],
        set: { lastUsedAt: now },
      });
    this.useWrittenAt.set(`${tokenId}:${projectId}`, now.getTime());
  }

  /** How many projects this token has created since `since` — including any that no longer exist. */
  async countProjectsCreatedSince(tokenId: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(memberTokenCreations)
      .where(and(eq(memberTokenCreations.tokenId, tokenId), gt(memberTokenCreations.createdAt, since)));
    return row?.n ?? 0;
  }

  /** Live member tokens that have acted on a project, most recently active first. */
  async listConnectionsForProject(projectId: string, now: Date = new Date()): Promise<MemberTokenConnection[]> {
    const rows = await this.db
      .select({
        tokenId: memberTokens.id,
        userId: memberTokens.userId,
        ownerEmail: users.email,
        ownerRole: users.platformRole,
        name: memberTokens.name,
        capabilities: memberTokens.capabilities,
        expiresAt: memberTokens.expiresAt,
        firstUsedAt: memberTokenProjects.firstUsedAt,
        lastUsedAt: memberTokenProjects.lastUsedAt,
      })
      .from(memberTokenProjects)
      .innerJoin(memberTokens, eq(memberTokens.id, memberTokenProjects.tokenId))
      .innerJoin(users, eq(users.id, memberTokens.userId))
      .where(
        and(
          eq(memberTokenProjects.projectId, projectId),
          isNull(memberTokens.revokedAt),
          gt(memberTokens.expiresAt, now),
        ),
      );
    return rows
      // A token whose owner is no longer staff cannot authenticate, so it is not a connection.
      .filter((r) => isStaffRole(r.ownerRole))
      .map((r) => ({
        tokenId: r.tokenId,
        userId: r.userId,
        ownerEmail: r.ownerEmail,
        name: r.name,
        capabilities: r.capabilities,
        expiresAt: r.expiresAt,
        firstUsedAt: r.firstUsedAt,
        lastUsedAt: r.lastUsedAt,
      }))
      .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime());
  }
}
