import type { BrandTokens, MediaAsset } from '@sitewright/schema';

// Resolves a project's heading/body font SLOTS into a small CSS block that applies them to real
// page elements (`body`, `h1`–`h6`) — so it works for code-first (DaisyUI/Tailwind) pages, not just
// the block-tree renderer. A slot can reference a self-hosted font in the media library (kind
// `font`), in which case it also emits the `@font-face` rules pointing at the LOCAL media URLs
// (never a font CDN). Emitted as the LAST inline <style> in renderDocument so it wins over Tailwind
// preflight's element resets; utility classes still override per-element (classes outrank elements).

type Typography = NonNullable<BrandTokens['typography']>;
type FontSlot = NonNullable<Typography['heading']>;
/** A self-hosted font in the library — a `kind:'font'` media asset (family + faces). */
export type FontAsset = Extract<MediaAsset, { kind: 'font' }>;
type FontFile = FontAsset['files'][number];

/** CSS `@font-face` `format()` hint per stored container format. */
const FORMAT_HINT: Record<FontFile['format'], string> = {
  woff2: 'woff2',
  woff: 'woff',
  ttf: 'truetype',
  otf: 'opentype',
};

/** MIME type per stored container format — for a `<link rel="preload" as="font" type>` hint. */
const FONT_MIME: Record<FontFile['format'], string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
};
/** Prefer woff2 (near-universal, smallest) when a slot's weight is stored in several containers. */
const FORMAT_RANK: Record<FontFile['format'], number> = { woff2: 0, woff: 1, ttf: 2, otf: 3 };

/** Curated stacks for the generic SYSTEM families a slot can pick. */
const SYSTEM_STACKS: Record<string, string> = {
  serif: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
  'sans-serif': "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  monospace: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
};
const DEFAULT_SYSTEM = SYSTEM_STACKS['sans-serif']!;

/** Platform defaults when a slot is unset: serif/700 headings, sans-serif/400 body. */
const DEFAULT_HEADING: FontSlot = { source: 'system', family: 'serif', weight: 700 };
const DEFAULT_BODY: FontSlot = { source: 'system', family: 'sans-serif', weight: 400 };

// Defensive re-validation (values are already schema-checked) — a family that isn't a plain
// name can never reach the stylesheet.
const SAFE_FAMILY = /^[A-Za-z0-9][A-Za-z0-9 '-]*$/;

export interface TypographyCssOptions {
  /**
   * Resolves a font asset file's URL for the current render context — i.e. the project's media URL
   * (`/media/<projectId>/<assetId>/<file>`, which the publish HTML-rewrite rebases to
   * `_assets/<assetId>/<file>`). Absent → no `@font-face` is emitted (the family falls back to a generic).
   */
  fontUrl?: (assetId: string, file: string) => string;
}

/** The CSS `font-family` STACK for a slot (system keyword → curated stack; asset → quoted family). */
function familyStack(slot: FontSlot, font: FontAsset | undefined): string {
  if (slot.source === 'asset') {
    // DOUBLE-quote: `"` can't pass the family regex, so no escaping needed and an apostrophe in the
    // name (e.g. "It's Display") stays valid. Prefer the asset's family + category fallback; degrade
    // to the raw slot family if the asset is missing (e.g. deleted from the library).
    if (font) return `"${font.family}", ${font.fallback}`;
    if (SAFE_FAMILY.test(slot.family)) return `"${slot.family}", ${DEFAULT_SYSTEM}`;
  }
  return SYSTEM_STACKS[slot.family] ?? DEFAULT_SYSTEM;
}

/**
 * Compiles the project's typography into a CSS string applied to `body` + `h1`–`h6` (the built-in
 * heading/body slots), plus `--sw-font-<name>` vars for each CUSTOM named slot (opt-in via the
 * `font-<name>` utility — not auto-applied), plus `@font-face` rules (LOCAL urls only) for every
 * self-hosted font asset any slot references. `fonts` are the project's `kind:'font'` library
 * assets. Falls back to the platform defaults (serif/700 heading, sans-serif/400 body) so EVERY
 * project gets a consistent baseline.
 */
export function typographyCss(
  typography: Typography | undefined,
  fonts: readonly FontAsset[] = [],
  opts: TypographyCssOptions = {},
): string {
  const heading = typography?.heading ?? DEFAULT_HEADING;
  const body = typography?.body ?? DEFAULT_BODY;
  const named = typography?.named ?? {};
  const fontsById = new Map(fonts.map((f) => [f.id, f] as const));
  const slotFont = (slot: FontSlot): FontAsset | undefined => (slot.source === 'asset' && slot.assetId ? fontsById.get(slot.assetId) : undefined);

  // @font-face per stored FILE for each DISTINCT font asset referenced by ANY slot (heading, body,
  // or a custom named slot) — local media urls only, the right format() per container.
  const faces: string[] = [];
  const emitted = new Set<string>();
  for (const slot of [heading, body, ...Object.values(named)]) {
    if (slot.source !== 'asset' || !slot.assetId || emitted.has(slot.assetId) || !opts.fontUrl) continue;
    const font = fontsById.get(slot.assetId);
    if (!font) continue;
    emitted.add(slot.assetId);
    for (const f of font.files) {
      faces.push(
        `@font-face{font-family:"${font.family}";font-style:${f.style};font-weight:${f.weight};font-display:swap;` +
          `src:url(${opts.fontUrl(font.id, f.file)}) format("${FORMAT_HINT[f.format]}")}`,
      );
    }
  }

  return [
    faces.join(''),
    ':root{',
    `--sw-font-heading:${familyStack(heading, slotFont(heading))};--sw-font-heading-weight:${heading.weight};`,
    `--sw-font-body:${familyStack(body, slotFont(body))};--sw-font-body-weight:${body.weight};`,
    // Custom named slots → `--sw-font-<name>` (+ weight), consumed by the `font-<name>` Tailwind utility.
    ...Object.entries(named).map(
      ([name, slot]) => `--sw-font-${name}:${familyStack(slot, slotFont(slot))};--sw-font-${name}-weight:${slot.weight};`,
    ),
    '}',
    'body{font-family:var(--sw-font-body);font-weight:var(--sw-font-body-weight)}',
    'h1,h2,h3,h4,h5,h6{font-family:var(--sw-font-heading);font-weight:var(--sw-font-heading-weight)}',
  ].join('');
}

/** A self-hosted font face to preload — its resolved URL + MIME type. */
export interface FontPreload {
  href: string;
  type: string;
}

/**
 * The self-hosted font faces to `<link rel="preload">` — ONLY the BODY and HEADING slots, and only the
 * single file that actually renders each (exact weight, `normal` style, preferring woff2). Those two
 * faces style `body` + `h1`–`h6` on every page, so the browser needs them regardless; preloading starts
 * their fetch in parallel with the render-blocking CSS instead of after it, cutting LCP for a heading/text
 * LCP and avoiding a late `font-display:swap` flash. Deliberately conservative (≤2 links, deduped): we
 * never preload a weight/style that isn't the default-rendered one, so a preload is never wasted. Returns
 * `[]` without a `fontUrl` resolver, for system-font slots, or when the exact face isn't in the library.
 */
export function fontPreloads(
  typography: Typography | undefined,
  fonts: readonly FontAsset[] = [],
  opts: TypographyCssOptions = {},
): FontPreload[] {
  if (!opts.fontUrl) return [];
  const fontUrl = opts.fontUrl;
  const heading = typography?.heading ?? DEFAULT_HEADING;
  const body = typography?.body ?? DEFAULT_BODY;
  const fontsById = new Map(fonts.map((f) => [f.id, f] as const));
  const out: FontPreload[] = [];
  const seen = new Set<string>();
  for (const slot of [body, heading]) {
    if (slot.source !== 'asset' || !slot.assetId) continue;
    const font = fontsById.get(slot.assetId);
    if (!font) continue;
    // The single file that renders this slot: exact weight + upright, best container first (woff2).
    const file = font.files
      .filter((f) => f.weight === slot.weight && f.style === 'normal')
      .sort((a, b) => FORMAT_RANK[a.format] - FORMAT_RANK[b.format])[0];
    if (!file) continue;
    const href = fontUrl(font.id, file.file);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    out.push({ href, type: FONT_MIME[file.format] });
  }
  return out;
}
