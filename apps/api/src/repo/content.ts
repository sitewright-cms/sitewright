import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  assertWithinTreeDepth,
  BrandSchema,
  CompanySchema,
  DatasetSchema,
  DeployTargetSchema,
  EntrySchema,
  MediaAssetSchema,
  PageSchema,
  PartialSchema,
  TemplateSchema,
  ProjectSettingsSchema,
  WebsiteSettingsSchema,
  PROJECT_FORMAT_VERSION,
  type Brand,
  type Company,
  type Dataset,
  type WebsiteSettings,
  type Entry,
  type Page,
  type ProjectSettings,
  type SitewrightPartial,
  type Template,
} from '@sitewright/schema';
import { validateProject, type ProjectBundle } from '@sitewright/core';
import type { Database } from '../db/client.js';
import { content, type ContentKind } from '../db/schema.js';
import { ConflictError, ForbiddenError, NotFoundError, type ProjectContext } from './context.js';

/** The project's settings singleton (brand + corporate identity + website settings + locale). */
export const SettingsSchema = z.object({
  brand: BrandSchema,
  company: CompanySchema.optional(),
  website: WebsiteSettingsSchema.optional(),
  settings: ProjectSettingsSchema,
});
export type Settings = z.infer<typeof SettingsSchema>;

/** Per-kind validation schema. Map (not object index) to avoid dynamic-key access. */
const SCHEMAS = new Map<ContentKind, z.ZodTypeAny>([
  ['settings', SettingsSchema],
  ['page', PageSchema],
  ['partial', PartialSchema],
  ['template', TemplateSchema],
  ['dataset', DatasetSchema],
  ['entry', EntrySchema],
  // Media metadata is tenant-scoped CRUD like other content; the binaries live on
  // disk (see apps/api/src/media). Not yet part of export/import bundles.
  ['media', MediaAssetSchema],
  // Saved deploy targets (encrypted credentials). Managed via dedicated endpoints,
  // excluded from export/import bundles (never export secrets).
  ['deploy_target', DeployTargetSchema],
]);

/** The content kinds, derived from the schema map (single source of truth). */
export const CONTENT_KINDS = [...SCHEMAS.keys()];

const SETTINGS_ENTITY_ID = 'settings';
const WRITE_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);
// Per-bundle caps (defense-in-depth alongside the route body limit).
const MAX_BUNDLE = { pages: 2000, partials: 500, templates: 500, datasets: 500, entries: 50_000 } as const;

function requireWriteRole(ctx: ProjectContext): void {
  if (!WRITE_ROLES.has(ctx.role)) throw new ForbiddenError('insufficient role for this operation');
}

function schemaFor(kind: ContentKind): z.ZodTypeAny {
  const schema = SCHEMAS.get(kind);
  if (!schema) throw new NotFoundError(`unknown content kind: ${kind}`);
  return schema;
}

/** Guards recursive (page/partial/template) trees before Zod's recursive parse, to prevent stack overflow. */
function assertTreeSafe(kind: ContentKind, raw: unknown): void {
  if (kind === 'page' || kind === 'partial' || kind === 'template') {
    assertWithinTreeDepth((raw as { root?: unknown })?.root);
  }
}

/** Minimal project identity needed to assemble an export bundle. */
export interface ProjectIdentity {
  id: string;
  name: string;
  slug: string;
}

export interface ExportBundle {
  formatVersion: typeof PROJECT_FORMAT_VERSION;
  project: {
    id: string;
    name: string;
    slug: string;
    brand: Brand;
    company?: Company;
    website?: WebsiteSettings;
    settings: ProjectSettings;
  };
  pages: Page[];
  partials: SitewrightPartial[];
  templates: Template[];
  datasets: Dataset[];
  entries: Entry[];
}

/** A db handle or a transaction handle — both expose the query builder used here. */
type Executor = Database;

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
    const row = await this.row(this.db, ctx, kind, entityId);
    if (!row) throw new NotFoundError(`${kind} not found`);
    return row.data;
  }

  /** Validates `raw` against the kind's schema, then upserts. Returns the parsed value. */
  async put(ctx: ProjectContext, kind: ContentKind, entityId: string, raw: unknown): Promise<unknown> {
    requireWriteRole(ctx);
    assertTreeSafe(kind, raw);
    const data = schemaFor(kind).parse(raw);
    const key = this.entityKey(kind, entityId, data);
    await this.writeRow(this.db, ctx, kind, key, data);
    return data;
  }

  async remove(ctx: ProjectContext, kind: ContentKind, entityId: string): Promise<void> {
    requireWriteRole(ctx);
    if (kind === 'settings') {
      throw new ForbiddenError('the settings singleton cannot be deleted');
    }
    const row = await this.row(this.db, ctx, kind, entityId);
    if (!row) throw new NotFoundError(`${kind} not found`);
    await this.db
      .delete(content)
      .where(and(eq(content.id, row.id), eq(content.projectId, ctx.projectId)));
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
        company: settings?.company,
        website: settings?.website,
        settings: settings?.settings ?? { defaultLocale: 'en', locales: ['en'] },
      },
      pages: (await this.list(ctx, 'page')) as Page[],
      partials: (await this.list(ctx, 'partial')) as SitewrightPartial[],
      templates: (await this.list(ctx, 'template')) as Template[],
      datasets: (await this.list(ctx, 'dataset')) as Dataset[],
      entries: (await this.list(ctx, 'entry')) as Entry[],
    };
  }

  /**
   * Imports an on-disk-format bundle (the import side of D11): bounds the input,
   * guards tree depth, validates every entity, runs cross-entity integrity checks
   * via `validateProject`, then writes **atomically** in one transaction.
   */
  async importBundle(
    ctx: ProjectContext,
    project: ProjectIdentity,
    raw: unknown,
  ): Promise<{ imported: number }> {
    requireWriteRole(ctx);

    // Guard recursive trees before the recursive Zod parse below.
    const envelope = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    for (const item of toArray(envelope.pages)) assertWithinTreeDepth((item as { root?: unknown })?.root);
    for (const item of toArray(envelope.partials))
      assertWithinTreeDepth((item as { root?: unknown })?.root);
    for (const item of toArray(envelope.templates))
      assertWithinTreeDepth((item as { root?: unknown })?.root);

    const input = z
      .object({
        project: z
          .object({
            brand: BrandSchema,
            company: CompanySchema.optional(),
            website: WebsiteSettingsSchema.optional(),
            settings: ProjectSettingsSchema,
          })
          .optional(),
        pages: z.array(PageSchema).max(MAX_BUNDLE.pages).default([]),
        partials: z.array(PartialSchema).max(MAX_BUNDLE.partials).default([]),
        templates: z.array(TemplateSchema).max(MAX_BUNDLE.templates).default([]),
        datasets: z.array(DatasetSchema).max(MAX_BUNDLE.datasets).default([]),
        entries: z.array(EntrySchema).max(MAX_BUNDLE.entries).default([]),
      })
      .parse(raw);

    const bundle: ProjectBundle = {
      project: {
        formatVersion: PROJECT_FORMAT_VERSION,
        id: project.id,
        name: project.name,
        slug: project.slug,
        brand: input.project?.brand ?? { name: project.name, colors: {} },
        company: input.project?.company,
        website: input.project?.website,
        settings: input.project?.settings ?? { defaultLocale: 'en', locales: ['en'] },
      },
      pages: input.pages,
      partials: input.partials,
      templates: input.templates,
      datasets: input.datasets,
      entries: input.entries,
    };
    const issues = validateProject(bundle);
    if (issues.length > 0) {
      throw new ConflictError(`invalid project bundle: ${issues.map((i) => i.code).join(', ')}`);
    }

    let imported = 0;
    await this.db.transaction(async (tx) => {
      const exec = tx as unknown as Executor; // tx exposes the same query builder
      if (input.project) {
        await this.writeRow(exec, ctx, 'settings', SETTINGS_ENTITY_ID, input.project);
        imported += 1;
      }
      for (const page of input.pages) {
        await this.writeRow(exec, ctx, 'page', page.id, page);
        imported += 1;
      }
      for (const partial of input.partials) {
        await this.writeRow(exec, ctx, 'partial', partial.id, partial);
        imported += 1;
      }
      for (const template of input.templates) {
        await this.writeRow(exec, ctx, 'template', template.id, template);
        imported += 1;
      }
      for (const dataset of input.datasets) {
        await this.writeRow(exec, ctx, 'dataset', dataset.id, dataset);
        imported += 1;
      }
      for (const entry of input.entries) {
        await this.writeRow(exec, ctx, 'entry', entry.id, entry);
        imported += 1;
      }
    });
    return { imported };
  }

  /** The storage key for an entity: the settings singleton id, or the entity's own id (which must match the path). */
  private entityKey(kind: ContentKind, entityId: string, data: unknown): string {
    if (kind === 'settings') return SETTINGS_ENTITY_ID;
    const id = (data as { id?: string }).id;
    if (id !== entityId) {
      throw new ConflictError(`${kind} id "${id ?? ''}" does not match path "${entityId}"`);
    }
    return entityId;
  }

  private async writeRow(
    exec: Executor,
    ctx: ProjectContext,
    kind: ContentKind,
    entityId: string,
    data: unknown,
  ): Promise<void> {
    const now = new Date();
    const existing = await this.row(exec, ctx, kind, entityId);
    if (existing) {
      await exec
        .update(content)
        .set({ data, updatedAt: now })
        .where(and(eq(content.id, existing.id), eq(content.projectId, ctx.projectId)));
    } else {
      await exec.insert(content).values({
        id: randomUUID(),
        projectId: ctx.projectId,
        kind,
        entityId,
        data,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  private async row(exec: Executor, ctx: ProjectContext, kind: ContentKind, entityId: string) {
    const [row] = await exec
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

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export { SETTINGS_ENTITY_ID };
