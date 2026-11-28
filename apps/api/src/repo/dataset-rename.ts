// Pure helpers for the dataset-slug RENAME cascade. Renaming a dataset's `slug` must update every place
// that references it BY SLUG:
//   · a Handlebars `source` — a page, a template, a snippet, a website chrome slot: the
//     `{{#each dataset.<slug>}}` / `{{#sw-pick-entry dataset.<slug> …}}` paths, the keyed
//     `{{item.<slug>.<key>…}}` lookup, and a `{{sw-control … dataset="<slug>"}}` picker arg;
//   · a VALUE a client picked with `{{sw-control as="dataset"}}` (stored in page.data / website.data);
//   · a `website.dataFiles` entry's `dataset`;
//   · another dataset's `reference` field, whose TARGET is `config.dataset`;
//   · an entry's `dataset` field (the repo moves those).
// Kept pure (no DB) so the rewrite rules are unit-tested in isolation; the repo wires them into one transaction.
//
// The rewrite is TEXTUAL for `dataset.<slug>` and `dataset="<slug>"`: a mention in prose or in a code sample
// on the page is rewritten too, exactly as the engine's own scans find it. `item.<slug>` is narrower (below).
import { classifyControlTarget } from '@sitewright/blocks';
import { GLOBAL_WIDGETS, localizedDatasetName } from '@sitewright/core';

/** Escape a slug for use inside a RegExp. Slugs are normally `[a-z0-9_]`, but a LEGACY slug may still
 *  contain `-` (pre-underscore datasets), so escape every RegExp meta char to be safe. */
function esc(slug: string): string {
  return slug.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/** One `{{…}}` tag of a source. */
export interface MustacheTag {
  start: number;
  /** Exclusive. */
  end: number;
  /**
   * `open` — a block opener (`{{#name …}}`, `{{^name}}`); `else` — `{{else}}`, `{{^}}` or a chained
   * `{{else if …}}` inside a block; `close` — `{{/name}}`; anything else (incl. a comment, a raw block) `other`.
   */
  kind: 'open' | 'else' | 'close' | 'other';
  /** The helper / block name (`each`, `sw-control`, …; for a chained else, the chained helper); '' when none. */
  name: string;
  /** For an opener or a chained else: whether that block renders in the SAME context (`if`, `unless`, an
   *  inverse section). */
  transparent: boolean;
  /** The tag's text between the braces, without `~` and the leading sigil. */
  body: string;
}

const TAG_NAME = /^[^\s~()}]+/;
const keepsContext = (name: string): boolean => name === 'if' || name === 'unless';

function classifyTag(start: number, end: number, raw: string): MustacheTag {
  const inner = raw.replace(/^~/, '').replace(/~$/, '').trim();
  const sigil = inner[0];
  if (sigil === '#' || sigil === '^') {
    let rest = inner.slice(1).trim();
    if (rest.startsWith('>') || rest.startsWith('*')) rest = rest.slice(1).trim(); // partial block / decorator block
    const name = TAG_NAME.exec(rest)?.[0] ?? '';
    // A bare `{{^}}` is an `else`; `{{^name}}` is an inverse section, which keeps the context.
    if (sigil === '^' && name === '') return { start, end, kind: 'else', name: '', transparent: true, body: rest };
    return { start, end, kind: 'open', name, transparent: sigil === '^' || keepsContext(name), body: rest };
  }
  if (sigil === '/') return { start, end, kind: 'close', name: TAG_NAME.exec(inner.slice(1).trim())?.[0] ?? '', transparent: false, body: '' };
  if (/^else(?:\s|$)/.test(inner)) {
    const chained = TAG_NAME.exec(inner.slice(4).trim())?.[0] ?? '';
    return { start, end, kind: 'else', name: chained, transparent: chained === '' || keepsContext(chained), body: inner.slice(4).trim() };
  }
  return { start, end, kind: 'other', name: TAG_NAME.exec(inner)?.[0] ?? '', transparent: false, body: inner };
}

/** Where the string literal opened at `j` (a quote char) ends — honouring `\"` / `\'` inside it, as Handlebars does. */
function endOfString(source: string, j: number): number {
  const quote = source.charAt(j);
  for (let k = j + 1; k < source.length; k += 1) {
    if (source.charAt(k) === '\\' && source.charAt(k + 1) === quote) k += 1;
    else if (source.charAt(k) === quote) return k;
  }
  return source.length;
}

/** Whether the `{{` at `i` is escaped (`\{{` — emitted as text), i.e. preceded by an ODD number of backslashes. */
function isEscaped(source: string, i: number): boolean {
  let n = 0;
  while (i - n - 1 >= 0 && source.charAt(i - n - 1) === '\\') n += 1;
  return n % 2 === 1;
}

/** End (exclusive) of a comment tag starting at `i` (`{{!`, `{{~!`, long `--` form), or -1 when it is not one. */
function commentEnd(source: string, i: number): number {
  const bang = source.startsWith('{{~!', i) ? i + 3 : source.startsWith('{{!', i) ? i + 2 : -1;
  if (bang === -1) return -1;
  if (source.startsWith('!--', bang)) {
    const close = /--~?\}\}/g;
    close.lastIndex = bang + 3;
    const m = close.exec(source);
    return m ? m.index + m[0].length : source.length;
  }
  const at = source.indexOf('}}', bang + 1);
  return at === -1 ? source.length : at + 2;
}

/** End (exclusive) of a raw block `{{{{name}}}} … {{{{/name}}}}` starting at `i`, or -1 when it is not one. */
function rawBlockEnd(source: string, i: number): number {
  if (!source.startsWith('{{{{', i) || source.startsWith('{{{{/', i)) return -1;
  const open = source.indexOf('}}}}', i + 4);
  if (open === -1) return source.length;
  const name = TAG_NAME.exec(source.slice(i + 4, open).trim())?.[0] ?? '';
  const closer = `{{{{/${name}}}}}`;
  const at = source.indexOf(closer, open + 4);
  return at === -1 ? source.length : at + closer.length;
}

/**
 * Every mustache tag in `source`, in order, the way Handlebars' lexer reads them: a `}}` inside a quoted
 * argument (escaped quotes included) does not end a tag; a comment (`{{! }}`, `{{!-- --}}`, with or without
 * `~`) and a raw block (`{{{{raw}}}}…{{{{/raw}}}}`, whose body is literal) are each one `other` tag; and an
 * escaped `\{{` is text, not a tag.
 */
export function scanTags(source: string): MustacheTag[] {
  const tags: MustacheTag[] = [];
  let i = source.indexOf('{{');
  while (i !== -1) {
    let end: number;
    // `{{!` and `{{{{` cannot both start at `i`, so at most one of these is not -1.
    const literal = isEscaped(source, i) ? -1 : Math.max(commentEnd(source, i), rawBlockEnd(source, i));
    if (isEscaped(source, i)) {
      end = i + 2; // `\{{…` is text up to the next `{{`
    } else if (literal !== -1) {
      end = literal;
      tags.push({ start: i, end, kind: 'other', name: '', transparent: false, body: '' });
    } else {
      const from = source.charAt(i + 2) === '{' ? i + 3 : i + 2; // a triple-stache opens with one more brace
      let j = from;
      while (j < source.length && !(source.charAt(j) === '}' && source.charAt(j + 1) === '}')) {
        j = source.charAt(j) === '"' || source.charAt(j) === "'" ? endOfString(source, j) + 1 : j + 1;
      }
      end = Math.min(j + 2, source.length);
      tags.push(classifyTag(i, end, source.slice(from, j)));
    }
    i = source.indexOf('{{', end);
  }
  return tags;
}

/**
 * The keyed-entry namespace (`ITEM_REF_RE` in @sitewright/core bindings.ts) — `item.<slug>` — rewritten only
 * where Handlebars actually resolves it to the namespace. The engine renders without `compat`, so a BARE
 * `item.x` reads the CURRENT context: at the top of the source that is the root (the namespace), but inside
 * an `{{#each}}` / `{{#with}}` / `{{#sw-pick-entry}}` it is the row's own `item` field or an `as |item|`
 * block param — not the namespace, and not ours to rename. From inside a block the namespace is reached as
 * `@root.item.<slug>` or with enough `../` to climb back to the root. `if` / `unless` keep the context, a
 * block's own opener is evaluated in the context OUTSIDE it, and so is its `{{else}}` part (a chained
 * `{{else each …}}` enters a context of its own from there).
 */
function rewriteItemRefs(source: string, oldSlug: string, newSlug: string): string {
  const re = new RegExp(`(@root\\.|(?:\\.\\.\\/)+|(?<![\\w./-]))item\\.${esc(oldSlug)}(?![A-Za-z0-9_-])`, 'g');
  const at = (chunk: string, depth: number): string =>
    chunk.replace(re, (match, head: string) => {
      const reachesRoot = head === '@root.' || (head === '' ? depth === 0 : head.length / 3 >= depth);
      return reachesRoot ? `${head}item.${newSlug}` : match;
    });
  /** Each open block and the depth OUTSIDE it — what its else part and its closer return to. */
  const open: Array<{ name: string; outer: number }> = [];
  /** How many blocks of each name are open, so a closer with no match is known at once (see below). */
  const openCount = new Map<string, number>();
  let depth = 0;
  let out = '';
  let pos = 0;
  for (const tag of scanTags(source)) {
    // An else tag's own arguments (`{{else if item.x}}`) are evaluated where the else part renders: OUTSIDE.
    const outside = tag.kind === 'else' && open.length > 0 ? open.at(-1)!.outer : depth;
    out += at(source.slice(pos, tag.start), depth) + at(source.slice(tag.start, tag.end), outside);
    pos = tag.end;
    if (tag.kind === 'open') {
      open.push({ name: tag.name, outer: depth });
      openCount.set(tag.name, (openCount.get(tag.name) ?? 0) + 1);
      if (!tag.transparent) depth += 1;
    } else if (tag.kind === 'else' && open.length > 0) {
      depth = outside + (tag.transparent ? 0 : 1);
    } else if (tag.kind === 'close') {
      // A stray closer (nothing of that name open — the template would not compile) leaves the depth alone,
      // and is answered in O(1): searching the stack for it made 20k of them after 20k openers quadratic.
      if (!openCount.get(tag.name)) continue;
      // Otherwise pop down to the innermost match. Each block is popped once, so this is linear overall.
      for (let b = open.pop(); b !== undefined; b = open.pop()) {
        openCount.set(b.name, openCount.get(b.name)! - 1);
        depth = b.outer;
        if (b.name === tag.name) break;
      }
    }
  }
  return out + at(source.slice(pos), depth);
}

/**
 * Rewrite `dataset.<old>` template paths, `item.<old>` keyed lookups and `dataset="<old>"` helper args in a
 * Handlebars `source`.
 * - The path match requires `dataset` to start at a non-identifier boundary (so `mydataset.x` is left
 *   alone) and the slug to END at a non-`[a-z0-9_-]` char (so `dataset.items` does NOT touch
 *   `dataset.items2` / `dataset.items_archive` / `dataset.items-archive`); a trailing `.` is fine.
 * - It ALSO matches the legacy segment-literal form `dataset.[<old>]` (the way a hyphenated slug had to
 *   be written before dataset slugs became underscore identifiers) and normalizes it to the plain
 *   `dataset.<new>` dotted path — so migrating a `faq-passengers` dataset to `faq_passengers` fixes both.
 * - `item.<old>` follows the same end-of-slug rule, only where it resolves to the namespace ({@link rewriteItemRefs}).
 * - The attr match preserves the original quote style.
 * Returns the source unchanged when there are no references.
 */
export function rewriteDatasetRefsInSource(source: string, oldSlug: string, newSlug: string): string {
  if (!source || oldSlug === newSlug) return source;
  const o = esc(oldSlug);
  const bracketRe = new RegExp(`(?<![A-Za-z0-9_])dataset\\.\\[${o}\\]`, 'g');
  const pathRe = new RegExp(`(?<![A-Za-z0-9_])dataset\\.${o}(?![A-Za-z0-9_-])`, 'g');
  const attrRe = new RegExp(`(\\bdataset=)(["'])${o}\\2`, 'g');
  const out = source
    .replace(bracketRe, `dataset.${newSlug}`)
    .replace(pathRe, `dataset.${newSlug}`)
    .replace(attrRe, `$1$2${newSlug}$2`);
  return out.includes('item.') ? rewriteItemRefs(out, oldSlug, newSlug) : out;
}

/** A replacement no slug can equal — {@link sourceReferencesDataset} asks "would the rewrite change anything?". */
const PROBE = '\u0000';

/** True if a Handlebars `source` references the dataset by slug — exactly when {@link rewriteDatasetRefsInSource}
 *  would change it (dotted path, legacy bracket path, keyed `item.` lookup, or picker arg). */
export function sourceReferencesDataset(source: string, slug: string): boolean {
  return !!source && rewriteDatasetRefsInSource(source, slug, PROBE) !== source;
}

// A static `{{> name}}` / `{{#> name}}` partial include — the same pattern the widget provisioning walks
// (`WIDGET_PARTIAL_REF` in @sitewright/core widgets.ts). Used via String.matchAll only.
const PARTIAL_REF = /\{\{~?\s*#?>\s*([a-zA-Z][a-zA-Z0-9_-]*)/g;

/** Every partial name these sources include, transitively through `partials` (the render's merged map). */
export function partialsReached(sources: Iterable<string | undefined>, partials: Readonly<Record<string, string>>): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [];
  const scan = (src: string | undefined): void => {
    if (!src) return;
    for (const m of src.matchAll(PARTIAL_REF)) {
      if (!seen.has(m[1]!)) {
        seen.add(m[1]!);
        queue.push(m[1]!);
      }
    }
  };
  for (const s of sources) scan(s);
  while (queue.length > 0) {
    const name = queue.shift()!;
    // eslint-disable-next-line security/detect-object-injection -- name is hasOwnProperty-checked
    if (Object.prototype.hasOwnProperty.call(partials, name)) scan(partials[name]);
  }
  return seen;
}

/** These sources plus the body of every partial they reach — everything that renders with them. */
export function withReachedPartials(sources: readonly string[], partials: Readonly<Record<string, string>>): string[] {
  const names = [...partialsReached(sources, partials)].filter((n) => Object.prototype.hasOwnProperty.call(partials, n));
  // eslint-disable-next-line security/detect-object-injection -- every n is hasOwnProperty-checked above
  const bodies = names.map((n) => partials[n]!);
  return [...sources, ...bodies];
}

/** A dataset field (possibly nested) — only the bits this rewrite touches. */
interface RefField {
  type?: string;
  config?: Record<string, unknown>;
  fields?: RefField[];
}

/**
 * Rewrite any `reference` field (at any nesting depth) whose target is the old slug → the new slug.
 * The target is `config.dataset` — the key the schema editor writes, the entry picker reads, and the agent
 * guide documents. `config.target` is rewritten too when it holds the old slug: nothing reads it, but this
 * cascade used to write it, so a row carrying it is kept consistent rather than left half-renamed.
 * Returns the new field tree + whether anything changed (immutable; untouched fields are reused).
 */
export function rewriteReferenceTargets<T extends RefField>(fields: readonly T[], oldSlug: string, newSlug: string): { fields: T[]; changed: boolean } {
  let changed = false;
  const walk = (fs: readonly RefField[]): RefField[] =>
    fs.map((f) => {
      let next: RefField = f;
      if (f.type === 'reference' && f.config && (f.config.dataset === oldSlug || f.config.target === oldSlug)) {
        next = {
          ...f,
          config: {
            ...f.config,
            ...(f.config.dataset === oldSlug ? { dataset: newSlug } : {}),
            ...(f.config.target === oldSlug ? { target: newSlug } : {}),
          },
        };
        changed = true;
      }
      if (Array.isArray(f.fields)) {
        const sub = walk(f.fields);
        if (sub.some((c, i) => c !== f.fields![i])) next = { ...next, fields: sub };
      }
      return next;
    });
  const out = walk(fields) as T[];
  return { fields: out, changed };
}

/** Where a `{{sw-control as="dataset"}}` stores the slug it picked: a dotted path in page.data or website.data. */
export interface DatasetControlTarget {
  store: 'page' | 'website';
  path: string;
}

// One `key=value` hash argument of a tag body. The key must start the body or follow whitespace, so
// `data-as=` / `data-target=` are their own keys, never `as=` / `target=`. Used via String.matchAll only.
const HASH_ARG = /(?:^|\s)([A-Za-z_][\w-]*)=(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g;

function hashArgs(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(HASH_ARG)) out.set(m[1]!, m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

/**
 * Every place a `{{sw-control as="dataset"}}` in these sources writes its value. Such a control is a
 * dropdown of the project's datasets, and what it stores IS a dataset slug — so a rename must repoint the
 * stored value too. (`as="dataset-item"` stores an entry id, which a rename does not change.)
 */
export function datasetControlTargets(sources: Iterable<string | undefined>): DatasetControlTarget[] {
  const out = new Map<string, DatasetControlTarget>();
  for (const src of sources) {
    if (!src) continue;
    for (const tag of scanTags(src)) {
      if (tag.kind !== 'other' || tag.name !== 'sw-control') continue;
      const args = hashArgs(tag.body);
      if (args.get('as') !== 'dataset') continue;
      const t = classifyControlTarget(args.get('target'));
      if (!t || t.kind === 'page') continue;
      const path = t.kind === 'data' && t.key.startsWith('page.data.') ? t.key.slice('page.data.'.length) : t.key;
      const store = t.kind === 'website' ? 'website' : 'page';
      out.set(`${store}:${path}`, { store, path });
    }
  }
  return [...out.values()];
}

const DANGEROUS_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Set the STRING leaf at a dotted `path` in a JSON object to `newSlug` when it currently equals `oldSlug`.
 * Immutable: returns a new object along the changed path, or the input itself when nothing changed.
 */
export function rewriteDataLeaf<T>(data: T, path: string, oldSlug: string, newSlug: string): { data: T; changed: boolean } {
  const segs = path.split('.');
  if (segs.some((s) => s === '' || DANGEROUS_SEGMENTS.has(s))) return { data, changed: false };
  const walk = (cur: unknown, i: number): unknown => {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return cur;
    // eslint-disable-next-line security/detect-object-injection -- i is a loop index into the split path
    const seg = segs[i]!;
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) return cur;
    const obj = cur as Record<string, unknown>;
    // eslint-disable-next-line security/detect-object-injection -- seg is proto-guarded + hasOwnProperty-checked
    const v = obj[seg];
    const next = i === segs.length - 1 ? (v === oldSlug ? newSlug : v) : walk(v, i + 1);
    return next === v ? cur : { ...obj, [seg]: next };
  };
  const out = walk(data, 0) as T;
  return { data: out, changed: out !== data };
}

/** The website chrome slots — Handlebars sources rendered around every page with the same `dataset` namespace. */
export const CHROME_SLOTS = ['mainNav', 'sidebarLeft', 'sidebarRight', 'footer', 'bottom'] as const;

/** The parts of `website` settings that can name a dataset. */
export interface WebsiteDatasetRefs {
  mainNav?: string;
  sidebarLeft?: string;
  sidebarRight?: string;
  footer?: string;
  bottom?: string;
  data?: unknown;
  dataFiles?: ReadonlyArray<{ dataset?: string } & Record<string, unknown>>;
}

/**
 * Rewrite every dataset reference in `website` settings: the chrome slot sources, each `dataFiles` entry's
 * `dataset`, and the website.data values a `{{sw-control as="dataset" target="website.data.…"}}` picked.
 */
export function rewriteWebsiteDatasetRefs<W extends WebsiteDatasetRefs>(
  website: W,
  oldSlug: string,
  newSlug: string,
  controlPaths: readonly string[],
): { website: W; changed: boolean } {
  let next: W = website;
  for (const slot of CHROME_SLOTS) {
    // eslint-disable-next-line security/detect-object-injection -- slot is one of the fixed CHROME_SLOTS names
    const src = website[slot];
    if (typeof src === 'string' && sourceReferencesDataset(src, oldSlug)) {
      next = { ...next, [slot]: rewriteDatasetRefsInSource(src, oldSlug, newSlug) };
    }
  }
  if (Array.isArray(website.dataFiles) && website.dataFiles.some((f) => f.dataset === oldSlug)) {
    next = { ...next, dataFiles: website.dataFiles.map((f) => (f.dataset === oldSlug ? { ...f, dataset: newSlug } : f)) };
  }
  for (const path of controlPaths) {
    const r = rewriteDataLeaf(next.data, path, oldSlug, newSlug);
    if (r.changed) next = { ...next, data: r.data };
  }
  return { website: next, changed: next !== website };
}

/** A dataset renamed alongside the one the author asked for — its per-language copy. */
export interface LocaleCopyRename {
  id: string;
  locale: string;
  oldSlug: string;
  newSlug: string;
}

/**
 * The per-language copies that must be renamed WITH `oldSlug`. A page in locale `de` reads `dataset.<slug>`
 * as `<slug>_de` when that dataset exists (`resolveLocaleDatasets`), so the copy is bound to its base by
 * NAME: renaming `team` to `staff` while `team_de` stays put makes every German page silently show the main
 * language. Only the project's configured locales count — a `<slug>_<x>` for a language the site does not
 * have is just another dataset.
 */
export function localeCopyRenames(
  datasets: ReadonlyArray<{ id: string; slug: string }>,
  locales: readonly string[],
  oldSlug: string,
  newSlug: string,
): LocaleCopyRename[] {
  const out = new Map<string, LocaleCopyRename>();
  for (const locale of locales) {
    const from = localizedDatasetName(oldSlug, locale);
    const copy = datasets.find((d) => d.slug === from);
    if (copy && !out.has(copy.id)) out.set(copy.id, { id: copy.id, locale, oldSlug: from, newSlug: localizedDatasetName(newSlug, locale) });
  }
  return [...out.values()];
}

// The suffix a language copy carries — what `localizedDatasetName` makes of a locale code (`de`, `pt_br`,
// `zh_hant`, `es_419`). Only used to REPORT `<slug>_<x>` datasets left on the old name, so a false positive
// (a `team_old`) costs one extra line in the result, never a change.
// Linear: every repetition starts with a literal "_", and it only ever runs on a dataset slug (≤ 64 chars).
const LOCALE_SUFFIX = /^[a-z]{2,3}(?:_(?:[a-z]{4}|[a-z]{2}|[0-9]{3}))*$/; // eslint-disable-line security/detect-unsafe-regex

/** The datasets named like a language copy of `slug` (`<slug>_<locale>`), whatever languages the site has. */
export function namedLikeLocaleCopies(datasets: ReadonlyArray<{ slug: string }>, slug: string): string[] {
  const prefix = `${slug}_`;
  return datasets.filter((d) => d.slug.startsWith(prefix) && LOCALE_SUFFIX.test(d.slug.slice(prefix.length))).map((d) => d.slug);
}

/** One place that renders a source — a page, a template, a snippet, a chrome slot — labelled for a message. */
export interface LabelledSource {
  label: string;
  source: string;
}

/**
 * The platform WIDGETS that read `slug` by name — their own dataset, or its copy for one of `locales` (a
 * page in that language reads `dataset.hero` as `hero_de`) — and where on the site each one is composed
 * (directly or through a snippet). A widget's body is platform code bound to a fixed dataset slug
 * (`dataset.hero`), so a rename cannot repoint it — it can only break it.
 */
export function widgetUsages(
  rows: readonly LabelledSource[],
  partials: Readonly<Record<string, string>>,
  slug: string,
  locales: readonly string[],
): Array<{ widget: string; usedBy: string[] }> {
  const out: Array<{ widget: string; usedBy: string[] }> = [];
  for (const w of GLOBAL_WIDGETS) {
    const reads = w.provides.datasets.some((d) => d.slug === slug || locales.some((l) => localizedDatasetName(d.slug, l) === slug));
    if (!reads) continue;
    const usedBy = rows.filter((r) => partialsReached([r.source], partials).has(w.name)).map((r) => r.label);
    if (usedBy.length > 0) out.push({ widget: w.name, usedBy });
  }
  return out;
}
