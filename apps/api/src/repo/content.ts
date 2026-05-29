import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  BrandSchema,
  DatasetSchema,
  EntrySchema,
  PageSchema,
  PartialSchema,
  ProjectSettingsSchema,
  PROJECT_FORMAT_VERSION,
  type Dataset,
  type Entry,
  type Page,
  type SitewrightPartial,
} from '@sitewright/schema';
import { validateProject, type ProjectBundle } from '@sitewright/core';
import type { Database } from '../db/client.js';
import { content, type ContentKind } from '../db/schema.js';
import { ConflictError, ForbiddenError, NotFoundError, type ProjectContext } from './context.js';

/** The project's settings singleton (brand + locale settings). */
export const SettingsSchema = z.object({ brand: BrandSchema, settings: ProjectSettingsSchema });
export type Settings = z.infer<typeof SettingsSchema>;

/** Per-kind validation schema. Map (not object index) to avoid dynamic-key access. */
const SCHEMAS = new Map<ContentKind, z.ZodTypeAny>([
  ['settings', SettingsSchema],
  ['page', PageSchema],
  ['partial', PartialSchema],
  ['dataset', DatasetSchema],
  ['entry', EntrySchema],
]);

const SETTINGS_ENTITY_ID = 'settings';
const WRITE_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);

function requireWriteRole(ctx: ProjectContext): void {
  if (!WRITE_ROLES.has(ctx.role)) throw new ForbiddenError('insufficient role for this operation');
}

function schemaFor(kind: ContentKind): z.ZodTypeAny {
  const schema = SCHEMAS.get(kind);
  if (!schema) throw new NotFoundError(`unknown content kind: ${kind}`);
  return schema;
}

/** Minimal project identity needed to assemble an export bundle. */
export interface ProjectIdentity {
  id: string;
  name: string;
  slug: string;
}

export interface ExportBundle {
  formatVersion: typeof PROJECT_FORMAT_VERSION;
  project: { id: string; name: string; slug: string; brand: unknown; settings: unknown };
  pages: Page[];
  partials: SitewrightPartial[];
  datasets: Dataset[];
  entries: Entry[];
}

/**
 * Project-scoped content access. Every query filters by `ctx.projectId` (which
 * the caller verified belongs to `ctx.orgId`); writes require owner/admin and
 * validate the payload against the content schema for its kind.
 */
export class ContentRepository {
  constructor(private readonly db: Database) {}

  async list(ctx: ProjectContext, kind: ContentKind): Promise<unknown[]> {
    const rows = await this.db
      .select()
      .from(content)
      .where(and(eq(content.projectId, ctx.projectId), eq(content.kind, kind)));
    return rows.map((row) => row.data);
  }

  async get(ctx: ProjectContext, kind: ContentKind, entityId: string): Promise<unknown> {
    const row = await this.row(ctx, kind, entityId);
    if (!row) throw new NotFoundError(`${kind} not found`);
    return row.data;
  }

  /** Validates `raw` against the kind's schema, then upserts. Returns the parsed value. */
  async put(ctx: ProjectContext, kind: ContentKind, entityId: string, raw: unknown): Promise<unknown> {
    requireWriteRole(ctx);
    const data = schemaFor(kind).parse(raw);
    if (kind !== 'settings') {
      const id = (data as { id?: string }).id;
      if (id !== entityId) {
        throw new ConflictError(`${kind} id "${id ?? ''}" does not match path "${entityId}"`);
      }
    }
    const now = new Date();
    const existing = await this.row(ctx, kind, entityId);
    if (existing) {
      await this.db.update(content).set({ data, updatedAt: now }).where(eq(content.id, existing.id));
    } else {
      await this.db.insert(content).values({
        id: randomUUID(),
        projectId: ctx.projectId,
        kind,
        entityId,
        data,
        createdAt: now,
        updatedAt: now,
      });
    }
    return data;
  }

  async remove(ctx: ProjectContext, kind: ContentKind, entityId: string): Promise<void> {
    requireWriteRole(ctx);
    const row = await this.row(ctx, kind, entityId);
    if (!row) throw new NotFoundError(`${kind} not found`);
    await this.db.delete(content).where(eq(content.id, row.id));
  }

  /** Assembles the full project as an on-disk-format bundle (the export side of D11). */
  async exportBundle(ctx: ProjectContext, project: ProjectIdentity): Promise<ExportBundle> {
    const settings = (await this.list(ctx, 'settings'))[0] as Settings | undefined;
    return {
      formatVersion: PROJECT_FORMAT_VERSION,
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        brand: settings?.brand ?? { name: project.name, colors: {} },
        settings: settings?.settings ?? { defaultLocale: 'en', locales: ['en'] },
      },
      pages: (await this.list(ctx, 'page')) as Page[],
      partials: (await this.list(ctx, 'partial')) as SitewrightPartial[],
      datasets: (await this.list(ctx, 'dataset')) as Dataset[],
      entries: (await this.list(ctx, 'entry')) as Entry[],
    };
  }

  /**
   * Imports an on-disk-format bundle (the import side of D11): validates every
   * entity against its schema, runs cross-entity integrity checks via
   * `validateProject`, then writes. Rejects (throws) before writing if invalid.
   */
  async importBundle(
    ctx: ProjectContext,
    project: ProjectIdentity,
    raw: unknown,
  ): Promise<{ imported: number }> {
    requireWriteRole(ctx);
    const input = z
      .object({
        project: z.object({ brand: BrandSchema, settings: ProjectSettingsSchema }).optional(),
        pages: z.array(PageSchema).default([]),
        partials: z.array(PartialSchema).default([]),
        datasets: z.array(DatasetSchema).default([]),
        entries: z.array(EntrySchema).default([]),
      })
      .parse(raw);

    const bundle: ProjectBundle = {
      project: {
        formatVersion: PROJECT_FORMAT_VERSION,
        id: project.id,
        name: project.name,
        slug: project.slug,
        brand: input.project?.brand ?? { name: project.name, colors: {} },
        settings: input.project?.settings ?? { defaultLocale: 'en', locales: ['en'] },
      },
      pages: input.pages,
      partials: input.partials,
      datasets: input.datasets,
      entries: input.entries,
    };
    const issues = validateProject(bundle);
    if (issues.length > 0) {
      throw new ConflictError(`invalid project bundle: ${issues.map((i) => i.code).join(', ')}`);
    }

    let imported = 0;
    if (input.project) {
      await this.put(ctx, 'settings', SETTINGS_ENTITY_ID, input.project);
      imported += 1;
    }
    for (const page of input.pages) {
      await this.put(ctx, 'page', page.id, page);
      imported += 1;
    }
    for (const partial of input.partials) {
      await this.put(ctx, 'partial', partial.id, partial);
      imported += 1;
    }
    for (const dataset of input.datasets) {
      await this.put(ctx, 'dataset', dataset.id, dataset);
      imported += 1;
    }
    for (const entry of input.entries) {
      await this.put(ctx, 'entry', entry.id, entry);
      imported += 1;
    }
    return { imported };
  }

  private async row(ctx: ProjectContext, kind: ContentKind, entityId: string) {
    const [row] = await this.db
      .select()
      .from(content)
      .where(
        and(
          eq(content.projectId, ctx.projectId),
          eq(content.kind, kind),
          eq(content.entityId, entityId),
        ),
      );
    return row;
  }
}

export { SETTINGS_ENTITY_ID };
