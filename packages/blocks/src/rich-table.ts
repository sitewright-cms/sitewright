// Shared, framework-agnostic vocabulary for TABLE editing in the two rich-text toolbars: the dataset
// `richtext` field editor (apps/editor, React) and the on-page `data-sw-html` floating toolbar
// (preview-bridge, vanilla JS injected into the sandboxed preview). Same split as rich-toolbar.ts —
// the OPERATION MANIFEST and the pure size math live here so both surfaces offer the identical menu;
// the Selection/Range and drag wrangling stays per-surface (the bridge cannot import at runtime).
//
// EMISSION MODEL: structure is semantic HTML (`<table>/<thead>/<tbody>/<tr>/<th>/<td>` + colspan/rowspan),
// which the sanitizer already allows. SIZES are the one thing a class cannot express — an author drags a
// column to an arbitrary width — so they are emitted as an inline `width`/`height` declaration, gated to
// a bounded px/% value by `sanitize-rich`'s allowedStyles (table elements only). See RICH_TABLE_SIZE_RE.

/** One entry in the table dropdown. `null` in the manifest is a visual separator. */
export interface RichTableOp {
  readonly id: string;
  readonly label: string;
  /** Destructive ops render in the danger colour and sort last. */
  readonly danger?: boolean;
}

/**
 * The complete, ordered table-operations menu, shown when the caret sits inside a table. Both toolbars
 * render from this list so the two menus never drift. Ids are the contract each surface switches on.
 */
export const RICH_TABLE_OPS: ReadonlyArray<RichTableOp | null> = [
  { id: 'row-above', label: 'Insert row above' },
  { id: 'row-below', label: 'Insert row below' },
  { id: 'col-left', label: 'Insert column left' },
  { id: 'col-right', label: 'Insert column right' },
  null,
  { id: 'row-delete', label: 'Delete row', danger: true },
  { id: 'col-delete', label: 'Delete column', danger: true },
  null,
  { id: 'header-row', label: 'Toggle header row' },
  { id: 'merge-cells', label: 'Merge cells' },
  { id: 'split-cell', label: 'Split cell' },
  null,
  { id: 'reset-sizes', label: 'Reset sizes' },
  { id: 'table-delete', label: 'Delete table', danger: true },
];

/** The op ids, for a cheap membership check on the surface side. */
export const RICH_TABLE_OP_IDS: ReadonlySet<string> = new Set(
  RICH_TABLE_OPS.filter((o): o is RichTableOp => o !== null).map((o) => o.id),
);

// --- Size math (drag-to-resize) ---------------------------------------------------------------

/** Smallest column width a drag may produce, in px — below this a column's text becomes unreadable
 *  and the grab handle overlaps its neighbour's. */
export const RICH_TABLE_MIN_COL = 32;
/** Smallest row height a drag may produce, in px. */
export const RICH_TABLE_MIN_ROW = 20;
/** Upper bound for any dragged dimension, in px — the same ceiling the image resizer uses. */
export const RICH_TABLE_MAX = 4000;
/** How close (px) to a column/row edge the pointer must be for the resize handle to arm. */
export const RICH_TABLE_GRIP = 5;

/** The bounded `width`/`height` values the sanitizer lets through on a table element: an integer (or one
 *  decimal place) number of px, or a percentage. No `calc()`, no `var()`, no url() — nothing that can
 *  reference anything outside the declaration. Kept HERE so the emitter and the sanitizer agree by
 *  construction; `sanitize-rich` imports it for its allowedStyles gate. */
export const RICH_TABLE_SIZE_RE = /^(?:\d{1,4}(?:\.\d{1,3})?px|(?:100|\d{1,2}(?:\.\d{1,3})?)%)$/;

/** Clamp a dragged px dimension to [min, RICH_TABLE_MAX] and round it. Returns null for a non-finite
 *  input, which callers treat as "leave the size alone". Pure. */
export function clampTableDim(px: number, min: number): number | null {
  if (!Number.isFinite(px)) return null;
  return Math.round(Math.min(RICH_TABLE_MAX, Math.max(min, px)));
}

/**
 * Set (or, with `value` null, REMOVE) one declaration in an inline `style` attribute value, leaving every
 * other declaration untouched and in order. Returns the new attribute value — `''` when nothing is left,
 * so the caller can drop the attribute entirely. Pure; no DOM.
 *
 * Written by hand rather than through `el.style` because BOTH surfaces need the identical normalization
 * and the editor's own round-trip has to survive `sanitizeRichHtml` unchanged (an idempotent no-op is what
 * keeps re-opening a field from rewriting its stored value).
 */
export function setStyleDecl(
  styleAttr: string | null | undefined,
  prop: string,
  value: string | null,
): string {
  const kept: string[] = [];
  for (const decl of (styleAttr ?? '').split(';')) {
    const trimmed = decl.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) continue; // malformed fragment — drop it rather than re-emit garbage
    if (trimmed.slice(0, colon).trim().toLowerCase() === prop) continue; // replaced below
    kept.push(`${trimmed.slice(0, colon).trim()}: ${trimmed.slice(colon + 1).trim()}`);
  }
  if (value) kept.push(`${prop}: ${value}`);
  return kept.join('; ');
}

/** Read one declaration's value out of an inline `style` attribute (lower-cased property match), or ''. */
export function getStyleDecl(styleAttr: string | null | undefined, prop: string): string {
  for (const decl of (styleAttr ?? '').split(';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    if (decl.slice(0, colon).trim().toLowerCase() === prop) return decl.slice(colon + 1).trim();
  }
  return '';
}

/** The starter table both toolbars insert: a header row + two body rows, sized by the browser until the
 *  author drags a column. `<p><br></p>` after it is the escape hatch — without a trailing block there is
 *  no caret position AFTER a table that ends the content, and the author cannot type past it. */
export const RICH_TABLE_STARTER =
  '<table><thead><tr><th>Heading</th><th>Heading</th></tr></thead>' +
  '<tbody><tr><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td></tr></tbody></table><p><br></p>';
