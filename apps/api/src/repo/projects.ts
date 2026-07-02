import { newId } from '../id.js';
import { desc, eq, isNotNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  aiUsage,
  apiKeys,
  content,
  contentRevisions,
  formSubmissions,
  invites,
  oauthAuthCodes,
  oauthDeviceCodes,
  oauthRefreshTokens,
  projectMembers,
  projects,
} from '../db/schema.js';
import { ConflictError, NotFoundError } from './context.js';

export interface Project {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  /** Soft-delete marker — NULL on a live project; set once an owner/admin deletes it (recoverable). */
  deletedAt: Date | null;
  /** The user who soft-deleted it (display only). */
  deletedBy: string | null;
}

export interface CreateProjectInput {
  name: string;
  slug: string;
}

/**
 * CRUD for projects — the tenancy boundary. Access is enforced upstream by `resolveProject`
 * (via `resolveProjectRole`), and project ids are global UUIDs, so these methods take no role
 * context. The HTTP layer gates WHO may create/delete (platform admin/developer to create; owner or
 * platform admin to delete) before calling these.
 */
export class ProjectRepository {
  constructor(private readonly db: Database) {}

  /**
   * Creates a project. Slug must be unique across the instance (there is one platform). When
   * `ownerUserId` is given, the project row and the creator's `owner` membership are written in ONE
   * transaction — so a project never exists without an owner (the invariant every access gate
   * relies on). Repo-layer tests that don't care about membership omit `ownerUserId`.
   */
  async create(input: CreateProjectInput, ownerUserId?: string): Promise<Project> {
    // A soft-deleted project keeps its (unique) slug until it is reaped, so a clash may be a deleted
    // project the admin can restore or remove — say which, so the operator has a path to resolution.
    const [duplicate] = await this.db
      .select({ deletedAt: projects.deletedAt })
      .from(projects)
      .where(eq(projects.slug, input.slug));
    if (duplicate) {
      throw new ConflictError(
        duplicate.deletedAt
          ? 'a deleted project is holding this slug — restore or permanently remove it first'
          : 'a project with this slug already exists',
      );
    }
    const project: Project = {
      id: newId(),
      name: input.name,
      slug: input.slug,
      createdAt: new Date(),
      deletedAt: null,
      deletedBy: null,
    };
    if (ownerUserId === undefined) {
      await this.db.insert(projects).values(project);
      return project;
    }
    await this.db.transaction(async (tx) => {
      await tx.insert(projects).values(project);
      await tx.insert(projectMembers).values({
        id: newId(),
        userId: ownerUserId,
        projectId: project.id,
        role: 'owner',
        createdAt: project.createdAt,
      });
    });
    return project;
  }

  /** A project by id; throws NotFound if absent. (The caller must have already resolved access.) */
  async get(id: string): Promise<Project> {
    const [project] = await this.db.select().from(projects).where(eq(projects.id, id));
    if (!project) throw new NotFoundError('project not found');
    return project;
  }

  /** A project by its instance-unique slug; throws NotFound if absent. */
  async getBySlug(slug: string): Promise<Project> {
    const [project] = await this.db.select().from(projects).where(eq(projects.slug, slug));
    if (!project) throw new NotFoundError('project not found');
    return project;
  }

  /**
   * The first free slug at or after `base` — appends `-2`, `-3`, … until one is unused (a
   * soft-deleted project still holds its slug, so those are skipped too). Lets project
   * IMPORT/DUPLICATE avoid a collision without failing. `base` must already be a valid slug;
   * the numbered suffixes keep it valid.
   */
  async availableSlug(base: string): Promise<string> {
    for (let n = 1; n < 10_000; n += 1) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      const [existing] = await this.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.slug, candidate));
      if (!existing) return candidate;
    }
    throw new ConflictError('could not find an available slug');
  }

  /**
   * REAP — permanently deletes a project + ALL of its dependent rows in one transaction (no
   * DB-level ON DELETE CASCADE). Drops content + its revision history, form submissions (visitor
   * PII), API keys + OAuth grants (revokes all tokens), the AI-usage ledger, project memberships,
   * and project invites. On-disk media/publish/preview artifacts are removed by the HTTP layer
   * (keyed by slug). This is the FINAL step behind the admin "deleted projects" reap — callers
   * soft-delete (`softDelete`) first; restore is impossible after this.
   */
  async remove(id: string): Promise<void> {
    await this.get(id); // NotFound if absent
    await this.db.transaction(async (tx) => {
      await tx.delete(content).where(eq(content.projectId, id));
      await tx.delete(contentRevisions).where(eq(contentRevisions.projectId, id));
      await tx.delete(formSubmissions).where(eq(formSubmissions.projectId, id));
      await tx.delete(aiUsage).where(eq(aiUsage.projectId, id));
      await tx.delete(apiKeys).where(eq(apiKeys.projectId, id));
      await tx.delete(oauthAuthCodes).where(eq(oauthAuthCodes.projectId, id));
      await tx.delete(oauthRefreshTokens).where(eq(oauthRefreshTokens.projectId, id));
      await tx.delete(oauthDeviceCodes).where(eq(oauthDeviceCodes.projectId, id));
      await tx.delete(projectMembers).where(eq(projectMembers.projectId, id));
      await tx.delete(invites).where(eq(invites.projectId, id));
      await tx.delete(projects).where(eq(projects.id, id));
    });
  }

  /**
   * SOFT-delete: mark the project deleted (recoverable). It then drops out of every member-facing
   * query (lists/role resolution/project routes/published site) but keeps ALL rows + on-disk
   * artifacts so an admin can `restore` it. Does NOT free the slug (a restore must find it intact).
   */
  async softDelete(id: string, byUserId: string): Promise<void> {
    await this.get(id); // NotFound if absent
    await this.db.update(projects).set({ deletedAt: new Date(), deletedBy: byUserId }).where(eq(projects.id, id));
  }

  /** Un-delete a soft-deleted project — clears the marker; its retained rows/artifacts come back. */
  async restore(id: string): Promise<void> {
    await this.get(id); // NotFound if absent
    await this.db.update(projects).set({ deletedAt: null, deletedBy: null }).where(eq(projects.id, id));
  }

  /** Every soft-deleted project (the admin "deleted projects" list), most-recently-deleted first. */
  async listDeleted(): Promise<Project[]> {
    return this.db.select().from(projects).where(isNotNull(projects.deletedAt)).orderBy(desc(projects.deletedAt));
  }
}
