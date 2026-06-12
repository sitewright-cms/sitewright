/** The kind of editable region, which drives the editor widget + the binding's render sink. */
export type RegionKind = 'text' | 'rich' | 'link' | 'image' | 'bg';

/** A client-editable region declared by a `data-sw-*` leaf directive. */
export interface EditableRegion {
  key: string;
  /** The authored default content/inner text, shown until a client overrides it (in `page.data`). */
  default: string;
  kind: RegionKind;
}

// A `data-sw-text`/`data-sw-html` leaf directive WITH its authored default inner content:
// `<tag … data-sw-(text|html)="key" …>DEFAULT</tag>`. Group 1: tag (back-referenced to find the
// close); 2: kind; 3|4: key; 5: inner default. Best-effort — `[^>]` stops at the first `>` so an
// attribute value containing `>` (rare) just yields no match, and nested SAME-tag content may
// truncate the captured default (the render is still correct; only the editor's seed is affected).
const ELEMENT_DIRECTIVE_RE =
  /<([a-zA-Z][\w-]*)\b[^>]*?\bdata-sw-(text|html)\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/\1>/g;
// URL-valued directives — key only (the editable value is a URL: a link href, an image src, or a
// background-image). Captured per attribute so the side panel can offer the right widget.
const HREF_DIRECTIVE_RE = /\bdata-sw-href\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const SRC_DIRECTIVE_RE = /\bdata-sw-src\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const BG_DIRECTIVE_RE = /\bdata-sw-bg\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * All client-editable regions declared in a code-first source — the `data-sw-text`/`data-sw-html`/
 * `data-sw-href`/`data-sw-src`/`data-sw-bg` leaf directives — deduped by key (first occurrence wins),
 * each tagged with its {@link RegionKind} so the editor can pick the right widget and seed its default.
 * Only the page's OWN source is scanned (regions inside an included `{{> partial}}` render but aren't
 * surfaced as fields). Editable singletons should live OUTSIDE loops — a directive key repeated by
 * `{{#each}}` collapses to one field.
 */
export function extractRegions(source: string): EditableRegion[] {
  const out: EditableRegion[] = [];
  const seen = new Set<string>();
  const add = (key: string, def: string, kind: RegionKind): void => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ key, default: def, kind });
  };
  for (const m of source.matchAll(ELEMENT_DIRECTIVE_RE)) {
    const kind: RegionKind = m[2] === 'html' ? 'rich' : 'text';
    add(m[3] ?? m[4] ?? '', (m[5] ?? '').trim(), kind);
  }
  for (const m of source.matchAll(HREF_DIRECTIVE_RE)) add(m[1] ?? m[2] ?? '', '', 'link');
  for (const m of source.matchAll(SRC_DIRECTIVE_RE)) add(m[1] ?? m[2] ?? '', '', 'image');
  for (const m of source.matchAll(BG_DIRECTIVE_RE)) add(m[1] ?? m[2] ?? '', '', 'bg');
  return out;
}

// `page.children` not preceded by an identifier/`.`/`-` (so `my-page.children` / `xpage.children`
// don't match) — the cheap gate that keeps the (potentially large, child-`data`-carrying) children
// array off the render-worker JSON-IPC channel unless the source actually references it. Mirrors
// `ITEM_REF_RE` in bindings.ts.
const CHILDREN_REF_RE = /(?<![\w.-])page\.children/;

/** Whether a template source references `page.children` — build the children array only when it does. */
export function referencesChildren(source: string): boolean {
  return CHILDREN_REF_RE.test(source);
}

// `parentPage` not preceded by an identifier/`.`/`-` and not part of a longer word (so `parentPageView`
// / `myparentPage` don't match) — the same cheap gate as `CHILDREN_REF_RE`, so the parent view (which
// carries the parent's own `data`) is built and serialized over the render IPC only when used.
const PARENT_PAGE_REF_RE = /(?<![\w.-])parentPage(?![\w-])/;

/** Whether a template source references the top-level `parentPage` binding — build the parent view only when it does. */
export function referencesParentPage(source: string): boolean {
  return PARENT_PAGE_REF_RE.test(source);
}

/** Upper bound on distinct class tokens extracted from one HTML/source string. */
export const MAX_EXTRACTED_CLASS_TOKENS = 2048;

/**
 * Extract the literal CSS class tokens from `class="…"` / `class='…'` attributes in an HTML
 * string or a Handlebars template source — the Tailwind JIT compiler's candidate set for
 * code-first pages. Used by both the publish build and the editor's live-preview endpoint, so the
 * extraction stays identical across the two paths.
 *
 * Handlebars `{{ … }}` expressions inside a class value are stripped first — a dynamic class
 * value can't be precompiled, so it must not leak a half-token into the candidate set. The
 * result is deduplicated and capped at `max` tokens: a rendered body can be up to ~1 MiB of
 * attacker-authored markup, and an uncapped synthetic class list would let an owner/admin
 * spike Tailwind's compiler. Real pages use far fewer than the cap.
 */
export function extractClassNames(html: string, max: number = MAX_EXTRACTED_CLASS_TOKENS): string[] {
  const re = /class\s*=\s*"([^"]*)"|class\s*=\s*'([^']*)'/g;
  const tokens = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const value = (m[1] ?? m[2] ?? '').replace(/\{\{[^}]*\}\}/g, ' ');
    for (const token of value.split(/\s+/)) {
      if (!token) continue;
      tokens.add(token);
      if (tokens.size >= max) return [...tokens];
    }
  }
  return [...tokens];
}
