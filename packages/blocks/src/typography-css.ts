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

/** The CSS `font-family` STACK for a slot (system keyword → curated stack; google → quoted family). */
function familyStack(slot: FontSlot, font: SelfHostedFont | undefined): string {
  if (slot.source === 'google') {
    // DOUBLE-quote: `"` can't pass the family regex, so no escaping needed and an apostrophe in the
    // name (e.g. "It's Display") stays valid (single-quoting wouldn't). Prefer the bundled font's
    // family + category fallback; degrade to the raw slot family if the record is missing.
    if (font) return `"${font.family}", ${font.fallback}`;
    if (SAFE_FAMILY.test(slot.family)) return `"${slot.family}", ${DEFAULT_SYSTEM}`;
  }
  return SYSTEM_STACKS[slot.family] ?? DEFAULT_SYSTEM;
}

/**
 * Compiles the project's heading/body typography into a CSS string applied to `body` + `h1`–`h6`,
 * plus `@font-face` rules (LOCAL urls) for any self-hosted google slot. Falls back to the platform
 * defaults (serif/700, sans-serif/400) so EVERY project gets a consistent baseline.
 */
export function typographyCss(typography: Typography | undefined, opts: TypographyCssOptions = {}): string {
  const heading = typography?.heading ?? DEFAULT_HEADING;
  const body = typography?.body ?? DEFAULT_BODY;
  const fontsById = new Map((typography?.fonts ?? []).map((f) => [f.id, f] as const));

  // @font-face per weight for each DISTINCT self-hosted font a slot references — local urls only.
  const faces: string[] = [];
  const emitted = new Set<string>();
  for (const slot of [heading, body]) {
    if (slot.source !== 'google' || !slot.fontId || emitted.has(slot.fontId) || !opts.fontUrl) continue;
    const font = fontsById.get(slot.fontId);
    if (!font) continue;
    emitted.add(slot.fontId);
    for (const w of font.weights) {
      faces.push(
        `@font-face{font-family:"${font.family}";font-style:normal;font-weight:${w};font-display:swap;` +
          `src:url(${opts.fontUrl(font.id, `${w}.woff2`)}) format("woff2")}`,
      );
    }
  }

  const headingFont = heading.fontId ? fontsById.get(heading.fontId) : undefined;
  const bodyFont = body.fontId ? fontsById.get(body.fontId) : undefined;
  return [
    faces.join(''),
    ':root{',
    `--sw-font-heading:${familyStack(heading, headingFont)};--sw-font-heading-weight:${heading.weight};`,
    `--sw-font-body:${familyStack(body, bodyFont)};--sw-font-body-weight:${body.weight};`,
    '}',
    'body{font-family:var(--sw-font-body);font-weight:var(--sw-font-body-weight)}',
    'h1,h2,h3,h4,h5,h6{font-family:var(--sw-font-heading);font-weight:var(--sw-font-heading-weight)}',
  ].join('');
}
