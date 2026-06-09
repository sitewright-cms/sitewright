import { newId } from '../id.js';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { invites, projectMembers, projects, users, type PlatformRole, type ProjectRole } from '../db/schema.js';
import { generateInviteToken, hashInviteToken } from '../auth/invites.js';
import { ConflictError, ForbiddenError, NotFoundError } from './context.js';

/** How long an invite link stays valid. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The role an invite can grant — a platform role (no project) or a project role (with a project). */
export type InviteRole = PlatformRole | ProjectRole;
const PLATFORM_ROLES = new Set<string>(['admin', 'developer']);

export interface InviteView {
  id: string;
  email: string;
  role: InviteRole;
  /** null → a PLATFORM invite (grants a platform role); set → a PROJECT invite (grants a project role). */
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

export interface CreateInviteParams {
  email: string;
  role: InviteRole;
  /** Set → a project invite (role must be owner|member); omitted → a platform invite (admin|developer). */
  projectId?: string;
}

/**
 * Creates a pending invite and returns its one-time token (embedded in the link; never stored in
 * plaintext). A PLATFORM invite (no projectId) grants `admin`/`developer`; a PROJECT invite grants
 * `owner`/`member` and its project must exist. The CALLER's authority is gated at the route (platform
 * admin for platform invites; project owner or platform admin for project invites).
 */
export async function createInvite(
  db: Database,
  invitedByUserId: string,
  params: CreateInviteParams,
): Promise<{ invite: InviteView; token: string }> {
  const email = params.email.trim().toLowerCase();
  if (!email) throw new ConflictError('email is required');

  if (params.projectId) {
    // A project invite only ever grants `member`. The project's single `owner` is its client (set
    // at creation / via membership management) — there is no "invite a co-owner" path, so the role
    // is fixed here rather than trusted from the caller.
    if (params.role !== 'member') throw new ConflictError('a project invite may only grant the member role');
    const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, params.projectId));
    if (!project) throw new NotFoundError('project not found');
  } else {
    if (!PLATFORM_ROLES.has(params.role)) throw new ConflictError('a platform invite must grant admin|developer');
  }

  // Supersede any earlier PENDING invite to the same recipient + target, so there is only ever one
  // live token per (email, target) — re-inviting refreshes the link.
  const sameTarget = params.projectId ? eq(invites.projectId, params.projectId) : isNull(invites.projectId);
  await db.delete(invites).where(and(eq(invites.email, email), sameTarget, isNull(invites.acceptedAt)));

  const { token, tokenHash } = generateInviteToken();
  const now = new Date();
  const row = {
    id: newId(),
    projectId: params.projectId ?? null,
    email,
    role: params.role,
    tokenHash,
    invitedBy: invitedByUserId,
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    acceptedAt: null,
    acceptedBy: null,
    createdAt: now,
  };
  await db.insert(invites).values(row);
  return { invite: toView(row), token };
}

/**
 * Whether `email` has at least one pending (unaccepted, unexpired) invite. Public registration is
 * invitation-only, so the register route uses this to admit only invited emails.
 */
export async function hasPendingInvite(db: Database, email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const rows = await db
    .select({ id: invites.id })
    .from(invites)
    .where(and(eq(invites.email, normalized), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())))
    .limit(1);
  return rows.length > 0;
}

/**
 * Pending (unaccepted, unexpired) invites: all platform invites, or a single project's (when
 * `projectId` is given). Expired-but-unaccepted rows are excluded — they can't be acted on, so the
 * management list shows only live invites. Route-gated.
 */
export async function listInvites(db: Database, opts: { projectId?: string } = {}): Promise<InviteView[]> {
  const live = and(isNull(invites.acceptedAt), gt(invites.expiresAt, new Date()));
  const where = opts.projectId
    ? and(live, eq(invites.projectId, opts.projectId))
    : and(live, isNull(invites.projectId));
  const rows = await db.select().from(invites).where(where);
  return rows.map(toView);
}

/** The (projectId, scope) of a pending invite, for the route to verify the caller may revoke it. */
export async function getInvite(db: Database, inviteId: string): Promise<{ projectId: string | null } | null> {
  const [row] = await db.select({ projectId: invites.projectId }).from(invites).where(eq(invites.id, inviteId));
  return row ? { projectId: row.projectId ?? null } : null;
}

/** Revokes (deletes) a pending invite by id (route-gated). */
export async function revokeInvite(db: Database, inviteId: string): Promise<void> {
  const [row] = await db.select({ id: invites.id }).from(invites).where(eq(invites.id, inviteId));
  if (!row) throw new NotFoundError('invite not found');
  await db.delete(invites).where(eq(invites.id, inviteId));
}

export interface InvitePeek {
  /** The invited email, MASKED — enough for the recipient to recognize, not to disclose. */
  email: string;
  role: InviteRole;
  projectName: string | null;
  expired: boolean;
  accepted: boolean;
}

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(2, local.length - 1))}@${domain}`;
}

/** Context of an invite token for the accept screen (the holder already has the token). Null if unknown. */
export async function peekInvite(db: Database, token: string, now: Date = new Date()): Promise<InvitePeek | null> {
  const [row] = await db
    .select({
      email: invites.email,
      role: invites.role,
      projectName: projects.name,
      expiresAt: invites.expiresAt,
      acceptedAt: invites.acceptedAt,
    })
    .from(invites)
    .leftJoin(projects, eq(invites.projectId, projects.id))
    .where(eq(invites.tokenHash, hashInviteToken(token)));
  if (!row) return null;
  return {
    email: maskEmail(row.email),
    role: row.role,
    projectName: row.projectName ?? null,
    expired: row.expiresAt.getTime() < now.getTime(),
    accepted: row.acceptedAt != null,
  };
}

export interface AcceptedInvite {
  projectId: string | null;
  role: InviteRole;
}

/**
 * Accepts an invite for the signed-in user (email must match the invited email — a leaked link is
 * useless to anyone else). Materializes the grant: a `project_members` row for a project invite, or
 * sets the user's `platform_role` for a platform invite. Idempotent + single-use (atomic CAS).
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
          id: newId(),
          userId,
          projectId: invite.projectId,
          role: invite.role as ProjectRole,
          createdAt: now,
        });
      } else {
        // Already a member — apply the (possibly upgraded) role so accepting a fresh invite is a
        // true upsert, consistent with addProjectMember.
        await tx
          .update(projectMembers)
          .set({ role: invite.role as ProjectRole })
          .where(and(eq(projectMembers.userId, userId), eq(projectMembers.projectId, invite.projectId)));
      }
    } else {
      // Platform invite → set the user's platform role (admin|developer).
      await tx.update(users).set({ platformRole: invite.role as PlatformRole }).where(eq(users.id, userId));
    }
  });

  return { projectId: invite.projectId ?? null, role: invite.role };
}
