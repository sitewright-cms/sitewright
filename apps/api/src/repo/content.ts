import { newId } from '../id.js';
import { and, desc, eq, isNull, isNotNull, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  CorporateIdentitySchema,
  mergeLegacyIdentity,
  DatasetSchema,
  DeployTargetSchema,
  AiConfigSchema,
  EntrySchema,
  FormSchema,
  SmtpStoredSchema,
  MediaAssetSchema,
  MediaFolderRecordSchema,
  PageSchema,
  SnippetSchema,
  PageTranslationSchema,
  TemplateSchema,
  ProjectSettingsSchema,
  WebsiteSettingsSchema,
  PROJECT_FORMAT_VERSION,
  EXPORT_BUNDLE_CAPS,
  type CorporateIdentity,
  type Dataset,
  type WebsiteSettings,
  type Entry,
  type Form,
  type MediaAsset,
  type MediaFolderRecord,
  type Page,
  type PageTranslation,
  type ProjectExportBundle,
  type ProjectSettings,
  type Snippet,
  type Template,
} from '@sitewright/schema';
import { validateProject, type ProjectBundle } from '@sitewright/core';
import type { Database } from '../db/client.js';
import { content, type ContentKind } from '../db/schema.js';
import { ConflictError, ForbiddenError, NotFoundError, type ProjectContext } from './context.js';
import type { ProjectEventBus } from '../events/bus.js';
import type { RevisionsRepository, RevisionOp } from './revisions.js';
import { rewriteDatasetRefsInSource, sourceReferencesDataset, rewriteReferenceTargets } from './dataset-rename.js';

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
  ['template', TemplateSchema],
  // Code-first reusable Handlebars fragment (the templating pivot's partial), included
  // via {{> name}}; source validated at render time.
  ['snippet', SnippetSchema],
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
  // Persisted (incl. EMPTY) media folders — makes folders first-class so they survive
  // a reload and can be renamed/moved/deleted. Managed via the dedicated /media/folders
  // routes; excluded from export/import bundles (folders are implied by asset paths there).
  ['mediafolder', MediaFolderRecordSchema],
  // Saved deploy targets (encrypted credentials). Managed via dedicated endpoints,
  // excluded from export/import bundles (never export secrets).
  ['deploy_target', DeployTargetSchema],
  // Per-project "bring your own agent" AI config (encrypted API key). Singleton per project,
  // managed via dedicated /ai-config routes; excluded from export/import bundles (never export secrets).
  ['ai_config', AiConfigSchema],
]);

/** The content kinds, derived from the schema map (single source of truth). */
export const CONTENT_KINDS = [...SCHEMAS.keys()];

const SETTINGS_ENTITY_ID = 'settings';

/** Upper bound on pages touched by one {@link ContentRepository.applyLocaleChange} (DoS guard). */
const MAX_LOCALE_BATCH = 5000;
// Per-bundle caps (defense-in-depth alongside the route body limit).
const MAX_BUNDLE = { pages: 2000, templates: 500, datasets: 500, entries: 50_000 } as const;

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
  project: {
    id: string;
    name: string;
    slug: string;
    identity: CorporateIdentity;
    website?: WebsiteSettings;
    settings: ProjectSettings;
  };
  pages: Page[];
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
    private readonly revisions?: RevisionsRepository,
  ) {}

  /**
   * Snapshot a content write into history — BEST-EFFORT: a failure here is logged-away (swallowed) and
   * never breaks the user's save, mirroring the fire-and-forget change-event emit. Non-revisioned kinds
   * are filtered inside the repo. No-op when no RevisionsRepository is wired (unit tests).
   */
  private async recordRevision(
    ctx: ProjectContext,
    kind: ContentKind,
    entityId: string,
    scope: string,
    data: unknown,
    op: RevisionOp,
    note?: string,
  ): Promise<void> {
    if (!this.revisions) return;
    try {
      await this.revisions.record(ctx, kind, entityId, scope, data, op, note);
    } catch {
      /* best-effort: never fail a save because history couldn't be written */
    }
  }

  async list(ctx: ProjectContext, kind: ContentKind): Promise<unknown[]> {
    const rows = await this.db
      .select()
      .from(content)
      // Exclude soft-deleted rows (currently only media) so every list caller — File Manager, render,
      // exports, fonts — transparently skips items in the Recycle Bin. `deletedAt` is NULL for all other
      // kinds, so this is a no-op for them.
      .where(and(eq(content.projectId, ctx.projectId), eq(content.kind, kind), isNull(content.deletedAt)));
    return rows.map((row) => row.data);
  }

  /**
   * The newest content `updatedAt` for the project, EXCLUDING the non-published config kinds
   * (deploy_target / project_smtp — credentials, not site content). Null when there is no
   * publishable content yet. Powers the publish "dirty" signal (has the site changed since the last
   * release?). Filters by the indexed `project_id`, then order-by/limit so the column mapper
   * returns a real Date (there is no index on `updated_at` — fine at these row counts).
   */
  async latestContentUpdate(ctx: ProjectContext): Promise<Date | null> {
    const [row] = await this.db
      .select({ updatedAt: content.updatedAt })
      .from(content)
      .where(
        and(
          eq(content.projectId, ctx.projectId),
          notInArray(content.kind, ['deploy_target', 'project_smtp', 'ai_config']),
        ),
      )
      .orderBy(desc(content.updatedAt))
      .limit(1);
    return row?.updatedAt ?? null;
  }

  /**
   * Fetch one entity's data. `scope` narrows the (kind, entityId) key: pass the OWNING DATASET SLUG for
   * an `entry` (its id is only unique within its dataset); leave it `''` for every project-global kind.
   */
  async get(ctx: ProjectContext, kind: ContentKind, entityId: string, scope = ''): Promise<unknown> {
    const row = await this.row(this.db, ctx, kind, entityId, scope);
    if (!row) throw new NotFoundError(`${kind} not found`);
    return row.data;
  }

  /**
   * Validates `raw` against the kind's schema, then upserts. Returns the parsed value. Any user with
   * project access (owner or member) may write any content kind — the source⇄content distinction is
   * a UI default (toggle), not a write restriction. Project administration (delete project, manage
   * team) is gated separately at the route layer.
   */
  async put(
    ctx: ProjectContext,
    kind: ContentKind,
    entityId: string,
    raw: unknown,
    revisionMeta?: { op?: RevisionOp; note?: string },
  ): Promise<unknown> {
    const parsed = schemaFor(kind).parse(raw);
    // Rich (data-sw-html) content now lives in the single page.data store and is sanitized at RENDER
    // (the html sink always runs sanitizeRichHtml). page.data is generic JSON whose HTML leaves aren't
    // known at this boundary, so there is no at-rest HTML pass here — the render sink is authoritative.
    const key = this.entityKey(kind, entityId, parsed);
    // The dataset-scope is derived from the parsed body (entry.dataset), so PUT needs no dataset param.
    const scope = this.scopeForData(kind, parsed);
    await this.writeRow(this.db, ctx, kind, key, parsed);
    // `revisionMeta` lets a restore tag its new revision as `restore` (+ a note); a normal save is `put`.
    await this.recordRevision(ctx, kind, key, scope, parsed, revisionMeta?.op ?? 'put', revisionMeta?.note);
    this.events?.emit(ctx.projectId, { kind, entityId: key, op: 'put', actor: ctx.actor });
    return parsed;
  }

  /**
   * Delete one entity. `scope` narrows the (kind, entityId) key — pass the OWNING DATASET SLUG for an
   * `entry` (so the right dataset's row is removed), `''` for project-global kinds.
   */
  async remove(ctx: ProjectContext, kind: ContentKind, entityId: string, scope = ''): Promise<void> {
    if (kind === 'settings') {
      throw new ForbiddenError('the settings singleton cannot be deleted');
    }
    const row = await this.row(this.db, ctx, kind, entityId, scope);
    if (!row) throw new NotFoundError(`${kind} not found`);
    // Tombstone BEFORE the delete, and NOT best-effort (unlike `put` history): a lost put-revision is
    // harmless because the entity still exists, but a lost delete-tombstone would make the entity
    // unrecoverable. So if history can't be written we abort the delete rather than destroy data.
    // (No-op for non-revisioned kinds — record() filters them.)
    await this.revisions?.record(ctx, kind, entityId, scope, row.data, 'delete');
    await this.db
      .delete(content)
      .where(and(eq(content.id, row.id), eq(content.projectId, ctx.projectId)));
    this.events?.emit(ctx.projectId, { kind, entityId, op: 'delete', actor: ctx.actor });
  }

  /**
   * SOFT-DELETE a media asset → the Recycle Bin. Hides it from every list but RETAINS the row + the
   * on-disk binary so it can be restored. No revision (media isn't versioned) and no binary removal.
   * Throws NotFound if the asset doesn't exist or is already deleted.
   */
  async softDeleteMedia(ctx: ProjectContext, id: string, now: Date = new Date()): Promise<void> {
    const res = await this.db
      .update(content)
      .set({ deletedAt: now })
      .where(and(eq(content.projectId, ctx.projectId), eq(content.kind, 'media'), eq(content.entityId, id), isNull(content.deletedAt)))
      .returning({ id: content.id });
    if (res.length === 0) throw new NotFoundError('media not found');
    this.events?.emit(ctx.projectId, { kind: 'media', entityId: id, op: 'delete', actor: ctx.actor });
  }

  /** Restore a soft-deleted media asset (clears `deletedAt`). Throws NotFound if it isn't in the bin. */
  async restoreMedia(ctx: ProjectContext, id: string): Promise<void> {
    const res = await this.db
      .update(content)
      .set({ deletedAt: null })
      .where(and(eq(content.projectId, ctx.projectId), eq(content.kind, 'media'), eq(content.entityId, id), isNotNull(content.deletedAt)))
      .returning({ id: content.id });
    if (res.length === 0) throw new NotFoundError('deleted media not found');
    this.events?.emit(ctx.projectId, { kind: 'media', entityId: id, op: 'put', actor: ctx.actor });
  }

  /** The project's SOFT-DELETED media (the Recycle Bin), newest-deleted first, each carrying `deletedAt`. */
  async listDeletedMedia(ctx: ProjectContext): Promise<Array<MediaAsset & { deletedAt: number }>> {
    const rows = await this.db
      .select()
      .from(content)
      .where(and(eq(content.projectId, ctx.projectId), eq(content.kind, 'media'), isNotNull(content.deletedAt)))
      .orderBy(desc(content.deletedAt));
    return rows.map((r) => ({ ...(r.data as MediaAsset), deletedAt: (r.deletedAt as Date).getTime() }));
  }

  /**
   * Fetch a LIVE (non-binned) media asset. Throws NotFound if it's missing OR soft-deleted, so
   * mutating routes (rename/move/copy) can't reach a Recycle-Bin row — renaming a trashed asset or
   * "copying" it back into the library would bypass the restore flow.
   */
  async getLiveMedia(ctx: ProjectContext, id: string): Promise<MediaAsset> {
    const row = await this.row(this.db, ctx, 'media', id);
    if (!row || row.deletedAt) throw new NotFoundError('media not found');
    return row.data as MediaAsset;
  }

  /**
   * PERMANENTLY delete a media asset from the Recycle Bin: drops the DB row. Guards on
   * `isNotNull(deletedAt)` so a LIVE asset can NEVER be hard-deleted through this path — purge is a
   * bin-only operation and the 90-day recovery window can't be skipped. Throws NotFound if the asset
   * isn't in the bin. Binary removal is the caller's job (it needs the project slug).
   */
  async purgeMedia(ctx: ProjectContext, id: string): Promise<void> {
    const res = await this.db
      .delete(content)
      .where(and(eq(content.projectId, ctx.projectId), eq(content.kind, 'media'), eq(content.entityId, id), isNotNull(content.deletedAt)))
      .returning({ id: content.id });
    if (res.length === 0) throw new NotFoundError('deleted media not found');
    this.events?.emit(ctx.projectId, { kind: 'media', entityId: id, op: 'delete', actor: ctx.actor });
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
      templates: (await this.list(ctx, 'template')) as Template[],
      datasets: (await this.list(ctx, 'dataset')) as Dataset[],
      entries: (await this.list(ctx, 'entry')) as Entry[],
    };
  }

  /**
   * Assembles the **complete**, portable bundle for a project export zip — the
   * legacy {@link exportBundle} sections plus the ones a whole-project archive
   * must round-trip: snippets, per-locale translations, forms, and media
   * **metadata** (binaries are collected separately from disk by the zip route).
   * Secrets (deploy targets, project SMTP) are never listed here.
   */
  async assembleExportBundle(
    ctx: ProjectContext,
    project: ProjectIdentity,
  ): Promise<ProjectExportBundle> {
    // The five extra sections are independent, project-scoped list queries → fetch them in
    // parallel (alongside the base bundle) rather than serially. NOTE: `form` rows are exported
    // whole, so `form.recipient`/`subject`/`mode` travel too — already readable by any member via
    // the content API (form is not a DEDICATED_KIND) and required to restore a working form.
    const [base, snippets, translations, forms, media, mediaFolders] = await Promise.all([
      this.exportBundle(ctx, project),
      this.list(ctx, 'snippet') as Promise<Snippet[]>,
      this.list(ctx, 'translation') as Promise<PageTranslation[]>,
      this.list(ctx, 'form') as Promise<Form[]>,
      this.list(ctx, 'media') as Promise<MediaAsset[]>,
      this.list(ctx, 'mediafolder') as Promise<MediaFolderRecord[]>,
    ]);
    return { ...base, snippets, translations, forms, media, mediaFolders };
  }

  /**
   * Imports an on-disk-format bundle (the import side of D11): bounds the input,
   * guards tree depth, validates every entity, runs cross-entity integrity checks
   * via `validateProject`, then writes **atomically** in one transaction.
   *
   * NOTE: batch writes here go straight through `writeRow` (for the transaction) and therefore do NOT
   * record revisions — a bulk import is itself a checkpoint and the pre-import state is still in each
   * entity's history. Per-entity import/locale revisioning is a deferred enhancement (see
   * `applyLocaleChange` too).
   */
  async importBundle(
    ctx: ProjectContext,
    project: ProjectIdentity,
    raw: unknown,
  ): Promise<{ imported: number }> {
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
        templates: z.array(TemplateSchema).max(MAX_BUNDLE.templates).default([]),
        datasets: z.array(DatasetSchema).max(MAX_BUNDLE.datasets).default([]),
        entries: z.array(EntrySchema).max(MAX_BUNDLE.entries).default([]),
        // The whole-project sections (a zip import) — optional so a minimal JSON bundle still imports.
        snippets: z.array(SnippetSchema).max(EXPORT_BUNDLE_CAPS.snippets).default([]),
        translations: z.array(PageTranslationSchema).max(EXPORT_BUNDLE_CAPS.translations).default([]),
        forms: z.array(FormSchema).max(EXPORT_BUNDLE_CAPS.forms).default([]),
        media: z.array(MediaAssetSchema).max(EXPORT_BUNDLE_CAPS.media).default([]),
        mediaFolders: z.array(MediaFolderRecordSchema).max(EXPORT_BUNDLE_CAPS.mediaFolders).default([]),
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
        // Rich (data-sw-html) content lives in page.data (the single store) and is sanitized at RENDER
        // by the html sink; an imported page.data HTML leaf is therefore never emitted unsanitized. The
        // bundle's PageSchema bounds + proto-checks page.data (and strips any unknown legacy shapes —
        // no back-compat migration).
        await this.writeRow(exec, ctx, 'page', page.id, page);
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
      // Whole-project sections (present only for a full/zip import; empty for a legacy JSON bundle).
      for (const snippet of input.snippets) {
        await this.writeRow(exec, ctx, 'snippet', snippet.id, snippet);
        imported += 1;
      }
      for (const translation of input.translations) {
        await this.writeRow(exec, ctx, 'translation', translation.id, translation);
        imported += 1;
      }
      for (const form of input.forms) {
        await this.writeRow(exec, ctx, 'form', form.id, form);
        imported += 1;
      }
      for (const asset of input.media) {
        await this.writeRow(exec, ctx, 'media', asset.id, asset);
        imported += 1;
      }
      for (const folder of input.mediaFolders) {
        await this.writeRow(exec, ctx, 'mediafolder', folder.id, folder);
        imported += 1;
      }
    });
    return { imported };
  }

  /**
   * Apply a set of page upserts/removals plus an optional settings update in ONE
   * transaction — the multilingual locale operations (scaffold a translation target,
   * cascade-delete one, propagate a page into all languages) which must not leave a
   * half-built locale subtree behind. Validates every entity up front (so a bad payload
   * fails before any write); change events fire only AFTER the commit succeeds, so
   * live-preview clients reload against committed state.
   *
   * NOTE: like `importBundle`, the transactional `writeRow`s here do NOT record revisions — locale
   * scaffolding/teardown is structural; per-entity revisioning of batch ops is a deferred enhancement.
   */
  async applyLocaleChange(
    ctx: ProjectContext,
    change: { putPages?: unknown[]; removePageIds?: string[]; settings?: unknown },
  ): Promise<{ pages: Page[] }> {
    const putPages = (change.putPages ?? []).map((raw) => {
      return PageSchema.parse(raw) as Page;
    });
    const settings =
      change.settings !== undefined ? schemaFor('settings').parse(change.settings) : undefined;
    const removeIds = change.removePageIds ?? [];
    // Bound the batch so a single locale op can't monopolise the write connection (a scaffold
    // is one variant per default page; the bundle ceiling is the natural upper bound).
    if (putPages.length + removeIds.length > MAX_LOCALE_BATCH) {
      throw new ConflictError(`locale change is too large (max ${MAX_LOCALE_BATCH} pages)`);
    }

    // Only pages that actually existed are deleted — so we emit delete events only for those
    // (an id that wasn't present must not produce a spurious delete to live-preview clients).
    const deleted: string[] = [];
    await this.db.transaction(async (tx) => {
      const exec = tx as unknown as Executor;
      if (settings !== undefined) await this.writeRow(exec, ctx, 'settings', SETTINGS_ENTITY_ID, settings);
      for (const page of putPages) await this.writeRow(exec, ctx, 'page', page.id, page);
      for (const id of removeIds) {
        const row = await this.row(exec, ctx, 'page', id);
        if (row) {
          await exec.delete(content).where(and(eq(content.id, row.id), eq(content.projectId, ctx.projectId)));
          deleted.push(id);
        }
      }
    });

    if (settings !== undefined) {
      this.events?.emit(ctx.projectId, { kind: 'settings', entityId: SETTINGS_ENTITY_ID, op: 'put', actor: ctx.actor });
    }
    for (const page of putPages) {
      this.events?.emit(ctx.projectId, { kind: 'page', entityId: page.id, op: 'put', actor: ctx.actor });
    }
    for (const id of deleted) {
      this.events?.emit(ctx.projectId, { kind: 'page', entityId: id, op: 'delete', actor: ctx.actor });
    }
    return { pages: putPages };
  }

  /**
   * Rename a dataset's `slug` (its reference handle; the entity `id`/key is unchanged). When `cascade`,
   * also rewrite — in ONE transaction — every place that referenced the OLD slug: each entry's `dataset`
   * field, each page/template `source` (`dataset.<slug>` paths + `dataset="<slug>"` picker args), and any
   * other dataset's `reference` field whose `config.target` pointed at it. Without `cascade`, only the
   * dataset's own slug changes (entries/pages are left pointing at the old slug — the caller is warned).
   * Events fire AFTER commit so live-preview reloads against committed state. Returns per-kind counts.
   */
  async renameDataset(
    ctx: ProjectContext,
    datasetId: string,
    newSlug: string,
    opts: { cascade: boolean; name?: string },
  ): Promise<{ oldSlug: string; newSlug: string; cascaded: boolean; entriesUpdated: number; pagesUpdated: number; templatesUpdated: number; referencesUpdated: number }> {
    const ds = (await this.get(ctx, 'dataset', datasetId)) as Dataset; // throws NotFoundError if absent
    const oldSlug = ds.slug;
    // Validate the new slug (+ optional display name) by re-parsing the dataset through its schema.
    const newName = opts.name?.trim() || ds.name;
    const renamed = DatasetSchema.parse({ ...ds, slug: newSlug, name: newName }) as Dataset;
    if (renamed.slug === oldSlug) {
      // Slug unchanged — but a display-name change still needs persisting (a name-only rename).
      if (renamed.name !== ds.name) {
        await this.writeRow(this.db, ctx, 'dataset', datasetId, renamed);
        this.events?.emit(ctx.projectId, { kind: 'dataset', entityId: datasetId, op: 'put', actor: ctx.actor });
      }
      return { oldSlug, newSlug: oldSlug, cascaded: opts.cascade, entriesUpdated: 0, pagesUpdated: 0, templatesUpdated: 0, referencesUpdated: 0 };
    }
    const datasets = (await this.list(ctx, 'dataset')) as Dataset[];
    if (datasets.some((d) => d.id !== datasetId && d.slug === renamed.slug)) {
      throw new ConflictError(`a dataset with slug "${renamed.slug}" already exists`);
    }

    const entriesToUpdate: Entry[] = [];
    const pagesToUpdate: Array<{ p: Page; source: string }> = [];
    const templatesToUpdate: Array<{ t: Template; source: string }> = [];
    const refDatasets: Dataset[] = [];
    if (opts.cascade) {
      for (const e of (await this.list(ctx, 'entry')) as Entry[]) {
        if (e.dataset === oldSlug) entriesToUpdate.push({ ...e, dataset: renamed.slug });
      }
      for (const p of (await this.list(ctx, 'page')) as Page[]) {
        if (typeof p.source === 'string' && sourceReferencesDataset(p.source, oldSlug)) {
          pagesToUpdate.push({ p, source: rewriteDatasetRefsInSource(p.source, oldSlug, renamed.slug) });
        }
      }
      for (const t of (await this.list(ctx, 'template')) as Template[]) {
        if (typeof t.source === 'string' && sourceReferencesDataset(t.source, oldSlug)) {
          templatesToUpdate.push({ t, source: rewriteDatasetRefsInSource(t.source, oldSlug, renamed.slug) });
        }
      }
      for (const d of datasets) {
        if (d.id === datasetId) continue;
        const { fields, changed } = rewriteReferenceTargets(d.fields ?? [], oldSlug, renamed.slug);
        if (changed) refDatasets.push({ ...d, fields });
      }
    }

    await this.db.transaction(async (tx) => {
      const exec = tx as unknown as Executor;
      await this.writeRow(exec, ctx, 'dataset', datasetId, renamed);
      // Entries are dataset-SCOPED: a rename moves each entry's row from the old slug's scope to the new
      // one (in place) — a plain writeRow would compute the new scope, miss the old-scope row, and insert
      // a duplicate. rescopeEntry re-keys the single existing row.
      for (const e of entriesToUpdate) await this.rescopeEntry(exec, ctx, e.id, oldSlug, e);
      for (const { p, source } of pagesToUpdate) await this.writeRow(exec, ctx, 'page', p.id, { ...p, source });
      for (const { t, source } of templatesToUpdate) await this.writeRow(exec, ctx, 'template', t.id, { ...t, source });
      for (const d of refDatasets) await this.writeRow(exec, ctx, 'dataset', d.id, d);
    });

    this.events?.emit(ctx.projectId, { kind: 'dataset', entityId: datasetId, op: 'put', actor: ctx.actor });
    for (const e of entriesToUpdate) this.events?.emit(ctx.projectId, { kind: 'entry', entityId: e.id, op: 'put', actor: ctx.actor });
    for (const { p } of pagesToUpdate) this.events?.emit(ctx.projectId, { kind: 'page', entityId: p.id, op: 'put', actor: ctx.actor });
    for (const { t } of templatesToUpdate) this.events?.emit(ctx.projectId, { kind: 'template', entityId: t.id, op: 'put', actor: ctx.actor });
    for (const d of refDatasets) this.events?.emit(ctx.projectId, { kind: 'dataset', entityId: d.id, op: 'put', actor: ctx.actor });

    return {
      oldSlug,
      newSlug: renamed.slug,
      cascaded: opts.cascade,
      entriesUpdated: entriesToUpdate.length,
      pagesUpdated: pagesToUpdate.length,
      templatesUpdated: templatesToUpdate.length,
      referencesUpdated: refDatasets.length,
    };
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

  /**
   * The uniqueness SCOPE of a row derived from its data: an `entry` is scoped to its owning DATASET
   * SLUG (so its id only has to be unique within that dataset); every other kind is project-global
   * (`''`). Read-side callers (get/remove/row) that lack the data pass the scope explicitly.
   */
  private scopeForData(kind: ContentKind, data: unknown): string {
    return kind === 'entry' ? String((data as { dataset?: string }).dataset ?? '') : '';
  }

  private async writeRow(
    exec: Executor,
    ctx: ProjectContext,
    kind: ContentKind,
    entityId: string,
    data: unknown,
  ): Promise<void> {
    const now = new Date();
    const scope = this.scopeForData(kind, data);
    const existing = await this.row(exec, ctx, kind, entityId, scope);
    if (existing) {
      await exec
        .update(content)
        .set({ data, updatedAt: now })
        .where(and(eq(content.id, existing.id), eq(content.projectId, ctx.projectId)));
    } else {
      await exec.insert(content).values({
        id: newId(),
        projectId: ctx.projectId,
        kind,
        entityId,
        scope,
        data,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  /**
   * Move an `entry` row from `oldScope` (its previous dataset slug) to the scope derived from `data`
   * (its new dataset slug) — used by the dataset-rename cascade. Re-keys the ONE existing row in place
   * (data + scope) so the entry moves rather than duplicating; inserts fresh if no old-scope row exists.
   * (Entry revision history stays under the old scope — rename is rare and history is best-effort.)
   */
  private async rescopeEntry(exec: Executor, ctx: ProjectContext, entityId: string, oldScope: string, data: unknown): Promise<void> {
    const existing = await this.row(exec, ctx, 'entry', entityId, oldScope);
    if (!existing) {
      await this.writeRow(exec, ctx, 'entry', entityId, data);
      return;
    }
    await exec
      .update(content)
      .set({ data, scope: this.scopeForData('entry', data), updatedAt: new Date() })
      .where(and(eq(content.id, existing.id), eq(content.projectId, ctx.projectId)));
  }

  private async row(exec: Executor, ctx: ProjectContext, kind: ContentKind, entityId: string, scope = '') {
    const [row] = await exec
      .select()
      .from(content)
      .where(
        and(
          eq(content.projectId, ctx.projectId),
          eq(content.kind, kind),
          eq(content.scope, scope),
          eq(content.entityId, entityId),
        ),
      );
    return row;
  }
}

export { SETTINGS_ENTITY_ID };
