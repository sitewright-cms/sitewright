// {{sw-control}} support: the content-editor-only control directive. A control sets a whitelisted PAGE
// attribute (title, SEO description / OG image) or a page.data value from inside the live preview —
// shown ONLY in content mode (wired by the preview bridge) and STRIPPED on publish (directives.ts).
//
// This module is PURE (no Handlebars / DOM) so the editor can reuse `classifyControlTarget` for the
// same allow-list validation via the `@sitewright/blocks/control` subpath without pulling the renderer.
import type { RenderMedia } from './folder.js';

export type ControlAs = 'text' | 'textarea' | 'url' | 'image' | 'file' | 'folder' | 'dataset';

const CONTROL_AS = new Set<ControlAs>(['text', 'textarea', 'url', 'image', 'file', 'folder', 'dataset']);
export function normalizeControlAs(as: unknown): ControlAs {
  return typeof as === 'string' && CONTROL_AS.has(as as ControlAs) ? (as as ControlAs) : 'text';
}

export type PageField = 'title' | 'description' | 'image';
export type ControlTarget = { kind: 'page'; field: PageField } | { kind: 'data'; key: string };

const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Validate + classify a control target against the ALLOW-LIST. Returns null for anything a control may
 * not set. Settable: the page fields `page.title` / `page.description` / `page.image`, or a `page.data`
 * key/path (bare key or `data.<path>`, proto-guarded). Other page fields (path/status/template/canonical/
 * noindex/…) are intentionally NOT settable from a content control.
 */
export function classifyControlTarget(target: unknown): ControlTarget | null {
  if (typeof target !== 'string' || target === '') return null;
  if (target === 'page.title') return { kind: 'page', field: 'title' };
  if (target === 'page.description') return { kind: 'page', field: 'description' };
  if (target === 'page.image') return { kind: 'page', field: 'image' };
  // Reserve the page. namespace for the explicit whitelist above — any OTHER page field is rejected
  // (a non-settable field like page.path/canonical/noindex must not silently become an odd page.data
  // leaf). Also reject the RETIRED `seo.` namespace (its fields were flattened onto the page — use
  // page.description / page.image) so a stale `target="seo.ogImage"` fails loudly instead of silently
  // creating a junk `page.data.seo.*` leaf.
  if (target.startsWith('page.') || target.startsWith('seo.')) return null;
  const path = target.startsWith('data.') ? target.slice(5) : target;
  if (path === '' || path.split('.').some((s) => s === '' || DANGEROUS.has(s))) return null;
  return { kind: 'data', key: target };
}

interface ControlRoot {
  page?: { title?: unknown; description?: unknown; image?: unknown; data?: unknown };
  data?: unknown;
  media?: readonly RenderMedia[];
}

function readDataLeaf(data: unknown, key: string): string {
  const path = key.startsWith('data.') ? key.slice(5) : key;
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
  return readDataLeaf(root.page?.data, t.key);
}

/** Dropdown options for as="folder" (media folder paths) / as="dataset" (dataset names). */
export function controlOptions(as: ControlAs, root: ControlRoot): string[] {
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
  return [];
}
