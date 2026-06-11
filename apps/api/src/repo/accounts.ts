import { newId } from '../id.js';
import { and, eq, ne } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { projectMembers, projects, users, type PlatformRole, type ProjectRole } from '../db/schema.js';
import { GLOBAL_SCOPE_ID } from './global-library.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { acceptPendingInvitesForEmail, hasPendingInvite } from './invites.js';
import type { OidcRepository } from './oidc.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  type ProjectContext,
} from './context.js';

export interface RegisteredAccount {
  userId: string;
}

/**
 * Whether an error (or any error in its `cause` chain) is a SQLite UNIQUE-constraint violation.
 * Drizzle wraps the driver error, so the "UNIQUE constraint failed" text lives on `.cause`, not the
 * top-level message — we walk the chain (bounded) to find it.
 */
function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; depth < 5 && e instanceof Error; depth += 1) {
    if (/unique constraint failed|sqlite_constraint_unique/i.test(e.message)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Registers a user (email must be unique). A self-registered user is a plain account with NO
 * platform role and NO projects until invited; the seed passes `platformRole: 'admin'` to bootstrap
 * the agency owner.
 */
export async function registerAccount(
  db: Database,
  email: string,
  password: string,
  opts: { platformRole?: PlatformRole } = {},
): Promise<RegisteredAccount> {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.select().from(users).where(eq(users.email, normalizedEmail));
  if (existing.length > 0) throw new ConflictError('email already registered');
  const now = new Date();
  const userId = newId();
  const passwordHash = await hashPassword(password);
  try {
    await db
      .insert(users)
      .values({ id: userId, email: normalizedEmail, passwordHash, platformRole: opts.platformRole ?? null, createdAt: now });
  } catch (err) {
    // The pre-check above is racy: two concurrent registrations of the same email both pass it and
    // one loses the UNIQUE(email) insert. Map that to a clean ConflictError (409) instead of letting
    // a raw DB error surface as a 500. The constraint is the real guard; this is just the friendly face.
    if (isUniqueViolation(err)) throw new ConflictError('email already registered');
    throw err;
  }
  return { userId };
}

/** Verifies credentials and returns the userId, or throws {@link UnauthorizedError}. */
export async function login(db: Database, email: string, password: string): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail));
  if (!user) {
    // Hash anyway to keep timing uniform between unknown-email and wrong-password.
    await hashPassword(password);
    throw new UnauthorizedError('invalid credentials');
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new UnauthorizedError('invalid credentials');
  }
  return user.id;
}

/**
 * Provisions a PASSWORDLESS account for OIDC single sign-on (the email must already be normalized +
 * verified by the caller). Race-safe: a concurrent create that loses the UNIQUE(email) insert
 * re-resolves to the winning row.
 */
export async function registerOidcUser(db: Database, email: string): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();
  const userId = newId();
  try {
    await db.insert(users).values({ id: userId, email: normalizedEmail, passwordHash: null, platformRole: null, createdAt: new Date() });
    return userId;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail));
      if (u) return u.id;
    }
    throw err;
  }
}

export type OidcResolution = { ok: true; userId: string } | { ok: false; reason: 'email_unverified' | 'not_provisioned' };

/**
 * Maps verified OIDC claims to a local user:
 *  1. a prior `(issuer, subject)` identity → that user (the IdP email may have changed since);
 *  2. else — a verified email is REQUIRED — an existing account with that email → link it;
 *  3. else a pending invite for that email → provision a passwordless account + materialize the invite(s);
 *  4. else, when the provider has `autoRegister` on → provision a passwordless account (no invite needed);
 *  5. else denied (a stranger is auto-created ONLY when the provider opted into auto-register).
 * Auto-register still requires a verified email (the step-2 gate) and is independent of the instance
 * `allowSelfRegistration` toggle. The identity link is recorded/refreshed on every success.
 */
export async function resolveOidcUser(
  db: Database,
  oidcRepo: OidcRepository,
  claims: { issuer: string; subject: string; email: string | null; emailVerified: boolean },
  opts: { autoRegister?: boolean } = {},
): Promise<OidcResolution> {
  const linked = await oidcRepo.findUserByIdentity(claims.issuer, claims.subject);
  if (linked) {
    // The durable (issuer, subject) link IS the identity here — `email_verified` is required only at
    // FIRST federation (below); subsequent logins authenticate by the established link, not the email.
    await oidcRepo.linkIdentity({ userId: linked, issuer: claims.issuer, subject: claims.subject, email: claims.email });
    return { ok: true, userId: linked };
  }
  // First-time federation requires a verified email (prevents linking to an unowned address).
  if (!claims.email || !claims.emailVerified) return { ok: false, reason: 'email_unverified' };
  const email = claims.email.trim().toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) {
    await oidcRepo.linkIdentity({ userId: existing.id, issuer: claims.issuer, subject: claims.subject, email });
    return { ok: true, userId: existing.id };
  }
  // No account yet: provision one only if an invite is pending OR the provider auto-registers.
  const invited = await hasPendingInvite(db, email);
  if (!invited && !opts.autoRegister) return { ok: false, reason: 'not_provisioned' };
  const userId = await registerOidcUser(db, email);
  if (invited) await acceptPendingInvitesForEmail(db, userId, email);
  await oidcRepo.linkIdentity({ userId, issuer: claims.issuer, subject: claims.subject, email });
  return { ok: true, userId };
}

/** The user's normalized email, or null if the user no longer exists. */
export async function getUserEmail(db: Database, userId: string): Promise<string | null> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  return user?.email ?? null;
}

/** Whether the user has a password set (false for an OIDC-provisioned account that never set one). */
export async function userHasPassword(db: Database, userId: string): Promise<boolean> {
  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId));
  return user?.passwordHash != null;
}

/**
 * Re-authenticates the signed-in user by password (for security-weakening actions like disabling MFA
 * or rotating recovery codes). Derives a hash even when the user is missing, to keep timing uniform.
 */
export async function verifyUserPassword(db: Database, userId: string, password: string): Promise<boolean> {
  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId));
  if (!user) {
    await hashPassword(password);
    return false;
  }
  return verifyPassword(password, user.passwordHash);
}

/**
 * Changes the signed-in user's login email. Re-authenticates with the current password (a logged-in
 * session alone must not be enough to change the credential), normalizes + uniqueness-checks the new
 * email, and returns the stored (normalized) value. A wrong current password is a {@link
 * ForbiddenError} (403) — NOT 401 — so the editor doesn't mistake it for an expired session and log
 * the user out mid-edit. Changing to your own current email is a no-op success.
 */
export async function changeEmail(
  db: Database,
  userId: string,
  newEmail: string,
  currentPassword: string,
): Promise<{ email: string }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    // The userId comes from a validated session, so this only happens if the account was deleted
    // mid-session — but derive a hash anyway to keep timing uniform with the wrong-password path
    // (mirrors login()).
    await hashPassword(currentPassword);
    throw new UnauthorizedError('authentication required');
  }
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new ForbiddenError('current password is incorrect');
  }
  const normalizedEmail = newEmail.trim().toLowerCase();
  if (normalizedEmail === user.email) return { email: user.email };
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail));
  if (existing.length > 0) throw new ConflictError('email already registered');
  try {
    await db.update(users).set({ email: normalizedEmail }).where(eq(users.id, userId));
  } catch (err) {
    // The pre-check is racy (two concurrent changes to the same email); the UNIQUE(email) constraint
    // is the real guard — map its violation to a clean 409 rather than a raw 500.
    if (isUniqueViolation(err)) throw new ConflictError('email already registered');
    throw err;
  }
  return { email: normalizedEmail };
}

/**
 * Sets the signed-in user's password. When the account ALREADY has a password, the current one must
 * be supplied + verified (a wrong/absent one is a {@link ForbiddenError} 403, for the no-logout reason
 * in {@link changeEmail}). When the account has NO password (an OIDC-provisioned user setting one for
 * the first time), the session alone authorizes it — there is nothing to confirm. The caller revokes
 * the user's OTHER sessions afterward.
 */
export async function changePassword(
  db: Database,
  userId: string,
  currentPassword: string | undefined,
  newPassword: string,
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    if (currentPassword !== undefined) await hashPassword(currentPassword); // timing parity
    throw new UnauthorizedError('authentication required');
  }
  // An existing password must be confirmed; a null password (OIDC-only) is being set for the first time.
  if (user.passwordHash !== null) {
    if (currentPassword === undefined || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new ForbiddenError('current password is incorrect');
    }
  }
  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

/** The user's platform-staff role (`admin`/`developer`), or null for a client. */
export async function getPlatformRole(db: Database, userId: string): Promise<PlatformRole | null> {
  const [u] = await db.select({ role: users.platformRole }).from(users).where(eq(users.id, userId));
  return u?.role ?? null;
}

/** A user's role on a specific project via a project membership, or null. */
export async function getProjectMembership(
  db: Database,
  userId: string,
  projectId: string,
): Promise<ProjectRole | null> {
  const [m] = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.userId, userId), eq(projectMembers.projectId, projectId)));
  return m?.role ?? null;
}

/**
 * The caller's EFFECTIVE role on a project, or null if they can't reach it. A platform `admin`
 * reaches every project as `owner`; a `developer` or client reaches only projects they're a member
 * of. This is the single project-access gate (used by both the session and API-key paths).
 */
export async function resolveProjectRole(
  db: Database,
  userId: string,
  projectId: string,
): Promise<ProjectRole | null> {
  if ((await getPlatformRole(db, userId)) === 'admin') return 'owner';
  return getProjectMembership(db, userId, projectId);
}

export interface ProjectAccess {
  projectId: string;
  projectName: string;
  projectSlug: string;
  role: ProjectRole;
}

/**
 * Projects a user can reach: a platform `admin` sees ALL projects (as `owner`); everyone else sees
 * only the projects they hold a `project_members` row for. Powers the dashboard project list.
 */
export async function listProjectAccessForUser(db: Database, userId: string): Promise<ProjectAccess[]> {
  if ((await getPlatformRole(db, userId)) === 'admin') {
    const all = await db
      .select({ projectId: projects.id, projectName: projects.name, projectSlug: projects.slug })
      .from(projects)
      .where(ne(projects.id, GLOBAL_SCOPE_ID)); // hide the reserved global-library scope
    return all.map((p) => ({ ...p, role: 'owner' as ProjectRole }));
  }
  return db
    .select({
      projectId: projects.id,
      projectName: projects.name,
      projectSlug: projects.slug,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(eq(projectMembers.userId, userId));
}

export interface ProjectMemberView {
  userId: string;
  email: string;
  role: ProjectRole;
  createdAt: Date;
}

/** Members of a project (email + role). Project owner (or a platform admin, who resolves to owner) only. */
export async function listProjectMembers(db: Database, ctx: ProjectContext): Promise<ProjectMemberView[]> {
  if (ctx.role !== 'owner') throw new ForbiddenError('insufficient role to manage members');
  return db
    .select({
      userId: users.id,
      email: users.email,
      role: projectMembers.role,
      createdAt: projectMembers.createdAt,
    })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, ctx.projectId));
}

/** Removes a member from a project. Owner only; you cannot remove yourself or the project owner. */
export async function removeProjectMember(db: Database, ctx: ProjectContext, userId: string): Promise<void> {
  if (ctx.role !== 'owner') throw new ForbiddenError('insufficient role to manage members');
  if (userId === ctx.userId) throw new ForbiddenError('you cannot remove yourself from the project');
  const target = await getProjectMembership(db, userId, ctx.projectId);
  if (!target) throw new NotFoundError('membership not found');
  if (target === 'owner') throw new ForbiddenError('the project owner cannot be removed');
  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.userId, userId), eq(projectMembers.projectId, ctx.projectId)));
}

export interface PlatformUser {
  userId: string;
  email: string;
  platformRole: PlatformRole | null;
  createdAt: Date;
}

/** Every user with their platform role — for the platform-admin user-management surface. */
export async function listPlatformUsers(db: Database): Promise<PlatformUser[]> {
  return db
    .select({ userId: users.id, email: users.email, platformRole: users.platformRole, createdAt: users.createdAt })
    .from(users);
}

/** Promote/demote a user's platform role (or null to demote to a plain client). Platform-admin only (gated at the route). */
export async function setPlatformRole(db: Database, targetUserId: string, role: PlatformRole | null): Promise<void> {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetUserId));
  if (!u) throw new NotFoundError('user not found');
  await db.update(users).set({ platformRole: role }).where(eq(users.id, targetUserId));
}

/**
 * Grants `userId` a membership on `projectId` (idempotent — updates the role if a row already
 * exists). Used when a user creates a project (→ `owner`) and when seeding the Example Project. The
 * route gates WHO may add members; this is the raw write.
 */
export async function addProjectMember(
  db: Database,
  userId: string,
  projectId: string,
  role: ProjectRole,
): Promise<void> {
  const existing = await getProjectMembership(db, userId, projectId);
  if (existing) {
    await db
      .update(projectMembers)
      .set({ role })
      .where(and(eq(projectMembers.userId, userId), eq(projectMembers.projectId, projectId)));
    return;
  }
  await db.insert(projectMembers).values({
    id: newId(),
    userId,
    projectId,
    role,
    createdAt: new Date(),
  });
}
