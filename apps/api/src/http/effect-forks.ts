// "Fork existing effect" snippets for the Website-settings custom-code editors. Each built-in effect
// is turned into a SELF-CONTAINED, ready-to-run HTML snippet (a `<style>`, plus a `<script>` for the
// JS-backed nav effects, or the overlay markup for preloaders) that a tenant can drop into the
// "None / Custom Code" editor and tweak. The snippets target the nav links / buttons / preloader
// DIRECTLY (no `sw-nav-*` scheme class) and use the dark-mode-aware `--sw-color-*` tokens, so they
// apply globally and stay legible in both themes — exactly what the custom-code slot needs.
//
// Derived from the SAME source of truth as the built-in effects (`EFFECT_UTILITIES` + the preloader
// runtime), so they can never drift: a nav/button effect's standalone CSS is just its `@utility`
// body with the nesting `&` (= the scheme class) removed → the selectors apply to every nav/button.
import {
  NAV_EFFECTS,
  NAV_EFFECT_LABELS,
  JS_NAV_EFFECTS,
  BUTTON_EFFECTS,
  PRELOADER_EFFECTS,
} from '@sitewright/schema';
import { EFFECT_UTILITIES } from '@sitewright/tailwind';
import { NAV_EFFECTS_JS, preloaderHtml, PRELOADER_CSS, PRELOADER_JS } from '@sitewright/blocks';

export interface EffectFork {
  name: string;
  label: string;
  /** A self-contained HTML snippet (style/script/markup) the editor inserts on fork. */
  code: string;
}
export interface EffectForks {
  nav: EffectFork[];
  button: EffectFork[];
  preloader: EffectFork[];
}

/** Pull the brace-balanced body of `@<at> <name> { … }` out of a CSS string (handles nested braces). */
function blockBody(src: string, opener: string): string | null {
  const start = src.indexOf(opener);
  if (start < 0) return null;
  let depth = 1;
  let i = start + opener.length;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
  }
  return depth === 0 ? src.slice(start + opener.length, i - 1) : null;
}

/** "logo-pulse" → "Logo pulse" (matches the editor's preloader label helper). */
function titleCase(s: string): string {
  const t = s.replace(/-/g, ' ');
  return `${t[0]!.toUpperCase()}${t.slice(1)}`;
}

/**
 * Pretty-print CSS so the forked snippet is readable: each selector and declaration on its own line,
 * indented by brace depth. Safe for the platform's own effect CSS — its values carry no `{`/`}`/`;`
 * (the SVG-mask data-URL + color-mix() use none) and the `@utility` bodies have no inline comments.
 */
function formatCss(css: string): string {
  let out = '';
  let depth = 0;
  let buf = '';
  const pad = (d: number): string => '  '.repeat(Math.max(0, d));
  const flush = (): void => {
    const t = buf.trim();
    if (t) out += `${pad(depth)}${t};\n`;
    buf = '';
  };
  for (const ch of css) {
    if (ch === '{') {
      const sel = buf.trim();
      if (sel) out += `${pad(depth)}${sel} {\n`;
      buf = '';
      depth++;
    } else if (ch === '}') {
      flush(); // a final declaration with no trailing ';' still gets terminated
      depth--;
      out += `${pad(depth)}}\n`;
    } else if (ch === ';') {
      flush();
    } else {
      buf += ch;
    }
  }
  return out.trim();
}

/**
 * A built-in nav/button effect's standalone CSS: its `@utility` body with the nesting `&` (the scheme
 * class) dropped, so the selectors apply globally. Any top-level `@keyframes` it animates (e.g. the
 * blob morph) is appended so the snippet is complete.
 */
function effectStyle(util: string): string {
  const body = blockBody(EFFECT_UTILITIES, `@utility ${util} {`);
  if (!body) return '';
  // `&` is the nesting selector standing in for `.${util}` — drop it (and the space after a descendant
  // `& `) so each rule targets the nav links / buttons directly (the custom-code slot has no class).
  // The effect source only uses descendant (`& :is`) / compound (`&:is`, `&.btn`) combinators; if a
  // future effect adds a child/sibling combinator (`&>`, `&+`, `&~`) this blanket strip would need to
  // grow to consume it (a coverage test pins the snippet shape, so a regression would surface).
  let css = body.replace(/&\s?/g, '').trim();
  // Append any top-level @keyframes this effect references but doesn't define inline (e.g. the blob
  // morph). Effect + keyframes names are unique platform constants, so `indexOf` finds the right block.
  const emitted = new Set<string>();
  for (const m of body.matchAll(/animation:\s*([\w-]+)/g)) {
    const kf = m[1]!;
    if (emitted.has(kf) || body.includes(`@keyframes ${kf}`)) continue;
    const frames = blockBody(EFFECT_UTILITIES, `@keyframes ${kf} {`);
    if (frames) {
      css += `\n@keyframes ${kf} {${frames}}`;
      emitted.add(kf);
    }
  }
  return formatCss(css);
}

let cache: EffectForks | null = null;

/** The fork snippets for every built-in effect, computed once (pure string transforms; cached). */
export function buildEffectForks(): EffectForks {
  if (cache) return cache;
  const nav: EffectFork[] = NAV_EFFECTS.map((name) => {
    const js = (JS_NAV_EFFECTS as readonly string[]).includes(name)
      ? `\n<script>\n${NAV_EFFECTS_JS}\n</script>`
      : '';
    return { name, label: NAV_EFFECT_LABELS[name], code: `<style>\n${effectStyle(`sw-nav-${name}`)}\n</style>${js}` };
  });
  const button: EffectFork[] = BUTTON_EFFECTS.map((name) => ({
    name,
    label: titleCase(name),
    code: `<style>\n${effectStyle(`sw-btn-${name}`)}\n</style>`,
  }));
  // Preloaders aren't @utility-based: a fork is the overlay markup + the full preloader stylesheet +
  // the show/hide runtime — a working, editable starting point (logo-* fall back to the brand mark).
  const preloader: EffectFork[] = PRELOADER_EFFECTS.map((name) => ({
    name,
    label: titleCase(name),
    code: `${preloaderHtml(name)}\n<style>\n${PRELOADER_CSS}\n</style>\n<script>\n${PRELOADER_JS}\n</script>`,
  }));
  cache = { nav, button, preloader };
  return cache;
}
