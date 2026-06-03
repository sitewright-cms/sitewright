import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { projectMembers, projects, users, type PlatformRole, type ProjectRole } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
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
  const userId = randomUUID();
  const passwordHash = await hashPassword(password);
  await db
    .insert(users)
    .values({ id: userId, email: normalizedEmail, passwordHash, platformRole: opts.platformRole ?? null, createdAt: now });
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

/** The user's normalized email, or null if the user no longer exists. */
export async function getUserEmail(db: Database, userId: string): Promise<string | null> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  return user?.email ?? null;
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
      .from(projects);
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
    id: randomUUID(),
    userId,
    projectId,
    role,
    createdAt: new Date(),
  });
}
