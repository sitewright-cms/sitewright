// Renders a nav-placeholder's rich NAME (basic HTML + {{sw-icon}}/{{sw-flag}}) to SAFE preview HTML
// for the Pages list — the icon/flag + text, the way it renders in the menu.
//
// STATIC named imports (NOT the engine's `renderTemplate`): vite tree-shakes these to just the
// icon/flag data subgraph — the same browser-safe path the Library icon gallery (catalog-icons.ts)
// uses. This module is itself loaded via a DYNAMIC import (see PlaceholderLabel), so that large data
// stays out of the editor's main bundle and is shared with the gallery's chunk.
//
// We deliberately do NOT call `renderTemplate` here: it pulls htmlparser2 / sanitize-html (Node-only)
// and breaks in the browser bundle. Instead we render the {{sw-icon}}/{{sw-flag}} tokens directly,
// mirroring the sw-icon / sw-flag helpers in @sitewright/blocks (template.ts).
import { iconBody, brandIcon, flagIcon } from '@sitewright/blocks';

const ICON_RE = /\{\{\s*sw-(icon|flag)\s+"([^"]*)"(?:\s+"([^"]*)")?\s*\}\}/g;
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ESC[c]!);
/** Drop any handlebars helper (incl. `{{{…}}}`) — no stray brace left. */
const stripMustache = (s: string): string => s.replace(/\{\{\{?[^}]*\}\}\}?/g, ' ');

/** One {{sw-icon}} token → inline SVG, matching the helper (bare = Lucide stroke, `brand:` = fill). */
function iconSvg(name: string, cls: string): string {
  const klass = esc(cls || 'h-5 w-5');
  if (name.startsWith('brand:')) {
    const b = brandIcon(name.slice('brand:'.length));
    if (!b) return '';
    return `<svg class="${klass}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${esc(b.path)}"/></svg>`;
  }
  const body = iconBody(name);
  if (body === undefined) return '';
  return `<svg class="${klass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** One {{sw-flag}} token → full-color flag SVG, matching the helper (`-circle` = round variant). */
function flagSvg(code: string, cls: string): string {
  const isCircle = code.endsWith('-circle');
  const f = flagIcon(isCircle ? code.slice(0, -'-circle'.length) : code);
  const shape = f && (isCircle ? f.circle : f.rect);
  if (!f || !shape) return '';
  const klass = esc(cls || (isCircle ? 'h-5 w-5' : 'h-4'));
  return `<svg class="${klass}" viewBox="${esc(shape.viewBox)}" role="img" aria-label="${esc(f.name)}"><title>${esc(f.name)}</title>${shape.body}</svg>`;
}

/**
 * Build SAFE preview HTML from a placeholder name: drop the authored HTML wrapper, render
 * `{{sw-icon}}`/`{{sw-flag}}` tokens to inline SVG from the trusted icon maps, and escape the
 * remaining text (other mustaches stripped). The only non-escaped HTML is the icon SVG built from
 * first-party data (no reflected user markup), so the result is XSS-safe.
 */
export function renderPlaceholderHtml(name: string): string {
  const noTags = name.replace(/<[^>]*>/g, ''); // strip the authored wrapper (span/b/…) → text + tokens
  const textSeg = (s: string): string => esc(stripMustache(s).replace(/\s+/g, ' ').trim());
  let out = '';
  let last = 0;
  ICON_RE.lastIndex = 0;
  for (let m = ICON_RE.exec(noTags); m; m = ICON_RE.exec(noTags)) {
    out += textSeg(noTags.slice(last, m.index));
    out += m[1] === 'flag' ? flagSvg(m[2] ?? '', m[3] ?? '') : iconSvg(m[2] ?? '', m[3] ?? '');
    last = ICON_RE.lastIndex;
  }
  out += textSeg(noTags.slice(last));
  return out;
}
