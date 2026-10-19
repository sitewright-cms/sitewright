// FONT STACKS — what a typography setting actually puts in front of a visitor.
//
// There are two ways to name a typeface, and only one of them ships a FILE:
//   - a SLOT (`identity.typography.heading` / `body` / `named.<name>`) with `source:"asset"` references a
//     self-hosted font in the media library, and the renderer emits its `@font-face`;
//   - a `typography.fontFamilies` STACK (`mono: "JetBrains Mono"`) only NAMES a family. It becomes the
//     `font-<key>` utility and the `--sw-font-<key>` var, and no file goes with it.
// Agents reach for the second when they want a third face, and the result is text in whatever the
// visitor's browser substitutes — with a bare one-family stack, its default SERIF. This module gives such
// a stack a sensible generic tail, and lets a settings write say plainly when a named face is not served.

import { RESERVED_FONT_SLOT_NAMES } from './corporate-identity.js';

type GenericFamily = 'serif' | 'sans-serif' | 'monospace';

/** CSS generic families: a stack that names one always has a face to land on. Lower-case. */
const GENERIC_FONT_FAMILIES: ReadonlySet<string> = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif',
  'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong',
]);

/** CSS-wide keywords — a `font-family` that is one of these must not grow a list. */
const CSS_WIDE_KEYWORDS: ReadonlySet<string> = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

/**
 * Named faces present on (nearly) every visitor's system, with the generic family each belongs to. A Map,
 * not an object literal: a family is a free-text name, and `constructor` is a valid one.
 */
const WEB_SAFE_FONTS: ReadonlyMap<string, GenericFamily> = new Map(
  Object.entries({
    'sans-serif': ['arial', 'helvetica', 'helvetica neue', 'verdana', 'tahoma', 'trebuchet ms', 'segoe ui', 'lucida grande', 'lucida sans unicode', 'gill sans', 'impact', '-apple-system', 'blinkmacsystemfont'],
    serif: ['georgia', 'times new roman', 'times', 'garamond', 'palatino', 'palatino linotype', 'cambria', 'baskerville', 'book antiqua'],
    monospace: ['courier new', 'courier', 'consolas', 'monaco', 'menlo', 'lucida console', 'sfmono-regular', 'liberation mono'],
  }).flatMap(([generic, names]) => names.map((n) => [n, generic as GenericFamily] as const)),
);

const lc = (s: string): string => s.trim().toLowerCase();

/**
 * The generic family a well-known system face belongs to (`Georgia` → `serif`), or undefined for a face
 * that is not on (nearly) every system. Case-insensitive. The ONE copy: the renderer reads it to trail a
 * named system slot with the right kind of stack, and the checks below to know which names need no file.
 */
export function webSafeFontCategory(family: string): GenericFamily | undefined {
  return WEB_SAFE_FONTS.get(lc(family));
}

/** The family names of a CSS `font-family` stack, unquoted, in order. */
export function fontStackFamilies(stack: string): string[] {
  return stack
    .split(',')
    .map((f) => f.trim().replace(/^(["'])(.*)\1$/, '$2').trim())
    .filter((f) => f.length > 0);
}

/** The generic family a stack under this `fontFamilies` key should end in. */
function genericFamilyFor(key: string, families: readonly string[]): GenericFamily {
  for (const f of families) {
    const known = webSafeFontCategory(f);
    if (known) return known;
  }
  if (key === 'mono' || key === 'code' || families.some((f) => /\bmono(space)?\b/i.test(f))) return 'monospace';
  if (key === 'serif') return 'serif';
  return 'sans-serif';
}

/**
 * A `fontFamilies` stack with a generic fallback appended when it names none: `JetBrains Mono` →
 * `JetBrains Mono, monospace`, `Georgia` → `Georgia, serif`. A bare one-family stack used to fall
 * through to the browser default (a serif) wherever that face was missing — the "third font never
 * loaded and had no fallback" report. Left untouched: a stack that already has a generic, a CSS-wide
 * keyword, or a `var()` (whose value we cannot see).
 */
export function withGenericFallback(key: string, stack: string): string {
  const families = fontStackFamilies(stack);
  if (families.length === 0 || /\bvar\(/i.test(stack)) return stack;
  if (families.some((f) => GENERIC_FONT_FAMILIES.has(lc(f)) || CSS_WIDE_KEYWORDS.has(lc(f)))) return stack;
  return `${stack}, ${genericFamilyFor(key, families)}`;
}

/**
 * Families a site's OWN CSS/HTML makes available: each `@font-face` font-family, and each family a
 * fonts.googleapis.com stylesheet URL asks for (the design guide says not to use one, but it does load).
 * Linear: every step resumes after the block it just read, so an unclosed `@font-face{` cannot make the
 * scan quadratic.
 */
export function declaredFontFamilies(source: string): string[] {
  const out: string[] = [];
  const at = /@font-face/gi;
  for (let m = at.exec(source); m; m = at.exec(source)) {
    const end = source.indexOf('}', m.index);
    if (end === -1) break;
    const decl = /font-family\s*:\s*(?:"([^"]*)"|'([^']*)'|([^;}]*))/i.exec(source.slice(m.index, end));
    const family = (decl?.[1] ?? decl?.[2] ?? decl?.[3] ?? '').trim();
    if (family) out.push(family);
    at.lastIndex = end + 1;
  }
  for (const url of source.match(/fonts\.googleapis\.com\/css2?\?[^"'()\s>]*/gi) ?? []) {
    // `&amp;` first: in HTML the separator is escaped, and `[?&]` alone would leave `amp;family=…`.
    for (const param of url.split(/&amp;|[?&]/)) {
      if (!param.startsWith('family=')) continue;
      let value: string;
      try {
        value = decodeURIComponent(param.slice('family='.length).replace(/\+/g, ' '));
      } catch {
        continue; // a malformed escape names nothing we can match
      }
      // css2: `Playfair Display:wght@400;700`; the legacy css API: `Roboto:400,700|Open Sans`.
      for (const fam of value.split('|')) {
        const name = fam.split(':')[0]?.trim();
        if (name) out.push(name);
      }
    }
  }
  return out;
}

interface SlotLike {
  readonly source: string;
  readonly family: string;
  readonly weight?: number;
  readonly assetId?: string;
}

/** The typography fields this check reads (structural, so a BrandTokens or a CorporateIdentity both fit). */
export interface TypographyLike {
  readonly fontFamilies?: Readonly<Record<string, string>>;
  readonly heading?: SlotLike;
  readonly body?: SlotLike;
  readonly named?: Readonly<Record<string, SlotLike>>;
}

/** What the site serves besides its slots, and the project's font library. */
export interface FontServingContext {
  /** Families the site's own CSS/HTML declares (see {@link declaredFontFamilies}). */
  readonly declared: readonly string[];
  /** The project's `kind:'font'` media assets. */
  readonly library: ReadonlyArray<{ readonly id: string; readonly family: string }>;
}

// The named-slot key shape (corporate-identity's NamedFontSlotKeySchema). Linear: each group needs its
// leading `-`, so it cannot overlap the prefix; only ever run on a fontFamilies KEY (KeyNameSchema-bounded).
// eslint-disable-next-line security/detect-unsafe-regex -- provably linear; bounded input
const SLOT_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Where a face named by `fontFamilies.<key>` belongs as a SLOT, and the utility that slot gives. */
function slotFor(key: string): { path: string; cls: string } {
  if (key === 'heading' || key === 'body') return { path: `identity.typography.${key}`, cls: `font-${key}` };
  // `mono` is the name an agent reaches for first, and it is reserved (it would shadow Tailwind's font-mono).
  const name = key === 'mono' ? 'code' : SLOT_NAME.test(key) && key.length <= 32 && !RESERVED_FONT_SLOT_NAMES.has(key) ? key : 'accent';
  return { path: `identity.typography.named.${name}`, cls: `font-${name}` };
}

/**
 * Advisory warnings for typography that names a face no font file is served for — the write still lands;
 * this only says why the text will not look as intended, and what to do instead:
 *   - a `fontFamilies` stack whose FIRST family is neither web-safe, nor served by an asset slot, nor
 *     declared by the site's own CSS;
 *   - a `system` slot (including a legacy `source:"google"` one, which degrades to system) naming such a face;
 *   - an `asset` slot whose asset is not in the media library.
 */
export function unservedFontWarnings(typography: TypographyLike | undefined, ctx: FontServingContext): string[] {
  if (!typography) return [];
  const byId = new Map(ctx.library.map((f) => [f.id, f] as const));
  const served = new Set(ctx.declared.map(lc));
  const slots: Array<[string, SlotLike | undefined]> = [
    ['heading', typography.heading],
    ['body', typography.body],
    ...Object.entries(typography.named ?? {}).map(([name, slot]): [string, SlotLike] => [`named.${name}`, slot]),
  ];
  const out: string[] = [];
  for (const [path, slot] of slots) {
    if (slot?.source !== 'asset' || !slot.assetId) continue;
    const font = byId.get(slot.assetId);
    if (font) served.add(lc(font.family));
    else {
      out.push(
        `identity.typography.${path} points at font asset "${slot.assetId}", which is not in this project's media library, so no font file ships and the text falls back to a generic face. Use the id select_google_font or list_media returned.`,
      );
    }
  }
  const available = (family: string): boolean => {
    const f = lc(family);
    return GENERIC_FONT_FAMILIES.has(f) || CSS_WIDE_KEYWORDS.has(f) || WEB_SAFE_FONTS.has(f) || served.has(f);
  };
  const source = (family: string): string => {
    const owned = ctx.library.find((f) => lc(f.family) === lc(family));
    return owned
      ? `It is already in the media library (assetId "${owned.id}")`
      : `select_google_font({ family:"${family}", weights:[400] }) self-hosts it`;
  };
  for (const [path, slot] of slots) {
    if (!slot || slot.source === 'asset' || available(slot.family)) continue;
    out.push(
      `identity.typography.${path} is a system slot naming "${slot.family}", which is not a web-safe face, and the site settings serve no file for it (no asset slot, no @font-face or Google Fonts link in website.criticalCss/head), so visitors without it installed see a generic fallback. ${source(slot.family)}; then set that slot to { source:"asset", assetId, family:"${slot.family}", weight:${slot.weight ?? 400} }.`,
    );
  }
  for (const [key, stack] of Object.entries(typography.fontFamilies ?? {})) {
    if (/\bvar\(/i.test(stack)) continue;
    const [first, ...rest] = fontStackFamilies(withGenericFallback(key, stack));
    if (!first || available(first)) continue;
    const slot = slotFor(key);
    out.push(
      `identity.typography.fontFamilies.${key} names "${first}", but the site settings serve no font file for it (no asset slot, no @font-face or Google Fonts link in website.criticalCss/head): a fontFamilies stack only NAMES a face, so a visitor without it installed sees ${rest.join(', ') || 'the browser default'}. ${source(first)}; use it as a slot instead: ${slot.path} = { source:"asset", assetId, family:"${first}", weight:400 } → class ${slot.cls} (get_guide("design") FONTS).`,
    );
  }
  return out;
}
