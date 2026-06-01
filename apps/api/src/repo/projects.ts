import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  apiKeys,
  content,
  formSubmissions,
  invites,
  oauthAuthCodes,
  oauthDeviceCodes,
  oauthRefreshTokens,
  projectMembers,
  projects,
  type OrgRole,
} from '../db/schema.js';
import { ConflictError, ForbiddenError, NotFoundError, type TenantContext } from './context.js';

const WRITE_ROLES: ReadonlySet<OrgRole> = new Set(['owner', 'admin']);

/** Guards write operations: only owners/admins may mutate; members are read-only. */
function requireWriteRole(ctx: TenantContext): void {
  if (!WRITE_ROLES.has(ctx.role)) {
    throw new ForbiddenError('insufficient role for this operation');
  }
}

export interface Project {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  createdAt: Date;
}

export interface CreateProjectInput {
  name: string;
  slug: string;
}

/**
 * Tenant-scoped data access for projects. Every method requires a
 * {@link TenantContext} and filters by `ctx.orgId`; there is deliberately no
 * method that fetches a project by id alone, so one org can never reach
 * another's data.
 */
export class ProjectRepository {
  constructor(private readonly db: Database) {}

  /** Projects in the caller's org only. */
  async list(ctx: TenantContext): Promise<Project[]> {
    return this.db.select().from(projects).where(eq(projects.orgId, ctx.orgId));
  }

  /** A project by id, scoped to the caller's org; throws NotFound if absent or owned by another org. */
  async get(ctx: TenantContext, id: string): Promise<Project> {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.orgId, ctx.orgId)));
    if (!project) throw new NotFoundError('project not found');
    return project;
  }

  /** Creates a project in the caller's org. Slug must be unique within the org. */
  async create(ctx: TenantContext, input: CreateProjectInput): Promise<Project> {
    requireWriteRole(ctx);
    const duplicate = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.orgId, ctx.orgId), eq(projects.slug, input.slug)));
    if (duplicate.length > 0) {
      throw new ConflictError('a project with this slug already exists in the organization');
    }
    const project: Project = {
      id: randomUUID(),
      orgId: ctx.orgId,
      name: input.name,
      slug: input.slug,
      createdAt: new Date(),
    };
    await this.db.insert(projects).values(project);
    return project;
  }

  /**
   * Deletes a project (scoped to the caller's org); throws NotFound if absent or
   * owned by another org. Cascades to the project's `content` rows in one
   * transaction — `content.project_id` has no DB-level `ON DELETE CASCADE`, so
   * deleting the project row alone would violate the FK (and used to 500). NOTE:
   * on-disk media/publish artifacts are not removed here (follow-up).
   */
  async remove(ctx: TenantContext, id: string): Promise<void> {
    requireWriteRole(ctx);
    await this.get(ctx, id); // enforces org ownership (NotFound otherwise)
    await this.db.transaction(async (tx) => {
      // Safe to delete by projectId alone: get() above proved this project (a
      // globally-unique UUID) belongs to ctx.orgId, so no other org's content matches.
      await tx.delete(content).where(eq(content.projectId, id));
      // Form submissions reference the project (FK, no DB cascade) and hold visitor
      // PII — drop them with the project (else the project delete would FK-fail, and
      // the PII would linger). Deleted before the project row for FK ordering.
      await tx.delete(formSubmissions).where(eq(formSubmissions.projectId, id));
      // Also drop the project's API keys + OAuth grants so deleting a project
      // revokes all of its tokens (no orphaned rows that would otherwise linger).
      await tx.delete(apiKeys).where(eq(apiKeys.projectId, id));
      await tx.delete(oauthAuthCodes).where(eq(oauthAuthCodes.projectId, id));
      await tx.delete(oauthRefreshTokens).where(eq(oauthRefreshTokens.projectId, id));
      await tx.delete(oauthDeviceCodes).where(eq(oauthDeviceCodes.projectId, id));
      // Project-scoped client memberships + any (pending or accepted) project invites:
      // drop them so a deleted project leaves no orphaned access rows or dangling tokens.
      await tx.delete(projectMembers).where(eq(projectMembers.projectId, id));
      await tx.delete(invites).where(eq(invites.projectId, id));
      await tx.delete(projects).where(and(eq(projects.id, id), eq(projects.orgId, ctx.orgId)));
    });
  }
}
