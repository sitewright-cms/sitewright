import type { BrandTokens } from '@sitewright/schema';

// Resolves a project's heading/body font SLOTS into a small CSS block that applies them to real
// page elements (`body`, `h1`–`h6`) — so it works for code-first (DaisyUI/Tailwind) pages, not
// just the block-tree renderer. Emitted as the LAST inline <style> in renderDocument so it wins
// over Tailwind preflight's element resets (e.g. `h1{font-weight:inherit}`); utility classes
// still override per-element since classes outrank element selectors.

type Typography = NonNullable<BrandTokens['typography']>;
type FontSlot = NonNullable<Typography['heading']>;

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

/** The CSS `font-family` STACK for a slot (system keyword → curated stack; google → quoted name). */
function familyStack(slot: FontSlot): string {
  if (slot.source === 'google' && SAFE_FAMILY.test(slot.family)) {
    // DOUBLE-quote the family: `"` can't pass the family regex, so this needs no escaping and a
    // name containing an apostrophe (e.g. "It's Display") stays valid (single-quoting wouldn't).
    // PR1 has no google slots; the generic fallback keeps a sane stack until PR2 supplies a
    // category-aware fallback. (System keywords below never reach here.)
    return `"${slot.family}", ${DEFAULT_SYSTEM}`;
  }
  return SYSTEM_STACKS[slot.family] ?? DEFAULT_SYSTEM;
}

/**
 * Compiles the project's heading/body typography into a CSS string applied to `body` + `h1`–`h6`.
 * Falls back to the platform defaults (serif/700, sans-serif/400) so EVERY project gets a
 * consistent baseline even with no typography configured. (PR2 adds @font-face for google slots.)
 */
export function typographyCss(typography: Typography | undefined): string {
  const heading = typography?.heading ?? DEFAULT_HEADING;
  const body = typography?.body ?? DEFAULT_BODY;
  return [
    ':root{',
    `--sw-font-heading:${familyStack(heading)};--sw-font-heading-weight:${heading.weight};`,
    `--sw-font-body:${familyStack(body)};--sw-font-body-weight:${body.weight};`,
    '}',
    'body{font-family:var(--sw-font-body);font-weight:var(--sw-font-body-weight)}',
    'h1,h2,h3,h4,h5,h6{font-family:var(--sw-font-heading);font-weight:var(--sw-font-heading-weight)}',
  ].join('');
}
