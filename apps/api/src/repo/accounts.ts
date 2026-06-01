import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  memberships,
  organizations,
  projectMembers,
  projects,
  users,
  type OrgRole,
} from '../db/schema.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  type TenantContext,
} from './context.js';

/** Org roles permitted to manage the org's membership (add/list/remove clients). */
const MANAGE_ROLES: ReadonlySet<OrgRole> = new Set<OrgRole>(['owner', 'admin']);

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'org';
}

async function uniqueOrgSlug(db: Database, base: string): Promise<string> {
  let slug = base;
  let n = 1;
  while ((await db.select().from(organizations).where(eq(organizations.slug, slug))).length > 0) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

export interface RegisteredAccount {
  userId: string;
  orgId: string;
}

/** Registers a user and their initial organization (as `owner`). Email must be unique. */
export async function registerAccount(
  db: Database,
  email: string,
  password: string,
  orgName: string,
): Promise<RegisteredAccount> {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.select().from(users).where(eq(users.email, normalizedEmail));
  if (existing.length > 0) throw new ConflictError('email already registered');

  const now = new Date();
  const userId = randomUUID();
  const orgId = randomUUID();
  const passwordHash = await hashPassword(password);
  const slug = await uniqueOrgSlug(db, slugify(orgName));

  // Atomic: a crash mid-way must not leave an orphaned user or an owner-less org.
  await db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({ id: userId, email: normalizedEmail, passwordHash, createdAt: now });
    await tx.insert(organizations).values({ id: orgId, name: orgName, slug, createdAt: now });
    await tx
      .insert(memberships)
      .values({ id: randomUUID(), userId, orgId, role: 'owner', createdAt: now });
  });

  return { userId, orgId };
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

/** The user's role in an org, or null if they are not a member. */
export async function getMembership(
  db: Database,
  userId: string,
  orgId: string,
): Promise<OrgRole | null> {
  const [m] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)));
  return m?.role ?? null;
}

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
}

/** Organizations the user belongs to, with their role. */
export async function listOrgsForUser(db: Database, userId: string): Promise<OrgSummary[]> {
  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .where(eq(memberships.userId, userId));
}

export interface OrgMember {
  userId: string;
  email: string;
  role: OrgRole;
  createdAt: Date;
}

/** Lists the members of an org with their email + role. Owner/admin only. */
export async function listOrgMembers(db: Database, ctx: TenantContext): Promise<OrgMember[]> {
  if (!MANAGE_ROLES.has(ctx.role)) {
    throw new ForbiddenError('insufficient role to manage members');
  }
  return db
    .select({
      userId: users.id,
      email: users.email,
      role: memberships.role,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.orgId, ctx.orgId));
}

/**
 * Removes a member from the org. Owner/admin only. You cannot remove yourself, and an
 * `owner` membership can never be removed through this surface (owners are protected).
 */
export async function removeOrgMember(
  db: Database,
  ctx: TenantContext,
  userId: string,
): Promise<void> {
  if (!MANAGE_ROLES.has(ctx.role)) {
    throw new ForbiddenError('insufficient role to manage members');
  }
  if (userId === ctx.userId) {
    throw new ForbiddenError('you cannot remove yourself from the organization');
  }
  const target = await getMembership(db, userId, ctx.orgId);
  if (!target) throw new NotFoundError('membership not found');
  if (target === 'owner') throw new ForbiddenError('an owner cannot be removed');
  await db
    .delete(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, ctx.orgId)));
}

/** A user's role on a specific project via a project-scoped membership (client), or null. */
export async function getProjectMembership(
  db: Database,
  userId: string,
  projectId: string,
): Promise<OrgRole | null> {
  const [m] = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.userId, userId), eq(projectMembers.projectId, projectId)));
  return m?.role ?? null;
}

export interface ProjectAccess {
  orgId: string;
  orgName: string;
  orgSlug: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  role: OrgRole;
}

/**
 * Projects a user can reach via a project-scoped membership (the client tier), each
 * with its org info — so the dashboard can show a client only their own site(s) even
 * though they hold no org membership.
 */
export async function listProjectAccessForUser(
  db: Database,
  userId: string,
): Promise<ProjectAccess[]> {
  return db
    .select({
      orgId: organizations.id,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      projectId: projects.id,
      projectName: projects.name,
      projectSlug: projects.slug,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .where(eq(projectMembers.userId, userId));
}

/** Builds a {@link TenantContext} iff the user is a member of the org; else throws Forbidden. */
export async function tenantContext(
  db: Database,
  userId: string,
  orgId: string,
): Promise<TenantContext> {
  const role = await getMembership(db, userId, orgId);
  if (!role) throw new ForbiddenError('not a member of this organization');
  return { userId, orgId, role };
}
