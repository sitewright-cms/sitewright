// {{sw-control}} support: the content-editor-only control directive. A control sets a whitelisted PAGE
// attribute (title, SEO description / OG image), a per-page page.data value, OR a GLOBAL website.data
// value — from inside the live preview — shown ONLY in content mode (wired by the preview bridge) and
// STRIPPED on publish (directives.ts).
//
// This module is PURE (no Handlebars / DOM) so the editor can reuse `classifyControlTarget` for the
// same allow-list validation via the `@sitewright/blocks/control` subpath without pulling the renderer.
import type { RenderMedia } from './folder.js';

export type ControlAs =
  | 'text'
  | 'textarea'
  | 'url'
  | 'number'
  | 'color'
  | 'date'
  | 'image'
  | 'file'
  | 'select'
  | 'folder'
  | 'dataset'
  | 'dataset-item';

/** The full, ordered set of valid `as` values — exported so the helper can list them in its error. */
export const CONTROL_AS_VALUES = [
  'text',
  'textarea',
  'url',
  'number',
  'color',
  'date',
  'image',
  'file',
  'select',
  'folder',
  'dataset',
  'dataset-item',
] as const satisfies readonly ControlAs[];

const CONTROL_AS = new Set<ControlAs>(CONTROL_AS_VALUES);

/** Strict membership test — the {{sw-control}} helper uses it to FAIL LOUDLY on an unknown `as`. */
export function isControlAs(as: unknown): as is ControlAs {
  return typeof as === 'string' && CONTROL_AS.has(as as ControlAs);
}

/**
 * Lenient coercion of `as` to a known control type, defaulting unknown/missing → 'text'. Used on the
 * EDITOR's inbound postMessage path (the value there already came from a rendered chip) to keep the
 * URL-sanitize gate symmetric — NOT for authoring validation, where the helper throws instead.
 */
export function normalizeControlAs(as: unknown): ControlAs {
  return isControlAs(as) ? as : 'text';
}

/** Max author-provided as="select" options + per-option length — bounds the chip's attribute size. */
const MAX_SELECT_OPTIONS = 100;
const MAX_OPTION_LEN = 200;

/**
 * Parse an as="select" `options="a, b, c"` list into a clean array (trimmed, empties dropped, deduped,
 * capped). Returns [] when nothing usable was given — the helper treats an empty result as an authoring
 * error (a select with no options is useless), mirroring the fail-loud stance on an unknown `as`.
 */
export function parseSelectOptions(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const v = part.trim().slice(0, MAX_OPTION_LEN);
    if (v === '' || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= MAX_SELECT_OPTIONS) break;
  }
  return out;
}

export type PageField = 'title' | 'description' | 'image';
export type ControlTarget =
  | { kind: 'page'; field: PageField }
  | { kind: 'data'; key: string }
  // A GLOBAL value in `website.data` — `key` is the path WITHIN website.data (e.g. `footerImage` for
  // target="website.data.footerImage"). Edited site-wide (every page), unlike the per-page `data` kind.
  | { kind: 'website'; key: string };

const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Validate + classify a control target against the ALLOW-LIST. Returns null for anything a control may
 * not set. Settable: the page fields `page.title` / `page.description` / `page.image`; a per-page
 * `page.data` value — a NESTED `page.data.<path>` OR a BARE single-segment key (defaults to a top-level
 * page.data property); or a GLOBAL `website.data.<path>`. Other page fields (path/status/template/…) are
 * NOT settable. (A bare `data.<path>` is NO LONGER accepted — use `page.data.<path>` for clarity, since
 * `{{data.*}}` is the separate datasets namespace.)
 */
export function classifyControlTarget(target: unknown): ControlTarget | null {
  if (typeof target !== 'string' || target === '') return null;
  if (target === 'page.title') return { kind: 'page', field: 'title' };
  if (target === 'page.description') return { kind: 'page', field: 'description' };
  if (target === 'page.image') return { kind: 'page', field: 'image' };
  // PER-PAGE store: a NESTED `page.data.<path>` (checked BEFORE the page.* rejection below). `key` keeps
  // the full target — the directive/editor (resolveOverride / pageDataSet) strip the `page.data.` prefix.
  if (target.startsWith('page.data.')) {
    const path = target.slice('page.data.'.length);
    if (path === '' || path.split('.').some((s) => s === '' || DANGEROUS.has(s))) return null;
    return { kind: 'data', key: target };
  }
  // GLOBAL store: only `website.data.<path>` is settable from a control (other website.* fields are
  // structured settings, not free-form data). `key` is the path WITHIN website.data, proto-guarded.
  if (target.startsWith('website.')) {
    const m = /^website\.data\.(.+)$/.exec(target);
    if (!m) return null;
    const key = m[1]!;
    if (key === '' || key.split('.').some((s) => s === '' || DANGEROUS.has(s))) return null;
    return { kind: 'website', key };
  }
  // Reserve the page. namespace for the explicit whitelist above — any OTHER page field is rejected
  // (a non-settable field like page.path/canonical/noindex must not silently become an odd page.data
  // leaf). Also reject the RETIRED `seo.` namespace (use page.description / page.image).
  if (target.startsWith('page.') || target.startsWith('seo.')) return null;
  // A BARE single-segment key → a top-level page.data property. Any other dotted key (e.g. the retired
  // `data.<path>` shorthand) is rejected — write `page.data.<path>` instead.
  if (target.includes('.')) return null;
  if (DANGEROUS.has(target)) return null;
  return { kind: 'data', key: target };
}

interface ControlRoot {
  page?: { title?: unknown; description?: unknown; image?: unknown; data?: unknown };
  website?: { data?: unknown };
  data?: unknown;
  media?: readonly RenderMedia[];
}

/** Walk a JSON object to the STRING leaf at a dotted `path` (own-property + proto-guarded). */
function readDataLeaf(data: unknown, path: string): string {
  let cur: unknown = data;
  for (const seg of path.split('.')) {
    if (
      seg === '' ||
      DANGEROUS.has(seg) ||
      cur === null ||
      typeof cur !== 'object' ||
      !Object.prototype.hasOwnProperty.call(cur, seg)
    ) {
      return '';
    }
    // eslint-disable-next-line security/detect-object-injection -- seg is proto-guarded + hasOwnProperty-checked
    cur = (cur as Record<string, unknown>)[seg];
  }
  return typeof cur === 'string' ? cur : '';
}

/** The control's CURRENT value — shown in the chip and used to seed its popover. */
export function controlCurrentValue(t: ControlTarget, root: ControlRoot): string {
  if (t.kind === 'page') {
    // `t.field` is a fixed union ('title'|'description'|'image'), not attacker-controlled.
    const v = root.page?.[t.field];
    return typeof v === 'string' ? v : '';
  }
  // website: `t.key` is already the path WITHIN website.data. page.data: a bare key or `page.data.<path>`.
  if (t.kind === 'website') return readDataLeaf(root.website?.data, t.key);
  return readDataLeaf(root.page?.data, t.key.startsWith('page.data.') ? t.key.slice('page.data.'.length) : t.key);
}

/** Dropdown options for as="folder" (media folder paths), as="dataset" (dataset names), and
 *  as="dataset-item" (the ENTRY IDS of `arg`'s dataset — the value a dataset-item control stores,
 *  picking which entry a Widget like the hero slider renders). Entry order is preserved (NOT sorted)
 *  so the list matches the dataset panel. */
export function controlOptions(as: ControlAs, root: ControlRoot, arg?: string): string[] {
  if (as === 'folder') {
    const media = Array.isArray(root.media) ? root.media : [];
    const set = new Set<string>();
    for (const m of media) if (m.folder) set.add(m.folder);
    return [...set].sort();
  }
  if (as === 'dataset') {
    const data = root.data;
    return data && typeof data === 'object' ? Object.keys(data).filter((k) => !DANGEROUS.has(k)).sort() : [];
  }
  if (as === 'dataset-item') {
    const slug = typeof arg === 'string' ? arg : '';
    const data = root.data;
    if (!slug || DANGEROUS.has(slug) || !data || typeof data !== 'object' || !Object.prototype.hasOwnProperty.call(data, slug)) return [];
    // eslint-disable-next-line security/detect-object-injection -- slug is proto-guarded + hasOwnProperty-checked
    const entries = (data as Record<string, unknown>)[slug];
    if (!Array.isArray(entries)) return [];
    return entries
      .map((e) => (e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string' ? (e as { id: string }).id : ''))
      .filter((id) => id && !DANGEROUS.has(id));
  }
  return [];
}
