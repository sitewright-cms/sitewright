import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { sessions } from '../db/schema.js';

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
  const id = tokenId(token);
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
  if (!row) return null;
  if (row.expiresAt.getTime() <= now.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  return row.userId;
}

/** Revokes a session (logout). No-op if the token is unknown. */
export async function revokeSession(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, tokenId(token)));
}
