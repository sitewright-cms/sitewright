import type { BrandTokens } from '@sitewright/schema';

// Resolves a project's heading/body font SLOTS into a small CSS block that applies them to real
// page elements (`body`, `h1`–`h6`) — so it works for code-first (DaisyUI/Tailwind) pages, not
// just the block-tree renderer. For self-hosted Google slots it also emits the `@font-face` rules
// pointing at LOCAL woff2 URLs (never Google). Emitted as the LAST inline <style> in
// renderDocument so it wins over Tailwind preflight's element resets (e.g. `h1{font-weight:inherit}`);
// utility classes still override per-element since classes outrank element selectors.

type Typography = NonNullable<BrandTokens['typography']>;
type FontSlot = NonNullable<Typography['heading']>;
type SelfHostedFont = NonNullable<Typography['fonts']>[number];
type FontFile = SelfHostedFont['files'][number];

/** CSS `@font-face` `format()` hint per stored container format. */
const FORMAT_HINT: Record<FontFile['format'], string> = {
  woff2: 'woff2',
  woff: 'woff',
  ttf: 'truetype',
  otf: 'opentype',
};

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
   * Resolves a self-hosted font file's URL for the current render context — preview
   * (`/fonts/<id>/<file>`) vs publish (`<siteRoot>_assets/_fonts/<id>/<file>`). Absent → no
   * `@font-face` is emitted (the google family falls back to its generic).
   */
  fontUrl?: (fontId: string, file: string) => string;
}

/** The CSS `font-family` STACK for a slot (system keyword → curated stack; self-hosted → quoted family). */
function familyStack(slot: FontSlot, font: SelfHostedFont | undefined): string {
  if (slot.source === 'google' || slot.source === 'local') {
    // DOUBLE-quote: `"` can't pass the family regex, so no escaping needed and an apostrophe in the
    // name (e.g. "It's Display") stays valid (single-quoting wouldn't). Prefer the bundled font's
    // family + category fallback; degrade to the raw slot family if the record is missing.
    if (font) return `"${font.family}", ${font.fallback}`;
    if (SAFE_FAMILY.test(slot.family)) return `"${slot.family}", ${DEFAULT_SYSTEM}`;
  }
  return SYSTEM_STACKS[slot.family] ?? DEFAULT_SYSTEM;
}

/**
 * Compiles the project's typography into a CSS string applied to `body` + `h1`–`h6` (the built-in
 * heading/body slots), plus `--sw-font-<name>` vars for each CUSTOM named slot (opt-in via the
 * `font-<name>` utility — not auto-applied), plus `@font-face` rules (LOCAL urls only) for every
 * self-hosted font (google + uploaded) any slot references. Falls back to the platform defaults
 * (serif/700 heading, sans-serif/400 body) so EVERY project gets a consistent baseline.
 */
export function typographyCss(typography: Typography | undefined, opts: TypographyCssOptions = {}): string {
  const heading = typography?.heading ?? DEFAULT_HEADING;
  const body = typography?.body ?? DEFAULT_BODY;
  const named = typography?.named ?? {};
  const fontsById = new Map((typography?.fonts ?? []).map((f) => [f.id, f] as const));
  const slotFont = (slot: FontSlot): SelfHostedFont | undefined => (slot.fontId ? fontsById.get(slot.fontId) : undefined);

  // @font-face per stored FILE for each DISTINCT self-hosted font referenced by ANY slot (heading,
  // body, or a custom named slot) — local urls only, the right format() per container.
  const faces: string[] = [];
  const emitted = new Set<string>();
  for (const slot of [heading, body, ...Object.values(named)]) {
    if ((slot.source !== 'google' && slot.source !== 'local') || !slot.fontId || emitted.has(slot.fontId) || !opts.fontUrl) continue;
    const font = fontsById.get(slot.fontId);
    if (!font) continue;
    emitted.add(slot.fontId);
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
