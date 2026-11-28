// The dataset-rename CASCADE as one pure plan: given the project's rows, compute every row a rename has to
// write — or refuse it — before anything is written. The repo reads the inputs INSIDE the write transaction
// and commits the plan there, so a rename either lands everywhere or nowhere, and never on stale rows.
import { DatasetSlugSchema, type Dataset, type Entry, type Page, type Snippet, type Template } from '@sitewright/schema';
import { GLOBAL_TEMPLATE_PREFIX, WIDGET_PARTIALS, isGlobalTemplate, localizedDatasetName, resolveCodeRef } from '@sitewright/core';
import { ConflictError } from './context.js';
import {
  CHROME_SLOTS,
  datasetControlTargets,
  localeCopyRenames,
  namedLikeLocaleCopies,
  partialsReached,
  rewriteDataLeaf,
  rewriteDatasetRefsInSource,
  rewriteReferenceTargets,
  rewriteWebsiteDatasetRefs,
  sourceReferencesDataset,
  widgetUsages,
  withReachedPartials,
  type LabelledSource,
  type LocaleCopyRename,
  type WebsiteDatasetRefs,
} from './dataset-rename.js';

/** One slug change. The first pair is the dataset the author renamed; any others are its language copies. */
export interface RenamePair {
  id: string;
  oldSlug: string;
  newSlug: string;
}

/** The raw settings row — only `website` (what can name a dataset) and the locales are read. */
export type SettingsRow = { website?: WebsiteDatasetRefs; settings?: { locales?: unknown; defaultLocale?: unknown } } & Record<string, unknown>;

export interface DatasetRenameInput {
  /** The renamed dataset, already validated with its NEW slug (and display name). */
  renamed: Dataset;
  oldSlug: string;
  cascade: boolean;
  datasets: readonly Dataset[];
  /** The entry rows found under each renamed slug's SCOPE (see {@link plannedSlugChanges}) — read by scope, so a
   *  rename never loads the whole project's entries while it holds the write gate. */
  entries: ReadonlyArray<{ scope: string; entry: Entry }>;
  pages: readonly Page[];
  templates: readonly Template[];
  snippets: readonly Snippet[];
  settings?: SettingsRow;
  /** The instance library — read only, never rewritten: what a page reaches through a `global:` template or a
   *  library snippet renders on this site all the same. */
  library: { templates: readonly Template[]; snippets: readonly Snippet[] };
}

export interface DatasetRenamePlan {
  pairs: RenamePair[];
  /** Every dataset row to write: the renamed one, its renamed language copies, and other datasets retargeted. */
  datasets: Dataset[];
  /** How many datasets OTHER than the renamed ones had a reference field repointed. */
  referencesUpdated: number;
  entries: Array<{ entry: Entry; oldScope: string }>;
  pages: Page[];
  templates: Template[];
  snippets: Snippet[];
  /** The whole settings row to write back, when its `website` named the dataset. */
  settings?: SettingsRow;
  /** Datasets named like a language copy of the old slug that keep their name (a language the site does not
   *  have, or cascade off) — reported so the author can deal with them. */
  localeCopiesNotRenamed: string[];
}

function localesOf(settings: SettingsRow | undefined): string[] {
  const raw = settings?.settings?.locales;
  return Array.isArray(raw) ? raw.filter((l): l is string => typeof l === 'string') : [];
}

function defaultLocaleOf(settings: SettingsRow | undefined): string {
  const raw = settings?.settings?.defaultLocale;
  return typeof raw === 'string' ? raw : 'en';
}

const MAX_NAMED = 5;

/** `a, b, c` — or the first few `and N more`, so a message stays readable on a large site. */
function listNames(labels: readonly string[]): string {
  return labels.length <= MAX_NAMED ? labels.join(', ') : `${labels.slice(0, MAX_NAMED).join(', ')} and ${labels.length - MAX_NAMED} more`;
}

/** What renders on this site, resolved the way the render resolves it. */
interface SiteSources {
  /** The render's partials: library snippets, then the project's own (which win), then the widget bodies. */
  partials: Record<string, string>;
  /** The source each page renders from: its own, its template's (project or library), or its translation owner's. */
  pageSource: Map<string, string>;
  slotSources: string[];
  /** Every authored source, labelled: pages' own, project templates and snippets, chrome slots, library templates in use. */
  rows: LabelledSource[];
  /** The library templates and snippets the site reaches, labelled with who reaches them. */
  library: LabelledSource[];
}

function siteSources(input: DatasetRenameInput): SiteSources {
  const partials: Record<string, string> = {};
  for (const s of [...input.library.snippets, ...input.snippets]) partials[s.name] = s.source;
  Object.assign(partials, WIDGET_PARTIALS);
  const projectTemplates = new Map(input.templates.map((t) => [t.id, t]));
  const libraryTemplates = new Map(input.library.templates.map((t) => [GLOBAL_TEMPLATE_PREFIX + t.id, t]));
  const defaultLocale = defaultLocaleOf(input.settings);
  const pageSource = new Map<string, string>();
  const libraryUsers = new Map<string, string[]>();
  for (const p of input.pages) {
    const ref = resolveCodeRef(p, input.pages, defaultLocale);
    if (ref.template && isGlobalTemplate(ref.template)) {
      const t = libraryTemplates.get(ref.template);
      if (t) libraryUsers.set(ref.template, [...(libraryUsers.get(ref.template) ?? []), `page "${p.id}"`]);
      pageSource.set(p.id, t?.source ?? '');
    } else {
      pageSource.set(p.id, ref.template ? (projectTemplates.get(ref.template)?.source ?? '') : (ref.source ?? ''));
    }
  }
  const website = input.settings?.website;
  // eslint-disable-next-line security/detect-object-injection -- s is one of the fixed CHROME_SLOTS names
  const slots = CHROME_SLOTS.flatMap((s) => (website && typeof website[s] === 'string' ? [{ label: `website ${s}`, source: website[s] }] : []));
  const libraryTemplateRows = [...libraryUsers].map(([ref, users]) => ({
    label: `library template "${ref.slice(GLOBAL_TEMPLATE_PREFIX.length)}" (used by ${listNames(users)})`,
    source: libraryTemplates.get(ref)!.source,
  }));
  const rows: LabelledSource[] = [
    ...input.pages.flatMap((p) => (typeof p.source === 'string' && p.source ? [{ label: `page "${p.id}"`, source: p.source }] : [])),
    ...input.templates.map((t) => ({ label: `template "${t.id}"`, source: t.source })),
    ...input.snippets.map((s) => ({ label: `snippet "${s.name}"`, source: s.source })),
    ...slots,
    ...libraryTemplateRows,
  ];
  // A library snippet renders only where nothing of the project's (or a widget) takes its name.
  const shadowed = new Set([...input.snippets.map((s) => s.name), ...Object.keys(WIDGET_PARTIALS)]);
  const reached = rows.map((r) => ({ label: r.label, names: partialsReached([r.source], partials) }));
  const librarySnippetRows = input.library.snippets.flatMap((s) => {
    if (shadowed.has(s.name)) return [];
    const by = reached.filter((r) => r.names.has(s.name)).map((r) => r.label);
    return by.length > 0 ? [{ label: `library snippet "${s.name}" (included by ${listNames(by)})`, source: s.source }] : [];
  });
  return { partials, pageSource, slotSources: slots.map((s) => s.source), rows, library: [...libraryTemplateRows, ...librarySnippetRows] };
}

/** Each copy's new name must itself be a valid slug (`<new>_<locale>` can outgrow the length cap). */
function assertCopySlugsValid(copies: readonly LocaleCopyRename[]): void {
  for (const c of copies) {
    const res = DatasetSlugSchema.safeParse(c.newSlug);
    if (res.success) continue;
    throw new ConflictError(
      `the "${c.locale}" copy "${c.oldSlug}" would become "${c.newSlug}", which is not a valid dataset slug (${res.error.issues[0]?.message ?? 'invalid'}) — choose a shorter name`,
    );
  }
}

/** Refuse a rename that would land any slug on one already taken. Checked for EVERY pair before any write. */
function assertNoCollision(pairs: readonly RenamePair[], datasets: readonly Dataset[], copies: readonly LocaleCopyRename[]): void {
  const base = pairs[0]!;
  for (const p of pairs) {
    if (!datasets.some((d) => d.id !== p.id && d.slug === p.newSlug)) continue;
    if (p === base) throw new ConflictError(`a dataset with slug "${p.newSlug}" already exists`);
    const locale = copies.find((c) => c.id === p.id)?.locale ?? '';
    throw new ConflictError(
      `a dataset with slug "${p.newSlug}" already exists — renaming "${base.oldSlug}" also renames its "${locale}" ` +
        `language copy "${p.oldSlug}" to "${p.newSlug}"; rename or delete the existing "${p.newSlug}" first`,
    );
  }
}

/**
 * Refuse when `<new>_<locale>` already exists with nothing being renamed into it: a page in that language would
 * start reading THAT dataset as the renamed one — the rename would silently change what the language shows.
 */
function assertNoRebind(input: DatasetRenameInput, locales: readonly string[], copies: readonly LocaleCopyRename[]): void {
  for (const locale of locales) {
    const target = localizedDatasetName(input.renamed.slug, locale);
    if (copies.some((c) => c.newSlug === target)) continue; // a collision, reported by assertNoCollision
    if (!input.datasets.some((d) => d.slug === target && d.id !== input.renamed.id)) continue;
    throw new ConflictError(
      `a dataset "${target}" already exists, and a "${locale}" page reads dataset.${input.renamed.slug} as that one — renaming ` +
        `"${input.oldSlug}" to "${input.renamed.slug}" would switch every "${locale}" page to it. Rename or delete "${target}" first`,
    );
  }
}

/** Refuse renaming a dataset a platform widget on this site reads by name — the widget cannot be repointed. */
function assertNoWidgetReads(input: DatasetRenameInput, site: SiteSources, locales: readonly string[]): void {
  const usages = widgetUsages(site.rows, site.partials, input.oldSlug, locales);
  if (usages.length === 0) return;
  const what = usages.map((u) => `the {{> ${u.widget}}} widget (used by ${listNames(u.usedBy)})`).join('; ');
  throw new ConflictError(
    `dataset "${input.oldSlug}" holds the settings of ${what}, which reads it by that exact name — renaming it would leave ` +
      `the widget empty. Change its display name instead`,
  );
}

/** Refuse when a library template/snippet the site renders reads a renamed slug: it is not this project's to rewrite. */
function assertLibraryDoesNotRead(site: SiteSources, pairs: readonly RenamePair[]): void {
  for (const lib of site.library) {
    const p = pairs.find((pair) => sourceReferencesDataset(lib.source, pair.oldSlug));
    if (!p) continue;
    throw new ConflictError(
      `the shared ${lib.label} reads "${p.oldSlug}" by name. The library is shared by every project on this instance, so a ` +
        `rename does not rewrite it — give the site its own copy of it (or ask an administrator to update it) first, or ` +
        `rename with "Rename slug only" (cascade off) and fix the site's references yourself`,
    );
  }
}

/** Rewrite the values `{{sw-control as="dataset"}}` stored in one JSON object, for every pair. */
function rewriteControlValues<T>(data: T, paths: readonly string[], pairs: readonly RenamePair[]): T {
  let out = data;
  for (const path of paths) for (const p of pairs) out = rewriteDataLeaf(out, path, p.oldSlug, p.newSlug).data;
  return out;
}

function planDatasets(input: DatasetRenameInput, pairs: readonly RenamePair[]): { datasets: Dataset[]; referencesUpdated: number } {
  const base = pairs[0]!;
  const renamedTo = new Map(pairs.map((p) => [p.id, p.newSlug]));
  const out: Dataset[] = [];
  let referencesUpdated = 0;
  for (const d of input.datasets) {
    const newSlug = renamedTo.get(d.id);
    // A language copy is written back as STORED, apart from its slug — never re-normalised through the schema.
    let row: Dataset = d.id === base.id ? input.renamed : newSlug !== undefined ? { ...d, slug: newSlug } : d;
    // A dataset's reference to ITSELF is part of the dataset being renamed, so it follows even without cascade.
    const applied = input.cascade ? pairs : d.id === base.id ? [base] : [];
    let retargeted = false;
    for (const p of applied) {
      const r = rewriteReferenceTargets(row.fields ?? [], p.oldSlug, p.newSlug);
      if (r.changed) {
        row = { ...row, fields: r.fields };
        retargeted = true;
      }
    }
    if (newSlug !== undefined || retargeted) out.push(row);
    if (newSlug === undefined && retargeted) referencesUpdated += 1;
  }
  return { datasets: out, referencesUpdated };
}

/**
 * Where, per row, a `{{sw-control as="dataset"}}` writes the slug it picked — computed from what that row
 * actually RENDERS (its resolved source + the snippets it reaches, and for a page the chrome slots around it),
 * so a page.data key of the same name on a page without that control is left alone.
 */
function controlPaths(input: DatasetRenameInput, site: SiteSources) {
  const any = site.rows.some((r) => r.source.includes('sw-control')) || Object.values(site.partials).some((s) => s.includes('sw-control'));
  const paths = (sources: readonly string[], store: 'page' | 'website'): string[] =>
    any ? datasetControlTargets(withReachedPartials(sources, site.partials)).filter((c) => c.store === store).map((c) => c.path) : [];
  const renderedBy = (p: Page): string[] => [site.pageSource.get(p.id) ?? '', ...site.slotSources].filter((s) => s !== '');
  return {
    page: (p: Page) => paths(renderedBy(p), 'page'),
    template: (t: Template) => paths([t.source], 'page'),
    website: paths([...input.pages.flatMap(renderedBy), ...site.slotSources], 'website'),
  };
}

function planSources(input: DatasetRenameInput, pairs: readonly RenamePair[], site: SiteSources) {
  const rewrite = (s: string): string => pairs.reduce((acc, p) => rewriteDatasetRefsInSource(acc, p.oldSlug, p.newSlug), s);
  const controls = controlPaths(input, site);
  // Only the keys that changed are replaced, so a page that inherits its code (no `source`) or has no `data`
  // is written back exactly as it was apart from the rewrite.
  const withSourceAndData = <T extends { source?: string; data?: unknown }>(row: T, paths: readonly string[]): T | null => {
    let next = row;
    if (typeof row.source === 'string') {
      const source = rewrite(row.source);
      if (source !== row.source) next = { ...next, source };
    }
    const data = rewriteControlValues(row.data, paths, pairs);
    if (data !== row.data) next = { ...next, data };
    return next === row ? null : next;
  };
  const pages = input.pages.map((p) => withSourceAndData(p, controls.page(p))).filter((p): p is Page => p !== null);
  const templates = input.templates.map((t) => withSourceAndData(t, controls.template(t))).filter((t): t is Template => t !== null);
  const snippets = input.snippets.filter((s) => rewrite(s.source) !== s.source).map((s) => ({ ...s, source: rewrite(s.source) }));
  let settings: SettingsRow | undefined;
  const website = input.settings?.website;
  if (website) {
    const next = pairs.reduce((w, p) => rewriteWebsiteDatasetRefs(w, p.oldSlug, p.newSlug, controls.website).website, website);
    if (next !== website) settings = { ...input.settings, website: next };
  }
  return { pages, templates, snippets, settings };
}

/**
 * The slug changes a rename makes: the dataset itself, and — with cascade — its copy for each of the site's
 * languages. The repo reads the entries of exactly these old slugs; the plan derives its pairs from the same call.
 */
export function plannedSlugChanges(input: Pick<DatasetRenameInput, 'renamed' | 'oldSlug' | 'cascade' | 'datasets' | 'settings'>): {
  pairs: RenamePair[];
  copies: LocaleCopyRename[];
} {
  const base: RenamePair = { id: input.renamed.id, oldSlug: input.oldSlug, newSlug: input.renamed.slug };
  const copies = input.cascade ? localeCopyRenames(input.datasets, localesOf(input.settings), base.oldSlug, base.newSlug).filter((c) => c.id !== base.id) : [];
  return { pairs: [base, ...copies.map(({ id, oldSlug, newSlug }) => ({ id, oldSlug, newSlug }))], copies };
}

/**
 * Plan a dataset rename. ENTRIES of every renamed dataset always move (they are owned — see
 * `ContentRepository.renameDataset`); with `cascade`, every EXTERNAL reference is rewritten too and the
 * dataset's language copies are renamed with it. Throws {@link ConflictError} — before anything is written —
 * when a slug would be invalid, collide, or silently rebind a language; when a widget on the site reads the
 * dataset by name; or (with cascade) when a shared library template/snippet the site renders reads it.
 */
export function planDatasetRename(input: DatasetRenameInput): DatasetRenamePlan {
  const { pairs, copies } = plannedSlugChanges(input);
  const base = pairs[0]!;
  const locales = localesOf(input.settings);
  assertCopySlugsValid(copies);
  assertNoCollision(pairs, input.datasets, copies);
  assertNoRebind(input, locales, copies);

  const site = siteSources(input);
  assertNoWidgetReads(input, site, locales);
  if (input.cascade) assertLibraryDoesNotRead(site, pairs);

  // An entry belongs to the dataset whose SCOPE it is filed under — that is where every list finds it — so it
  // moves from there, and its `dataset` is set to match.
  const scopeOf = new Map(pairs.map((p) => [p.oldSlug, p.newSlug]));
  const entries = input.entries.flatMap(({ scope, entry }) => {
    const to = scopeOf.get(scope);
    return to === undefined ? [] : [{ entry: { ...entry, dataset: to }, oldScope: scope }];
  });
  const { datasets, referencesUpdated } = planDatasets(input, pairs);
  const external = input.cascade ? planSources(input, pairs, site) : { pages: [], templates: [], snippets: [], settings: undefined };
  const renamedCopies = new Set(copies.map((c) => c.oldSlug));
  const localeCopiesNotRenamed = namedLikeLocaleCopies(input.datasets, base.oldSlug).filter((s) => !renamedCopies.has(s));
  return { pairs, datasets, referencesUpdated, entries, ...external, localeCopiesNotRenamed };
}
