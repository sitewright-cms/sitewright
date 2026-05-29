import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { memberships, organizations, users, type OrgRole } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { ConflictError, ForbiddenError, UnauthorizedError, type TenantContext } from './context.js';

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
