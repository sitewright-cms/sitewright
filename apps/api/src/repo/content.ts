import { randomUUID } from 'node:crypto';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  assertWithinTreeDepth,
  CorporateIdentitySchema,
  mergeLegacyIdentity,
  DatasetSchema,
  DeployTargetSchema,
  EntrySchema,
  FormSchema,
  SmtpStoredSchema,
  MediaAssetSchema,
  PageSchema,
  PartialSchema,
  SnippetSchema,
  PatternSchema,
  PageTranslationSchema,
  TemplateSchema,
  ProjectSettingsSchema,
  WebsiteSettingsSchema,
  PROJECT_FORMAT_VERSION,
  type CorporateIdentity,
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
import type { ProjectEventBus } from '../events/bus.js';

/**
 * The project's settings singleton (Corporate Identity + website settings + locale).
 * `mergeLegacyIdentity` runs first so a row written in the old `{brand,company}`
 * shape upgrades to `{identity}` transparently on read (it re-persists on next put).
 */
export const SettingsSchema = z.preprocess(
  mergeLegacyIdentity,
  z.object({
    identity: CorporateIdentitySchema,
    website: WebsiteSettingsSchema.optional(),
    settings: ProjectSettingsSchema,
  }),
);
export type Settings = z.infer<typeof SettingsSchema>;

/** Per-kind validation schema. Map (not object index) to avoid dynamic-key access. */
const SCHEMAS = new Map<ContentKind, z.ZodTypeAny>([
  ['settings', SettingsSchema],
  ['page', PageSchema],
  ['partial', PartialSchema],
  ['template', TemplateSchema],
  // Code-first reusable Handlebars fragment (the templating pivot's partial), included
  // via {{> name}}; source validated at render time.
  ['snippet', SnippetSchema],
  // A reusable pre-composed block subtree (fork-on-insert library); tree-bearing.
  ['pattern', PatternSchema],
  // A per-locale override of a page's content (multilingual); tree-bearing.
  ['translation', PageTranslationSchema],
  ['dataset', DatasetSchema],
  ['entry', EntrySchema],
  // Web form definitions (fields + inline messages + server-side recipient/mode).
  // The recipient is never rendered into exported HTML (see the Form renderer).
  ['form', FormSchema],
  // Per-project SMTP for the `userSmtp` form mode (encrypted password). Singleton
  // per project; managed via dedicated routes (excluded from generic content).
  ['project_smtp', SmtpStoredSchema],
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
// Per-bundle caps (defense-in-depth alongside the route body limit).
const MAX_BUNDLE = { pages: 2000, partials: 500, templates: 500, datasets: 500, entries: 50_000 } as const;

function schemaFor(kind: ContentKind): z.ZodTypeAny {
  const schema = SCHEMAS.get(kind);
  if (!schema) throw new NotFoundError(`unknown content kind: ${kind}`);
  return schema;
}

/** Guards recursive (page/partial/template) trees before Zod's recursive parse, to prevent stack overflow. */
function assertTreeSafe(kind: ContentKind, raw: unknown): void {
  if (
    kind === 'page' ||
    kind === 'partial' ||
    kind === 'template' ||
    kind === 'pattern' ||
    kind === 'translation'
  ) {
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
    identity: CorporateIdentity;
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
  /**
   * @param events optional change bus — when present, successful writes publish a
   *   {@link ContentChange} so live-preview clients can reload. Omitted in unit
   *   tests that don't exercise the stream.
   */
  constructor(
    private readonly db: Database,
    private readonly events?: ProjectEventBus,
  ) {}

  async list(ctx: ProjectContext, kind: ContentKind): Promise<unknown[]> {
    const rows = await this.db
      .select()
      .from(content)
      .where(and(eq(content.projectId, ctx.projectId), eq(content.kind, kind)));
    return rows.map((row) => row.data);
  }

  /**
   * The newest content `updatedAt` for the project, EXCLUDING the non-published config kinds
   * (deploy_target / project_smtp — credentials, not site content). Null when there is no
   * publishable content yet. Powers the publish "dirty" signal (has the site changed since the last
   * release?). Uses an indexed order-by + limit so the column mapper returns a real Date.
   */
  async latestContentUpdate(ctx: ProjectContext): Promise<Date | null> {
    const [row] = await this.db
      .select({ updatedAt: content.updatedAt })
      .from(content)
      .where(
        and(
          eq(content.projectId, ctx.projectId),
          notInArray(content.kind, ['deploy_target', 'project_smtp']),
        ),
      )
      .orderBy(desc(content.updatedAt))
      .limit(1);
    return row?.updatedAt ?? null;
  }

  async get(ctx: ProjectContext, kind: ContentKind, entityId: string): Promise<unknown> {
    const row = await this.row(this.db, ctx, kind, entityId);
    if (!row) throw new NotFoundError(`${kind} not found`);
    return row.data;
  }

  /**
   * Validates `raw` against the kind's schema, then upserts. Returns the parsed value. Any user with
   * project access (owner or member) may write any content kind — the source⇄content distinction is
   * a UI default (toggle), not a write restriction. Project administration (delete project, manage
   * team) is gated separately at the route layer.
   */
  async put(ctx: ProjectContext, kind: ContentKind, entityId: string, raw: unknown): Promise<unknown> {
    assertTreeSafe(kind, raw);
    const data = schemaFor(kind).parse(raw);
    const key = this.entityKey(kind, entityId, data);
    await this.writeRow(this.db, ctx, kind, key, data);
    this.events?.emit(ctx.projectId, { kind, entityId: key, op: 'put' });
    return data;
  }

  async remove(ctx: ProjectContext, kind: ContentKind, entityId: string): Promise<void> {
    if (kind === 'settings') {
      throw new ForbiddenError('the settings singleton cannot be deleted');
    }
    const row = await this.row(this.db, ctx, kind, entityId);
    if (!row) throw new NotFoundError(`${kind} not found`);
    await this.db
      .delete(content)
      .where(and(eq(content.id, row.id), eq(content.projectId, ctx.projectId)));
    this.events?.emit(ctx.projectId, { kind, entityId, op: 'delete' });
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
        identity: settings?.identity ?? { name: project.name, colors: {} },
        website: settings?.website,
        settings: settings?.settings ?? { defaultLocale: 'en', locales: ['en'] },
      },
      pages: (await this.list(ctx, 'page')) as Page[],
      partials: (await this.list(ctx, 'partial')) as SitewrightPartial[],
      templates: (await this.list(ctx, 'template')) as Template[],
      datasets: (await this.list(ctx, 'dataset')) as Dataset[],
      entries: (await this.list(ctx, 'entry')) as Entry[],
      // `pattern` is intentionally NOT bundled — it's a project-scoped editor aid
      // (fork-on-insert library), not part of the publishable/portable artifact.
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
    // Guard recursive trees before the recursive Zod parse below.
    const envelope = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    for (const item of toArray(envelope.pages)) assertWithinTreeDepth((item as { root?: unknown })?.root);
    for (const item of toArray(envelope.partials))
      assertWithinTreeDepth((item as { root?: unknown })?.root);
    for (const item of toArray(envelope.templates))
      assertWithinTreeDepth((item as { root?: unknown })?.root);

    const input = z
      .object({
        // Accept a v2 `{identity}` project OR a legacy `{brand,company}` one
        // (mergeLegacyIdentity folds the latter), so old exported bundles import.
        project: z
          .preprocess(
            mergeLegacyIdentity,
            z.object({
              identity: CorporateIdentitySchema,
              website: WebsiteSettingsSchema.optional(),
              settings: ProjectSettingsSchema,
            }),
          )
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
        identity: input.project?.identity ?? { name: project.name, colors: {} },
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

  /** The storage key for an entity: a singleton's fixed id, or the entity's own id (which must match the path). */
  private entityKey(kind: ContentKind, entityId: string, data: unknown): string {
    if (kind === 'settings') return SETTINGS_ENTITY_ID;
    // project_smtp is a per-project singleton with no `id` field (keyed by the path).
    if (kind === 'project_smtp') return entityId;
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
