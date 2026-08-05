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
import type { CorporateIdentity } from '@sitewright/schema';
import { fontFaceCss, type FontLibraryAsset } from './font-face-css';

/** The scope every generated rule is nested under — the rich-text editable itself. */
export const RICH_CI_SCOPE = '.sw-rich-edit';

// Defense in depth. Values reaching here are schema-validated (`CssColorSchema`, and font families pass
// the render pipeline's own family regex), but this string is injected into a <style> on the ADMIN
// origin, so a stray `}` would end the rule and let author-controlled text write arbitrary CSS into the
// editor chrome. Anything that isn't a plain token / plain value is dropped rather than escaped.
const SAFE_TOKEN = /^[A-Za-z0-9_-]+$/;
const SAFE_VALUE = /^[^{}<>;@\\]{1,200}$/;

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
    if (!c.value || !SAFE_TOKEN.test(token) || !SAFE_VALUE.test(c.value)) continue;
    rules.push(`${RICH_CI_SCOPE} .${c.cls}{color:${c.value}}`);
  }
  for (const f of fontSwatches) {
    const slot = f.cls.slice('font-'.length);
    if (!SAFE_TOKEN.test(slot)) continue;
    // A named slot resolves through the shared stack resolver; a legacy `fontFamilies` entry is a raw
    // stack (and wins on key clash, matching brandToTailwindTheme's precedence).
    const stack = typeof legacy[slot] === 'string' ? String(legacy[slot]) : stacks[slot]?.stack;
    if (!stack || !SAFE_VALUE.test(stack)) continue;
    // family ONLY — the site's `font-<slot>` utility sets no weight either (weight is applied to real
    // heading ELEMENTS), so matching that keeps the field a true preview.
    rules.push(`${RICH_CI_SCOPE} .${f.cls}{font-family:${stack}}`);
  }
  return [...faces, ...rules].join('');
}
