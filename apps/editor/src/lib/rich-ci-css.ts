// The project's Corporate Identity, as CSS the rich-text editable can actually render with.
//
// WHY THIS EXISTS. The toolbars offer the project's brand colours (`text-<token>`) and font slots
// (`font-<slot>`) and emit them as Tailwind utilities. On the rendered SITE those utilities are real:
// the publish build compiles them against the project's own theme (`brandToTailwindTheme` → brand vars
// + `--sw-font-<slot>`). Inside the editor SPA they are not — its stylesheet is compiled once, at build
// time, from the editor's OWN source, which knows nothing about any project. So `font-heading` and
// `font-body` resolved to NOTHING (measured: no rule at all), and `text-primary`/`text-accent` resolved
// to the editor chrome's DaisyUI defaults — a colour, but the wrong one, identical in every project.
// Both read to an author as "the control does nothing".
//
// The fix is to state the project's brand as ordinary scoped CSS, generated per project and injected
// next to the field. Scoping to `.sw-rich-edit` (specificity 0,2,0) also means these rules beat any
// same-named editor-chrome utility (0,1,0), so a brand token always wins inside author content.
import { ciRichPalette, fontSlotStacks } from '@sitewright/blocks';
import { isSafeCssTokenValue, type CorporateIdentity } from '@sitewright/schema';
import { fontFaceCss, type FontLibraryAsset } from './font-face-css';

/** The scope every generated rule is nested under — the rich-text editable itself. */
export const RICH_CI_SCOPE = '.sw-rich-edit';

// Defense in depth: this string is injected into a <style> on the ADMIN origin, and the values in it
// are project content, writable by any `content:write` actor (an invited client, an API key, the agent
// loop) — not necessarily by the admin reading it.
//
// The VALUE guard is `isSafeCssTokenValue`, the schema package's single predicate for "safe to emit
// into a stylesheet we control", deliberately reused rather than re-derived: it already denies the
// breakout characters, `/*`…`*/` (an unterminated comment swallows the rest of the block, including
// its closing brace, silently eating every declaration after it), fetching functions like `url()`,
// `@import`, invisible format characters, and unbalanced parens. A local regex here would be a fourth
// hand-copy of that rule and would drift from it — which is exactly what its own doc comment warns
// about, and what an earlier version of this file got wrong by allowing `/*` through.
const SAFE_TOKEN = /^[A-Za-z0-9_-]+$/;
const MAX_VALUE_LEN = 200;

/** A value safe to emit into the generated sheet: the shared CSS predicate, plus a length bound. */
function safeValue(v: string): boolean {
  return v.length > 0 && v.length <= MAX_VALUE_LEN && isSafeCssTokenValue(v);
}

/**
 * A stylesheet giving the project's CI colour + font utilities real values inside the rich-text editable:
 * `@font-face` rules for each self-hosted slot font, then one rule per brand colour token and per font
 * slot. Returns `''` for an absent identity (the standard palettes still work — they are compiled into
 * the editor sheet unconditionally, see styles.css `@source inline`).
 *
 * The colour + font lists come from `ciRichPalette`, the SAME derivation that builds the toolbar's
 * swatches, so the menu can never offer a choice this sheet has no rule for.
 */
export function richCiCss(
  identity: CorporateIdentity | null | undefined,
  fonts: readonly FontLibraryAsset[] = [],
): string {
  if (!identity) return '';
  const { colors, fonts: fontSwatches } = ciRichPalette(identity);
  const stacks = fontSlotStacks(identity.typography, fonts);
  const legacy = identity.typography?.fontFamilies ?? {};

  const faces: string[] = [];
  const seenFace = new Set<string>();
  for (const { font } of Object.values(stacks)) {
    if (!font || seenFace.has(font.id)) continue;
    seenFace.add(font.id);
    faces.push(fontFaceCss(font));
  }

  const rules: string[] = [];
  for (const c of colors) {
    // `cls` is `text-<token>`; the token itself is what needs validating.
    const token = c.cls.slice('text-'.length);
    if (!c.value || !SAFE_TOKEN.test(token) || !safeValue(c.value)) continue;
    rules.push(`${RICH_CI_SCOPE} .${c.cls}{color:${c.value}}`);
  }
  for (const f of fontSwatches) {
    const slot = f.cls.slice('font-'.length);
    if (!SAFE_TOKEN.test(slot)) continue;
    // A named slot resolves through the shared stack resolver; a legacy `fontFamilies` entry is a raw
    // stack (and wins on key clash, matching brandToTailwindTheme's precedence).
    const stack = typeof legacy[slot] === 'string' ? String(legacy[slot]) : stacks[slot]?.stack;
    if (!stack || !safeValue(stack)) continue;
    // family ONLY — the site's `font-<slot>` utility sets no weight either (weight is applied to real
    // heading ELEMENTS), so matching that keeps the field a true preview.
    rules.push(`${RICH_CI_SCOPE} .${f.cls}{font-family:${stack}}`);
  }
  return [...faces, ...rules].join('');
}
