import { newId } from '../id.js';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
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
    const duplicate = await this.db.select().from(projects).where(eq(projects.slug, input.slug));
    if (duplicate.length > 0) {
      throw new ConflictError('a project with this slug already exists');
    }
    const project: Project = {
      id: newId(),
      name: input.name,
      slug: input.slug,
      createdAt: new Date(),
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
   * Deletes a project + all of its dependent rows in one transaction (no DB-level ON DELETE
   * CASCADE). Drops content + its revision history, form submissions (visitor PII), API keys + OAuth grants (revokes all
   * tokens), project memberships, and project invites. On-disk media/publish artifacts are not
   * removed here (follow-up).
   */
  async remove(id: string): Promise<void> {
    await this.get(id); // NotFound if absent
    await this.db.transaction(async (tx) => {
      await tx.delete(content).where(eq(content.projectId, id));
      await tx.delete(contentRevisions).where(eq(contentRevisions.projectId, id));
      await tx.delete(formSubmissions).where(eq(formSubmissions.projectId, id));
      await tx.delete(apiKeys).where(eq(apiKeys.projectId, id));
      await tx.delete(oauthAuthCodes).where(eq(oauthAuthCodes.projectId, id));
      await tx.delete(oauthRefreshTokens).where(eq(oauthRefreshTokens.projectId, id));
      await tx.delete(oauthDeviceCodes).where(eq(oauthDeviceCodes.projectId, id));
      await tx.delete(projectMembers).where(eq(projectMembers.projectId, id));
      await tx.delete(invites).where(eq(invites.projectId, id));
      await tx.delete(projects).where(eq(projects.id, id));
    });
  }
}
