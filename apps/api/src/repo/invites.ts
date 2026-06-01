import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  invites,
  memberships,
  organizations,
  projectMembers,
  projects,
  users,
  type OrgRole,
} from '../db/schema.js';
import { generateInviteToken, hashInviteToken } from '../auth/invites.js';
import { getProjectMembership } from './accounts.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type TenantContext,
} from './context.js';

/** Org roles allowed to manage invites (and members). */
const MANAGE_ROLES: ReadonlySet<OrgRole> = new Set<OrgRole>(['owner', 'admin']);
/** How long an invite link stays valid. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface InviteView {
  id: string;
  email: string;
  role: OrgRole;
  /** null → an org-level developer invite; set → a project-scoped client invite. */
  projectId: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}

function toView(row: typeof invites.$inferSelect): InviteView {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    projectId: row.projectId ?? null,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt ?? null,
    createdAt: row.createdAt,
  };
}

function requireManage(ctx: TenantContext): void {
  if (!MANAGE_ROLES.has(ctx.role)) {
    throw new ForbiddenError('insufficient role to manage invites');
  }
}

export interface CreateInviteParams {
  email: string;
  role: OrgRole;
  /** Required for a client (member) invite; must be omitted for a developer invite. */
  projectId?: string;
}

/**
 * Creates a pending invite and returns its one-time token (embedded in the invite link;
 * never stored in plaintext). Owner/admin only. A client invite (`role: 'member'`) MUST
 * carry a projectId that belongs to this org; a developer invite (`role: 'admin'`) MUST
 * NOT. `owner` can never be granted through an invite.
 */
export async function createInvite(
  db: Database,
  ctx: TenantContext,
  params: CreateInviteParams,
): Promise<{ invite: InviteView; token: string }> {
  requireManage(ctx);
  const email = params.email.trim().toLowerCase();
  if (!email) throw new ConflictError('email is required');

  if (params.role === 'owner') {
    throw new ForbiddenError('an invite cannot grant the owner role');
  }
  if (params.role === 'member') {
    if (!params.projectId) throw new ConflictError('a client invite requires a project');
  } else if (params.role === 'admin') {
    if (params.projectId) throw new ConflictError('a developer invite cannot target a project');
  } else {
    throw new ForbiddenError('unsupported invite role');
  }

  // A client invite's project must belong to the inviter's org (no cross-tenant invite).
  if (params.projectId) {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, params.projectId), eq(projects.orgId, ctx.orgId)));
    if (!project) throw new NotFoundError('project not found');
  }

  // Supersede any earlier PENDING invite to the same recipient + target, so there is
  // only ever one live token per (email, org, project) — re-inviting refreshes the link
  // and revoking the latest leaves none dangling.
  const sameTarget = params.projectId
    ? eq(invites.projectId, params.projectId)
    : isNull(invites.projectId);
  await db
    .delete(invites)
    .where(and(eq(invites.orgId, ctx.orgId), eq(invites.email, email), sameTarget, isNull(invites.acceptedAt)));

  const { token, tokenHash } = generateInviteToken();
  const now = new Date();
  const row = {
    id: randomUUID(),
    orgId: ctx.orgId,
    projectId: params.projectId ?? null,
    email,
    role: params.role,
    tokenHash,
    invitedBy: ctx.userId,
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    acceptedAt: null,
    acceptedBy: null,
    createdAt: now,
  };
  await db.insert(invites).values(row);
  return { invite: toView(row), token };
}

/** Lists the org's PENDING (unaccepted) invites; optionally only a project's. Owner/admin. */
export async function listInvites(
  db: Database,
  ctx: TenantContext,
  opts: { projectId?: string } = {},
): Promise<InviteView[]> {
  requireManage(ctx);
  const where = opts.projectId
    ? and(eq(invites.orgId, ctx.orgId), isNull(invites.acceptedAt), eq(invites.projectId, opts.projectId))
    : and(eq(invites.orgId, ctx.orgId), isNull(invites.acceptedAt));
  const rows = await db.select().from(invites).where(where);
  return rows.map(toView);
}

/** Revokes (deletes) a pending invite scoped to the caller's org. Owner/admin. */
export async function revokeInvite(db: Database, ctx: TenantContext, inviteId: string): Promise<void> {
  requireManage(ctx);
  const [row] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(and(eq(invites.id, inviteId), eq(invites.orgId, ctx.orgId)));
  if (!row) throw new NotFoundError('invite not found');
  await db.delete(invites).where(and(eq(invites.id, inviteId), eq(invites.orgId, ctx.orgId)));
}

export interface InvitePeek {
  /** The invited email, MASKED — enough for the recipient to recognize, not to disclose. */
  email: string;
  role: OrgRole;
  orgName: string;
  projectName: string | null;
  expired: boolean;
  accepted: boolean;
}

/** Masks an email for the public peek so a leaked link does not disclose the recipient. */
function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(2, local.length - 1))}@${domain}`;
}

/**
 * Returns the context of an invite token for the accept screen (the holder already has
 * the token, so this leaks nothing they were not sent). Returns null for an unknown token.
 */
export async function peekInvite(db: Database, token: string, now: Date = new Date()): Promise<InvitePeek | null> {
  const [row] = await db
    .select({
      email: invites.email,
      role: invites.role,
      orgName: organizations.name,
      projectName: projects.name,
      expiresAt: invites.expiresAt,
      acceptedAt: invites.acceptedAt,
    })
    .from(invites)
    .innerJoin(organizations, eq(invites.orgId, organizations.id))
    .leftJoin(projects, eq(invites.projectId, projects.id))
    .where(eq(invites.tokenHash, hashInviteToken(token)));
  if (!row) return null;
  return {
    email: maskEmail(row.email),
    role: row.role,
    orgName: row.orgName,
    projectName: row.projectName ?? null,
    expired: row.expiresAt.getTime() < now.getTime(),
    accepted: row.acceptedAt != null,
  };
}

export interface AcceptedInvite {
  orgId: string;
  projectId: string | null;
  role: OrgRole;
}

/**
 * Accepts an invite for the signed-in user. The token must be valid, unexpired, and
 * unused, AND the user's email must equal the invited email — so a leaked link is
 * useless to anyone but the intended recipient. Materializes the membership: a
 * project-scoped `project_members` row for a client invite, an org `memberships` row
 * for a developer invite. Idempotent if the membership already exists.
 */
export async function acceptInvite(
  db: Database,
  userId: string,
  token: string,
  now: Date = new Date(),
): Promise<AcceptedInvite> {
  const [invite] = await db.select().from(invites).where(eq(invites.tokenHash, hashInviteToken(token)));
  if (!invite) throw new NotFoundError('invite not found');
  if (invite.acceptedAt) throw new ConflictError('this invite has already been used');
  if (invite.expiresAt.getTime() < now.getTime()) throw new ForbiddenError('this invite has expired');

  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!user) throw new NotFoundError('user not found');
  if (user.email !== invite.email) {
    throw new ForbiddenError('this invite was sent to a different email address');
  }

  await db.transaction(async (tx) => {
    // Claim the invite ATOMICALLY first: only the first of any concurrent accepts flips
    // acceptedAt from null, so a token can never be consumed twice (RETURNING is the
    // affected-row signal). This must precede the membership insert.
    const claimed = await tx
      .update(invites)
      .set({ acceptedAt: now, acceptedBy: userId })
      .where(and(eq(invites.id, invite.id), isNull(invites.acceptedAt)))
      .returning({ id: invites.id });
    if (claimed.length === 0) throw new ConflictError('this invite has already been used');

    if (invite.projectId) {
      const existing = await tx
        .select({ id: projectMembers.id })
        .from(projectMembers)
        .where(and(eq(projectMembers.userId, userId), eq(projectMembers.projectId, invite.projectId)));
      if (existing.length === 0) {
        await tx.insert(projectMembers).values({
          id: randomUUID(),
          userId,
          projectId: invite.projectId,
          role: 'member',
          createdAt: now,
        });
      }
    } else {
      const existing = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, userId), eq(memberships.orgId, invite.orgId)));
      if (existing.length === 0) {
        await tx
          .insert(memberships)
          .values({ id: randomUUID(), userId, orgId: invite.orgId, role: invite.role, createdAt: now });
      }
    }
  });

  return { orgId: invite.orgId, projectId: invite.projectId ?? null, role: invite.role };
}

/** Removes a project-scoped client from a project. Owner/admin only; tenant-scoped. */
export async function removeProjectMember(
  db: Database,
  ctx: TenantContext,
  projectId: string,
  userId: string,
): Promise<void> {
  requireManage(ctx);
  // Confirm the project is in the caller's org before touching its members.
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)));
  if (!project) throw new NotFoundError('project not found');
  const role = await getProjectMembership(db, userId, projectId);
  if (!role) throw new NotFoundError('membership not found');
  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.userId, userId), eq(projectMembers.projectId, projectId)));
}

export interface ProjectMemberView {
  userId: string;
  email: string;
  role: OrgRole;
  createdAt: Date;
}

/** Lists a project's client members (project-scoped). Owner/admin only. */
export async function listProjectMembers(
  db: Database,
  ctx: TenantContext,
  projectId: string,
): Promise<ProjectMemberView[]> {
  requireManage(ctx);
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)));
  if (!project) throw new NotFoundError('project not found');
  return db
    .select({
      userId: users.id,
      email: users.email,
      role: projectMembers.role,
      createdAt: projectMembers.createdAt,
    })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, projectId));
}
