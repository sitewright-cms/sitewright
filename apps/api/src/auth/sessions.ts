import { createHash, randomBytes } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { sessions, users } from '../db/schema.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

/** The session row id stores only the SHA-256 of the raw token, never the token itself. */
function tokenId(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface SessionResult {
  token: string;
  expiresAt: Date;
}

/** Creates a session for a user and returns the RAW token (only its hash is stored). */
export async function createSession(
  db: Database,
  userId: string,
  now: Date = new Date(),
): Promise<SessionResult> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: tokenId(token), userId, expiresAt, createdAt: now });
  return { token, expiresAt };
}

/** Resolves a raw token to its userId, or null if unknown/expired (expired rows are deleted). */
export async function validateSession(
  db: Database,
  token: string,
  now: Date = new Date(),
): Promise<string | null> {
  return (await resolveSession(db, token, now))?.userId ?? null;
}

/** A live session, with what the forced-password-change gate needs to know about its account. */
export interface ResolvedSession {
  userId: string;
  /** The account carries the forced-change flag (the seeded default admin, or a temporary password). */
  mustChangePassword: boolean;
  /** The account's password is a temporary one — see `users.passwordExpiresAt`. */
  passwordTemporary: boolean;
}

/**
 * {@link validateSession}, plus the account's password state in the SAME query. Every authenticated
 * request asks whether its account still has to replace its password, so reading that here costs
 * nothing extra; a second lookup per request would.
 */
export async function resolveSession(
  db: Database,
  token: string,
  now: Date = new Date(),
): Promise<ResolvedSession | null> {
  const id = tokenId(token);
  const [row] = await db
    .select({
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      mustChangePassword: users.mustChangePassword,
      passwordExpiresAt: users.passwordExpiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id));
  if (!row) return null;
  if (row.expiresAt.getTime() <= now.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  return {
    userId: row.userId,
    mustChangePassword: row.mustChangePassword,
    passwordTemporary: row.passwordExpiresAt !== null,
  };
}

/** Revokes a session (logout). No-op if the token is unknown. */
export async function revokeSession(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, tokenId(token)));
}

/**
 * Revokes every OTHER session for a user, keeping only the one matching `keepToken`. Called after a
 * password change so a stolen/leftover session elsewhere is cut off while the acting browser stays
 * signed in. If `keepToken` is unknown (e.g. its row already expired), this simply revokes all of the
 * user's sessions — fail safe.
 */
export async function revokeOtherSessions(db: Database, userId: string, keepToken: string): Promise<void> {
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, tokenId(keepToken))));
}
