// Shared, framework-agnostic vocabulary for the two rich-text toolbars: the dataset `richtext`
// field editor (apps/editor, React) and the on-page `data-sw-html` floating toolbar (preview-bridge,
// vanilla JS injected into the sandboxed preview). Keeping the command set, class palettes, and the
// class-toggle math in ONE place is what keeps the two surfaces consistent (the user's requirement).
//
// EMISSION MODEL: the toolbar emits EXISTING Tailwind utility classes (`text-center`, `text-red-600`,
// `text-lg`, `pl-8`) — never inline styles — so authored rich content stays consistent with the rest of
// the codebase and needs no new sanitizer style-allowlist (the `class` attribute is already allowed by
// sanitize-rich). Text marks (bold/italic/…) and blocks (h2/h3/quote/lists/hr/links/tables) stay
// SEMANTIC HTML (`<strong>`, `<h2>`, …) — clean markup the site's typography/normalize CSS already styles.
//
// PUBLISH SAFELIST: these palette classes reach author content that the publish SOURCE scan can't see
// (page.data region overrides + dataset richtext entries). `RICH_CONTENT_SAFELIST` is the bounded set the
// build feeds into the Tailwind candidate list for content that actually uses them — see publish/build.ts.

/** A choice in a palette control: a human label + the single Tailwind class it applies (`''` = clear), plus an
 *  optional literal preview colour so a swatch dot renders WITHOUT relying on the class being compiled in the
 *  surface's stylesheet (the editor SPA canvas / the swatch grid itself have no site utility sheet). */
export interface RichSwatch {
  readonly label: string;
  readonly cls: string;
  readonly value?: string;
}

// --- Palettes (RAW Tailwind palette classes — always available from `tailwindcss/utilities.css`, with NO
//     daisyUI coupling: daisyUI's semantic colors ship only when a daisy class is used, so `text-primary`
//     would be fragile in author content, whereas `text-red-600` always compiles). Author-picked accent
//     colours are meant to be literal, not theme-remapped, so raw palette is also the right semantics. ---

// Preview values are the literal Tailwind default palette hexes for each class — only for the swatch DOT; the
// applied CLASS is what styles the content (theme-independent, author-chosen accent colours).
/** Text colour swatches. `''` clears any colour (back to the inherited body colour). */
export const RICH_COLORS: readonly RichSwatch[] = [
  { label: 'Default', cls: '' },
  { label: 'Slate', cls: 'text-slate-500', value: '#64748b' },
  { label: 'Red', cls: 'text-red-600', value: '#dc2626' },
  { label: 'Orange', cls: 'text-orange-600', value: '#ea580c' },
  { label: 'Amber', cls: 'text-amber-500', value: '#f59e0b' },
  { label: 'Green', cls: 'text-green-600', value: '#16a34a' },
  { label: 'Teal', cls: 'text-teal-600', value: '#0d9488' },
  { label: 'Blue', cls: 'text-blue-600', value: '#2563eb' },
  { label: 'Indigo', cls: 'text-indigo-600', value: '#4f46e5' },
  { label: 'Purple', cls: 'text-purple-600', value: '#9333ea' },
  { label: 'Pink', cls: 'text-pink-600', value: '#db2777' },
];

/** Highlight (background) swatches. `''` clears the highlight. */
export const RICH_HIGHLIGHTS: readonly RichSwatch[] = [
  { label: 'None', cls: '' },
  { label: 'Yellow', cls: 'bg-yellow-200', value: '#fef08a' },
  { label: 'Green', cls: 'bg-green-200', value: '#bbf7d0' },
  { label: 'Blue', cls: 'bg-blue-200', value: '#bfdbfe' },
  { label: 'Pink', cls: 'bg-pink-200', value: '#fbcfe8' },
  { label: 'Purple', cls: 'bg-purple-200', value: '#e9d5ff' },
  { label: 'Orange', cls: 'bg-orange-200', value: '#fed7aa' },
  { label: 'Slate', cls: 'bg-slate-200', value: '#e2e8f0' },
];

/** Text-size swatches. `''` is the normal/base size (clears any size class). */
export const RICH_SIZES: readonly RichSwatch[] = [
  { label: 'Small', cls: 'text-sm' },
  { label: 'Normal', cls: '' },
  { label: 'Large', cls: 'text-lg' },
  { label: 'Extra large', cls: 'text-xl' },
  { label: 'Huge', cls: 'text-2xl' },
];

/** Block text-alignment swatches (applied to the enclosing block, not a span). */
export const RICH_ALIGNS: readonly RichSwatch[] = [
  { label: 'Left', cls: 'text-left' },
  { label: 'Center', cls: 'text-center' },
  { label: 'Right', cls: 'text-right' },
  { label: 'Justify', cls: 'text-justify' },
];

/** Ordered indent steps (left padding on the enclosing block). Index 0 = no indent. */
export const RICH_INDENT_STEPS: readonly string[] = ['', 'pl-4', 'pl-8', 'pl-12', 'pl-16'];

// --- Group class-sets: the mutually-exclusive class members of each control. Applying one member first
//     removes any other member of the same group (so colours/sizes/aligns replace, never stack). Explicit
//     sets — NOT a `text-` prefix match — because `text-red-600` (colour), `text-lg` (size) and
//     `text-center` (align) share the `text-` prefix but belong to different, independent groups. ---
const swatchClasses = (sw: readonly RichSwatch[]): readonly string[] =>
  sw.map((s) => s.cls).filter((c) => c !== '');

export const RICH_COLOR_CLASSES: ReadonlySet<string> = new Set(swatchClasses(RICH_COLORS));
export const RICH_HIGHLIGHT_CLASSES: ReadonlySet<string> = new Set(swatchClasses(RICH_HIGHLIGHTS));
export const RICH_SIZE_CLASSES: ReadonlySet<string> = new Set(swatchClasses(RICH_SIZES));
export const RICH_ALIGN_CLASSES: ReadonlySet<string> = new Set(RICH_ALIGNS.map((s) => s.cls));
export const RICH_INDENT_CLASSES: ReadonlySet<string> = new Set(
  RICH_INDENT_STEPS.filter((c) => c !== ''),
);

/**
 * The complete, bounded set of Tailwind classes the toolbars can emit into author content. The publish
 * build feeds the subset that a project's stored rich content actually uses into the Tailwind candidate
 * list (content the source scan never sees), so these compile into the published sheet. See build.ts.
 */
export const RICH_CONTENT_SAFELIST: readonly string[] = [
  ...RICH_COLOR_CLASSES,
  ...RICH_HIGHLIGHT_CLASSES,
  ...RICH_SIZE_CLASSES,
  ...RICH_ALIGN_CLASSES,
  ...RICH_INDENT_CLASSES,
];

const RICH_CONTENT_SAFELIST_SET: ReadonlySet<string> = new Set(RICH_CONTENT_SAFELIST);

/** True when `cls` is one of the toolbar's emittable palette classes. */
export function isRichContentClass(cls: string): boolean {
  return RICH_CONTENT_SAFELIST_SET.has(cls);
}

// --- Pure class-list math (shared by BOTH toolbars; the DOM Range→element wrangling stays per-surface). ---

/** Split a `class="…"` attribute value into a deduped, order-preserving token list. */
function tokenize(classAttr: string | null | undefined): string[] {
  const out: string[] = [];
  for (const t of (classAttr ?? '').split(/\s+/)) {
    if (t && out.indexOf(t) < 0) out.push(t);
  }
  return out;
}

/**
 * Replace whatever member of `group` is present on `classAttr` with `add` (or remove it entirely when
 * `add` is `''`/undefined). Returns the normalized class string. Pure — no DOM. Used to toggle a colour/
 * size/highlight/alignment class on an element without letting members of the same group accumulate.
 */
export function setGroupClass(
  classAttr: string | null | undefined,
  group: ReadonlySet<string>,
  add?: string,
): string {
  const kept = tokenize(classAttr).filter((t) => !group.has(t));
  if (add) kept.push(add);
  return kept.join(' ');
}

/**
 * Step a block's indent class one level in `dir` (+1 indent, -1 outdent) along `RICH_INDENT_STEPS`,
 * clamped to the ends. Returns the normalized class string. Pure — no DOM.
 */
export function stepIndentClass(classAttr: string | null | undefined, dir: 1 | -1): string {
  const tokens = tokenize(classAttr);
  const current = tokens.find((t) => RICH_INDENT_CLASSES.has(t)) ?? '';
  const idx = RICH_INDENT_STEPS.indexOf(current);
  const nextIdx = Math.min(RICH_INDENT_STEPS.length - 1, Math.max(0, (idx < 0 ? 0 : idx) + dir));
  return setGroupClass(classAttr, RICH_INDENT_CLASSES, RICH_INDENT_STEPS[nextIdx] || undefined);
}

// --- Toolbar command manifest: ordered groups; each consumer maps `id` to its own icon (lucide component
//     in the editor, inline SVG path in the bridge) and renders the control per `kind`. `null` = separator. ---

/** How a toolbar control behaves. `exec` runs a document.execCommand; the rest open a palette/popover. */
export type RichCmdKind =
  | 'exec' // document.execCommand(cmd[, arg]) → semantic tag (marks, lists, blocks, hr, clear)
  | 'color' // text-colour palette (brand CI + standard) → span class
  | 'highlight' // background palette (brand CI + standard) → span class
  | 'size' // text-size menu → span class
  | 'font' // CI font-slot menu (font-heading/body/<named>) → span class
  | 'align' // alignment menu → block class
  | 'indent' // step block indent (arg '1' | '-1')
  | 'link' // insert/edit link → <a href>
  | 'table' // insert a starter table
  | 'source'; // hand off to the raw HTML-source editor

export interface RichCmd {
  readonly id: string;
  readonly label: string;
  readonly kind: RichCmdKind;
  /** execCommand name (kind 'exec') or indent direction '1'|'-1' (kind 'indent'). */
  readonly cmd?: string;
  /** execCommand argument, e.g. 'h2' for formatBlock. */
  readonly arg?: string;
}

/**
 * The full ordered toolbar. `null` marks a visual separator between groups. Both toolbars render from this
 * list so their command set and order never drift. Width is handled per-surface (the panel field wraps;
 * the floating on-page bar collapses trailing groups into an overflow menu).
 */
export const RICH_TOOLBAR: ReadonlyArray<RichCmd | null> = [
  { id: 'bold', label: 'Bold', kind: 'exec', cmd: 'bold' },
  { id: 'italic', label: 'Italic', kind: 'exec', cmd: 'italic' },
  { id: 'underline', label: 'Underline', kind: 'exec', cmd: 'underline' },
  { id: 'strike', label: 'Strikethrough', kind: 'exec', cmd: 'strikeThrough' },
  { id: 'superscript', label: 'Superscript', kind: 'exec', cmd: 'superscript' },
  { id: 'subscript', label: 'Subscript', kind: 'exec', cmd: 'subscript' },
  null,
  { id: 'color', label: 'Text color', kind: 'color' },
  { id: 'highlight', label: 'Highlight', kind: 'highlight' },
  { id: 'font', label: 'Font', kind: 'font' },
  { id: 'size', label: 'Text size', kind: 'size' },
  null,
  { id: 'h2', label: 'Heading 2', kind: 'exec', cmd: 'formatBlock', arg: 'h2' },
  { id: 'h3', label: 'Heading 3', kind: 'exec', cmd: 'formatBlock', arg: 'h3' },
  { id: 'paragraph', label: 'Paragraph', kind: 'exec', cmd: 'formatBlock', arg: 'p' },
  { id: 'quote', label: 'Quote', kind: 'exec', cmd: 'formatBlock', arg: 'blockquote' },
  null,
  { id: 'bulletList', label: 'Bulleted list', kind: 'exec', cmd: 'insertUnorderedList' },
  { id: 'orderedList', label: 'Numbered list', kind: 'exec', cmd: 'insertOrderedList' },
  { id: 'outdent', label: 'Decrease indent', kind: 'indent', cmd: '-1' },
  { id: 'indent', label: 'Increase indent', kind: 'indent', cmd: '1' },
  { id: 'align', label: 'Alignment', kind: 'align' },
  null,
  { id: 'link', label: 'Link', kind: 'link' },
  { id: 'table', label: 'Insert table', kind: 'table' },
  { id: 'rule', label: 'Divider', kind: 'exec', cmd: 'insertHorizontalRule' },
  { id: 'clear', label: 'Clear formatting', kind: 'exec', cmd: 'removeFormat' },
  null,
  { id: 'source', label: 'Edit HTML source', kind: 'source' },
];

// --- Corporate-identity (CI) palette: the project's own brand colours + font slots, offered ALONGSIDE the
//     standard palettes so an author styles rich text in the site's brand. These are PER-PROJECT (token/slot
//     names vary), so unlike the static palettes above they're derived from the project's brand at runtime:
//     the editor feeds them to the dataset toolbar directly and posts them to the on-page bridge, and the
//     publish build adds the used ones to the Tailwind safelist (see build.ts). ---

/** A brand swatch/option: label + the Tailwind utility class it applies + an optional literal preview value
 *  (a CSS colour for a colour swatch dot; a font stack for a font preview) for surfaces without the site's
 *  brand CSS vars in scope (the editor SPA canvas). */
export interface CiSwatch {
  readonly label: string;
  readonly cls: string;
  readonly value?: string;
}

/** The project's brand colours + font slots as toolbar swatches. */
export interface CiRichPalette {
  readonly colors: readonly CiSwatch[];
  readonly fonts: readonly CiSwatch[];
}

// Base surface tokens (`base-100/200/300`) and the derived `*-content` tokens are page background / body
// text roles, NOT accent colours an author picks for a run of text — keep them out of the CI TEXT palette.
const CI_TEXT_COLOR_SKIP = /^base-|-content$/;
// Prefer the meaningful accent roles first, in a stable order, then any custom brand colours after.
const CI_COLOR_ORDER = ['primary', 'secondary', 'accent', 'neutral', 'info', 'success', 'warning', 'error'];

function titleCase(key: string): string {
  return key
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Derives the CI colour + font swatches for a project from its brand tokens. Font slots map to the same
 * `font-<slot>` utilities `brandToTailwindTheme` exposes (`heading`/`body` are always offered; custom
 * `named` + legacy `fontFamilies` slots follow). Colour tokens map to `text-<token>`; base surfaces and
 * `*-content` roles are excluded (they're not text-accent choices). Pure — safe on either surface.
 */
export function ciRichPalette(
  identity: { colors?: Record<string, string>; typography?: RichTypography } | null | undefined,
): CiRichPalette {
  // No identity (still loading) → no CI palette at all; the toolbar falls back to the standard palettes.
  if (!identity) return { colors: [], fonts: [] };
  const colorTokens = Object.keys(identity?.colors ?? {}).filter((k) => !CI_TEXT_COLOR_SKIP.test(k));
  const rank = (k: string): number => {
    const i = CI_COLOR_ORDER.indexOf(k);
    return i < 0 ? CI_COLOR_ORDER.length + 1 : i;
  };
  const colors: CiSwatch[] = [...colorTokens]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((token) => ({ label: titleCase(token), cls: `text-${token}`, value: identity?.colors?.[token] }));

  const typo = identity?.typography;
  const fontSlots: string[] = ['heading', 'body'];
  for (const name of Object.keys(typo?.named ?? {})) if (fontSlots.indexOf(name) < 0) fontSlots.push(name);
  for (const name of Object.keys(typo?.fontFamilies ?? {})) if (fontSlots.indexOf(name) < 0) fontSlots.push(name);
  const fonts: CiSwatch[] = fontSlots.map((slot) => ({ label: titleCase(slot), cls: `font-${slot}` }));

  return { colors, fonts };
}

/** The minimal typography shape `ciRichPalette` reads (a structural subset of the brand typography). */
export interface RichTypography {
  readonly named?: Record<string, unknown>;
  readonly fontFamilies?: Record<string, unknown>;
}

/** The full set of Tailwind classes a project's CI palette can emit — for the publish safelist (build.ts). */
export function ciRichClasses(
  identity: { colors?: Record<string, string>; typography?: RichTypography } | null | undefined,
): string[] {
  const { colors, fonts } = ciRichPalette(identity);
  return [...colors.map((c) => c.cls), ...fonts.map((f) => f.cls)];
}
