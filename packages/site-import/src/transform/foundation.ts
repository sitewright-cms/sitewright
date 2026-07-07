// FOUNDATION extractor — the deterministic step that turns a freshly-crawled site into a clean NATIVE
// Sitewright foundation (theme + fonts + chrome), so the per-page AI authoring starts from real brand
// identity rather than the platform defaults. Opt-in (TransformOptions.foundation); when off, import is
// unchanged. See docs/nativize/pipeline.md.
//
// What it does, all from the foreign CSS + the assembled identity/website/pages (no AI):
//   • COLORS  — parse the brand palette (--*-color custom props) → identity.colors (DaisyUI tokens).
//   • FONTS   — resolve the heading/body font families from the CSS, match the self-hosted woffs →
//               identity.typography.heading/body (source:'asset'), the proper native typography path.
//   • CHROME  — replace the foreign nav with a data-driven {{#each nav.header}} navbar + a native footer;
//               configure page nav (slots/order/dropdown) so nav.header is correct.
//   • CSS     — emit reusable site CSS (body background + .bp-hero band texture + .bp-card elevation)
//               into criticalCss; KEEP the foreign stylesheet link in head (the nativize capture needs it; stripped at finalize); DISCARD scripts.
import type { CorporateIdentity, FontSlot, Page, WebsiteSettings } from '@sitewright/schema';
import { CorporateIdentitySchema, WebsiteSettingsSchema, RESERVED_FONT_SLOT_NAMES } from '@sitewright/schema';
import type { ImportDiagnostic } from '../types.js';
import { rewriteCssUrls } from './css.js';

// ─────────────────────────────── CSS parsing helpers ───────────────────────────────

/** All `--name: value` custom properties (last declaration wins, mirroring the cascade). */
export function readCssVars(cssText: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of cssText.matchAll(/--([a-z0-9-]+)\s*:\s*([^;}{]+)[;}]/gi)) {
    const name = m[1];
    const value = m[2];
    if (name && value) out.set(name.toLowerCase(), value.trim());
  }
  return out;
}

/**
 * The source site's CONTENT-CONTAINER width (px) → website.containerWidth, so the clone's --sw-container
 * matches the original (the platform default is 1200; a real site is often 1140/1320/1400). Read from a
 * width-ish CSS custom property (e.g. --template-width:1400px, --container-width, --content-width, --site-
 * width, --wrapper) — the most reliable signal; the `.container` rule itself is media-query-noisy. Returns
 * undefined when there's no clear signal (keep the default). Bounded to a sane content range.
 */
export function extractContentWidth(cssText: string): string | undefined {
  let best: number | undefined;
  for (const [name, raw] of readCssVars(cssText)) {
    if (!/^(template|container|content|site|page|wrapper|wrap|layout|max)[-_]?width$/i.test(name)) continue;
    const m = /(\d{3,4})px/.exec(raw);
    if (!m) continue;
    const n = Number(m[1]);
    if (n >= 960 && n <= 1920 && (best === undefined || n > best)) best = n;
  }
  return best === undefined ? undefined : `${best}px`;
}

/** Resolve a value that may be `var(--x[, fallback])`, one or a few levels deep. */
function resolveVar(value: string, vars: Map<string, string>, depth = 0): string {
  if (depth > 5) return value;
  const m = value.match(/var\(\s*--([a-z0-9-]+)\s*(?:,\s*([^)]+))?\)/i);
  if (!m || !m[1]) return value;
  const resolved = vars.get(m[1].toLowerCase()) ?? m[2] ?? '';
  return resolveVar(resolved.trim(), vars, depth + 1);
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)$/i;
function isColor(v: string): boolean {
  const t = v.trim();
  return COLOR_RE.test(t) && t.length <= 64 && t.toLowerCase() !== 'inherit' && t.toLowerCase() !== 'transparent' && t.toLowerCase() !== 'currentcolor';
}

// Foreign custom-prop name (without `--`) → Sitewright color token. First match wins per token.
const COLOR_VAR_MAP: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(primary-color|color-primary|primary|brand-color|brand|brandcolor)$/, 'primary'],
  [/^(secondary-color|color-secondary|secondary)$/, 'secondary'],
  [/^(accent-color|color-accent|accent|tertiary-color|tertiary)$/, 'accent'],
  [/^(text-color|color-text|body-color|foreground|fg|ink)$/, 'base-content'],
  [/^(bg-color|color-bg|background-color|background|page-bg|body-bg)$/, 'base-200'],
];

/** Map the foreign palette (CSS custom props) to Sitewright color tokens. */
export function extractColors(cssText: string): Record<string, string> {
  const vars = readCssVars(cssText);
  const out: Record<string, string> = {};
  for (const [name, raw] of vars) {
    const val = resolveVar(raw, vars);
    if (!isColor(val)) continue;
    for (const [re, token] of COLOR_VAR_MAP) {
      if (re.test(name) && !(token in out)) out[token] = val.trim();
    }
  }
  return out;
}

/** Normalize a raw font-family VALUE to a single bare family name (resolve var(), drop !important,
 *  the fallback stack, and quotes). Returns undefined for a keyword (inherit/initial/unset). */
function familyName(value: string, vars: Map<string, string>): string | undefined {
  const firstToken = (value.replace(/!important/gi, '').split(',')[0] ?? '').trim();
  const first = (resolveVar(firstToken, vars).split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');
  return first && !/^(inherit|initial|unset)$/i.test(first) ? first : undefined;
}

/** The font-family declared on the first matching selector (var()s resolved to a single family name). */
function familyForSelectors(cssText: string, selectors: readonly string[], vars: Map<string, string>): string | undefined {
  for (const sel of selectors) {
    // a rule whose selector LIST contains `sel` as a standalone token, with a font-family declaration
    const re = new RegExp(`(?:^|[},])\\s*[^{}]*\\b${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^{}]*\\{([^{}]*font-family[^{}]*)\\}`, 'i');
    const block = cssText.match(re)?.[1];
    if (!block) continue;
    const value = block.match(/font-family\s*:\s*([^;}]+)/i)?.[1];
    const first = value ? familyName(value, vars) : undefined;
    if (first) return first;
  }
  return undefined;
}

// Semantic font custom-property names → role. Many sites declare the brand fonts as `--*-font` vars and
// apply them via utility CLASSES (e.g. `.primary-font`), so the h1/h2/body selector scan alone misses
// them — the var names are the more reliable signal.
const FONT_VAR_MAP: ReadonlyArray<readonly [RegExp, 'heading' | 'body']> = [
  [/^(primary-font|font-primary|headings?-?font|font-headings?|display-font|font-display|title-font|font-title)$/, 'heading'],
  [/^(text-font|font-text|body-font|font-body|base-font|font-base|copy-font|font-copy|paragraph-font)$/, 'body'],
];

// ADDITIONAL semantic font vars → a NAMED slot (kept beyond heading/body). Sites often define a
// secondary/tertiary/accent display face applied via `.secondary-font` classes; capturing it into a
// `typography.named` slot self-hosts it (a `--sw-font-<name>` var + `font-<name>` utility) so it survives
// nativize STRIPPING the foreign stylesheet — the exact gap that broke a real clone's secondary fonts.
const NAMED_FONT_VAR_MAP: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(secondary-font|font-secondary|alt-font|font-alt|subheading-font|font-subheading)$/, 'secondary'],
  [/^(tertiary-font|font-tertiary)$/, 'tertiary'],
  [/^(accent-font|font-accent|special-font|font-special)$/, 'accent'],
];
// Cap the named slots so a font-heavy import can't bloat the settings blob. (Reserved slot names are
// filtered against the schema's own RESERVED_FONT_SLOT_NAMES — imported, not hand-copied, so it can't drift.)
const MAX_NAMED_FONTS = 6;

/** Resolve a role's family from a semantic `--*-font` custom property, when one is declared. */
function familyFromVars(vars: Map<string, string>, role: 'heading' | 'body'): string | undefined {
  for (const [name, raw] of vars) {
    for (const [re, r] of FONT_VAR_MAP) {
      if (r === role && re.test(name)) {
        const fam = familyName(raw, vars);
        if (fam) return fam;
      }
    }
  }
  return undefined;
}

// Icon/glyph fonts are not text typography — never adopt them as a heading/body face, and don't
// self-host them in foundation mode (the foreign CSS that referenced them is discarded).
const ICON_FONT = /(font[\s-]?awesome|^fa[\s-]|icomoon|glyphicons?|material[\s-]?icons|ionicons|feather|bootstrap[\s-]?icons|dashicons|elegant[\s-]?icons|themify)/i;
export function isIconFont(family: string | undefined): boolean {
  return !!family && ICON_FONT.test(family);
}

const FAMILY_OK = /^[A-Za-z0-9][A-Za-z0-9 '-]*$/; // FontFamilyNameSchema

export interface HostedFont {
  family: string;
  assetId: string;
  weight: number;
  style: string;
}

const norm = (s: string): string => s.toLowerCase().replace(/['"]/g, '').replace(/\s+/g, '-').trim();

function slotFor(font: HostedFont, weight: FontSlot['weight']): FontSlot {
  return { source: 'asset', family: FAMILY_OK.test(font.family) ? font.family : 'sans-serif', assetId: font.assetId, weight };
}

/**
 * @font-face families that are LOCAL()-only (a system-font ALIAS, e.g. `--primary-font` →
 * `@font-face{font-family:"primary-font";src:local("Times New Roman")}`) → the local family. These have no
 * woff to self-host, so they never appear in `fonts` — but the role IS resolved (to a system font), which
 * must stop the "other font" fallback from adopting a hosted DISPLAY woff for it.
 */
function localSystemFaces(cssText: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of cssText.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const block = m[1] ?? '';
    if (/\burl\s*\(/i.test(block)) continue; // has a hostable url() → not local-only
    const fam = block.match(/font-family\s*:\s*["']?([^;"'}]+)/i)?.[1]?.trim();
    const local = block.match(/\blocal\s*\(\s*["']?([^)"']+)/i)?.[1]?.trim();
    if (fam && local && !out.has(norm(fam))) out.set(norm(fam), local); // first @font-face wins (CSS cascade)
  }
  return out;
}

/**
 * @font-face family → its FIRST hostable src `url()`. A site often aliases ONE woff under several family
 * names (`@font-face{font-family:"primary-font";src:url(gotham.woff)}` AND `…"text-font"…src:url(gotham.woff)}`)
 * and uses `--primary-font` for headings, `--text-font` for body. The content-hash media dedup hosts that woff
 * ONCE (under whichever family it first saw), so a name-only match drops every OTHER alias (e.g. body). This
 * map lets {@link extractTypography} resolve any alias to the hosted asset that shares its src url. (Requires
 * the hosted font's own family to appear in an @font-face block of THIS cssText — always true for imports,
 * where the hosted woffs come from these very @font-face rules; else the role degrades to unresolved.)
 */
function fontFaceFamilyUrls(cssText: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of cssText.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const block = m[1] ?? '';
    const fam = block.match(/font-family\s*:\s*["']?([^;"'}]+)/i)?.[1]?.trim();
    const url = block.match(/\burl\s*\(\s*["']?([^)"']+)/i)?.[1]?.trim();
    if (fam && url && !out.has(norm(fam))) out.set(norm(fam), url); // first @font-face wins (CSS cascade)
  }
  return out;
}

/**
 * Resolve heading + body font slots from the foreign CSS, matched to the self-hosted woffs.
 * Matches by family name (or by a shared @font-face src url, so ALIAS families that dedup to one hosted woff
 * still resolve); a role declared via a LOCAL()-only @font-face resolves to a SYSTEM slot; only when a role
 * has NO family signal at all does it fall back to "the other font" (the common heading+body pair).
 */
export function extractTypography(cssText: string, fonts: readonly HostedFont[]): { heading?: FontSlot; body?: FontSlot; named?: Record<string, FontSlot> } {
  // Drop icon/glyph fonts — they're never a text face (and must not be picked by the fallback below).
  const distinct = [...new Map(fonts.filter((f) => !ICON_FONT.test(f.family)).map((f) => [f.assetId, f])).values()];
  const vars = readCssVars(cssText);
  // Prefer the semantic `--*-font` var; fall back to scanning the body/heading selectors.
  const bodyFam = familyFromVars(vars, 'body') ?? familyForSelectors(cssText, ['body', 'html'], vars);
  const headFam = familyFromVars(vars, 'heading') ?? familyForSelectors(cssText, ['h1', 'h2', 'h3', 'heading', 'title', 'bm-header'], vars);
  const localFaces = localSystemFaces(cssText);
  const localSlot = (fam: string | undefined, weight: FontSlot['weight']): FontSlot | undefined => {
    const local = fam ? localFaces.get(norm(fam)) : undefined;
    if (local === undefined) return undefined;
    return { source: 'system', family: FAMILY_OK.test(local) ? local : 'serif', weight };
  };
  // Match by family NAME first; else by a SHARED @font-face src url (alias families that deduped to one woff).
  const familyUrl = fontFaceFamilyUrls(cssText);
  const hostedUrl = (f: HostedFont): string | undefined => familyUrl.get(norm(f.family));
  const match = (fam: string | undefined): HostedFont | undefined => {
    if (!fam) return undefined;
    const direct = distinct.find((f) => norm(f.family) === norm(fam));
    if (direct) return direct;
    const url = familyUrl.get(norm(fam));
    return url ? distinct.find((f) => hostedUrl(f) === url) : undefined;
  };
  let head = match(headFam);
  let body = match(bodyFam);
  // A role whose declared font is a local system alias (e.g. heading = local Times New Roman) is RESOLVED —
  // its slot is the system font, and it must NOT trigger the display-woff fallback below.
  const headSys = head ? undefined : localSlot(headFam, 700);
  const bodySys = body ? undefined : localSlot(bodyFam, 400);
  if (head && !body && !bodySys && distinct.length >= 2) {
    const h = head;
    body = distinct.find((f) => f.assetId !== h.assetId);
  }
  if (body && !head && !headSys && distinct.length >= 2) {
    const b = body;
    head = distinct.find((f) => f.assetId !== b.assetId);
  }
  if (!head && !body && !headSys && !bodySys && distinct.length === 1) body = distinct[0];
  const out: { heading?: FontSlot; body?: FontSlot; named?: Record<string, FontSlot> } = {};
  if (head) out.heading = slotFor(head, 700);
  else if (headSys) out.heading = headSys;
  if (body) out.body = slotFor(body, 400);
  else if (bodySys) out.body = bodySys;

  // Capture ADDITIONAL foreign faces (secondary/tertiary/accent + any leftover distinct woff) into NAMED
  // slots so EVERY foreign font self-hosts — it keeps loading after nativize strips the foreign stylesheet,
  // and is exposed as a `font-<name>` utility + `--sw-font-<name>` var for the nativized markup to use.
  // Faces already adopted as heading/body (or their aliases) are skipped so a name that just re-points at
  // the body woff doesn't duplicate it.
  const named: Record<string, FontSlot> = {};
  const usedIds = new Set<string>([head?.assetId, body?.assetId].filter((x): x is string => !!x));
  const usedNames = new Set<string>();
  const addNamed = (name: string, font: HostedFont): void => {
    if (usedIds.has(font.assetId) || usedNames.has(name) || RESERVED_FONT_SLOT_NAMES.has(name) || usedNames.size >= MAX_NAMED_FONTS) return;
    // Weight 400 like the heading slot's hardcoded 700 — the @font-face is emitted per stored FILE at the
    // file's OWN weight (typography-css), so the slot weight just picks the default request; a fixed value
    // keeps it schema-valid (an odd captured weight could fail FontWeightSchema).
    named[name] = slotFor(font, 400);
    usedIds.add(font.assetId);
    usedNames.add(name);
  };
  // 1) A recognized secondary/tertiary/accent var → a slot named for its role.
  for (const [re, name] of NAMED_FONT_VAR_MAP) {
    for (const [vn, raw] of vars) {
      if (!re.test(vn)) continue;
      const f = match(familyName(raw, vars));
      if (f) addNamed(name, f);
    }
  }
  // 2) Any remaining distinct hosted face → a generic `font-N` slot, so nothing is silently lost. Numbering
  //    starts at 2 (heading+body are the primary 1st/2nd faces, so a leftover reads as the 3rd+). The while
  //    guards against a FUTURE NAMED_FONT_VAR_MAP entry that coincidentally produced a `font-N` name in
  //    step 1 (none do today — secondary/tertiary/accent — so it's currently defensive).
  let idx = 2;
  for (const f of distinct) {
    if (usedIds.has(f.assetId)) continue;
    let name = `font-${idx++}`;
    while (usedNames.has(name)) name = `font-${idx++}`;
    addNamed(name, f);
  }
  if (Object.keys(named).length) out.named = named;
  return out;
}

// ─────────────────────────────── reusable site CSS (criticalCss) ───────────────────────────────

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E\")";
const SQUARES =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='280'%3E%3Cg fill='none' stroke='%23ffffff' stroke-width='2' opacity='0.16'%3E%3Crect x='24' y='34' width='74' height='74' rx='13'/%3E%3Crect x='312' y='18' width='92' height='92' rx='15'/%3E%3Crect x='168' y='168' width='62' height='62' rx='11'/%3E%3C/g%3E%3Cg fill='%23ffffff' opacity='0.09'%3E%3Crect x='118' y='66' width='54' height='54' rx='11'/%3E%3Crect x='250' y='138' width='86' height='86' rx='15'/%3E%3C/g%3E%3C/svg%3E\")";

/**
 * The source's real body/html background-image, with url()s rewritten to the self-hosted /media refs
 * (the assets were hosted during the import's media pass even in foundation mode). Returns '' when the
 * source declares no body background-image or it can't be resolved to a hosted asset — the caller then
 * falls back to the generic NOISE texture. Captures the ACTUAL site texture (e.g. a brushed-metal PNG)
 * instead of approximating it, so a clone reads like the original.
 */
export function extractBodyBgImage(cssText: string, assetMap: ReadonlyMap<string, string>): string {
  let img = '';
  // Last body/html rule wins (cascade). Only the background-image longhand (or a shorthand carrying a url).
  for (const m of cssText.matchAll(/(?:^|[};,>\s])(?:html|body)\b[^{}]*\{([^{}]*)\}/gi)) {
    const block = m[1] ?? '';
    const bi = block.match(/background-image\s*:\s*([^;}]+)/i)?.[1] ?? block.match(/background\s*:\s*([^;}]*url\([^;}]*)/i)?.[1];
    if (bi && /url\(/i.test(bi)) img = bi.trim();
  }
  if (!img) return '';
  const rewritten = rewriteCssUrls(img, assetMap);
  // Ship ONLY a hosted /media ref or an inline data: texture — never an unresolved foreign hotlink.
  return /url\(\s*['"]?(?:\/media\/|data:)/i.test(rewritten) ? rewritten : '';
}

/** Reusable site CSS: page background, the `.bp-hero` colored-band texture, and `.bp-card` elevation.
 *  `bodyImage` (when given) is the source's REAL body background-image; else the generic NOISE texture. */
export function foundationCriticalCss(bg = '#e9e9ec', bodyImage?: string): string {
  const image = bodyImage && bodyImage.trim() ? bodyImage.trim() : NOISE;
  return [
    `body{background-color:${isColor(bg) ? bg : '#e9e9ec'};background-image:${image};}`,
    `.bp-hero{position:relative;overflow:hidden;}`,
    `.bp-hero::before{content:"";position:absolute;inset:0;background-image:${SQUARES};background-size:420px 280px;background-position:center;pointer-events:none;}`,
    `.bp-hero>*{position:relative;}`,
    `.bp-card{box-shadow:0 8px 17px rgba(0,0,0,.16),0 6px 20px rgba(0,0,0,.10);}`,
  ].join('\n');
}

/**
 * The header/nav's decorative FLANKING images. A site often pins two illustrations to the header's left+right
 * edges via `#nav::before`/`::after { background-image:url(...) }` (droombos: `#top-nav:before` → header-left.png,
 * `#top-nav:after` → header-right.png). The generic native navbar drops them; capture the pair (resolved to
 * hosted `/media` refs — never a foreign hotlink) so {@link nativeMainNav} can re-pin them. `{}` when the source
 * has no such decorations. Classifies each by background-position, else filename, else `::before`=left/`::after`=right.
 */
export function extractHeaderDecor(cssText: string, assetMap: ReadonlyMap<string, string>): { left?: string; right?: string } {
  const out: { left?: string; right?: string } = {};
  // A ref is trusted ONLY if it's an actual assetMap VALUE — a raw `/media/…` shape in the CSS isn't enough
  // (a crafted `url(/media/../api/users)` that assetKey can't resolve would pass rewriteCssUrls unchanged and
  // then string-match `/media/`, letting a traversal path into the `<img src>`). Membership makes that impossible.
  const hostedRefs = new Set(assetMap.values());
  // `[#.]?[\w-]+` matches an id/class/BARE-TAG selector (`#top-nav`, `.masthead`, `header`) — a single token
  // (O(n), no ReDoS); the keyword guard below scopes it to header/nav elements. A compound/list selector is
  // matched by its last simple selector, which the guard then filters. Cap the input + early-out (only 2 slots).
  const css = cssText.length > 524_288 ? cssText.slice(0, 524_288) : cssText;
  for (const m of css.matchAll(/([#.]?[\w-]+)\s*::?(before|after)\s*\{([^}]*)\}/gi)) {
    if (out.left && out.right) break; // both edges filled — nothing more to find
    const sel = m[1] ?? '';
    const pseudo = (m[2] ?? '').toLowerCase();
    const block = m[3] ?? '';
    if (!/nav|header|masthead|topbar/i.test(sel)) continue; // header/nav-like element only
    const rawUrl = block.match(/background(?:-image)?\s*:[^;}]*url\(\s*['"]?([^)'"]+)/i)?.[1];
    if (!rawUrl) continue;
    const ref = rewriteCssUrls(`url(${rawUrl})`, assetMap).match(/url\(\s*['"]?(\/media\/[^)'"\s]+)/i)?.[1];
    if (!ref || !hostedRefs.has(ref)) continue; // ship ONLY a genuinely-hosted asset (assetMap membership)
    const pos = block.match(/background-position\s*:\s*([^;}]+)/i)?.[1] ?? '';
    const url = rawUrl.toLowerCase();
    // Classify by background-position keyword, else a DELIMITED left/right SEGMENT in the filename (so
    // `brightwood`/`upleft-x` don't false-match), else `::before`=left / `::after`=right.
    const side: 'left' | 'right' =
      /\bright\b/.test(pos.toLowerCase()) || /(?:^|[-_./])right(?:[-_.]|$)/.test(url) ? 'right'
        : /\bleft\b/.test(pos.toLowerCase()) || /(?:^|[-_./])left(?:[-_.]|$)/.test(url) ? 'left'
          : pseudo === 'after' ? 'right' : 'left';
    if (!out[side]) out[side] = ref; // first rule wins (CSS cascade)
  }
  return out;
}

// ─────────────────────────────── native chrome ───────────────────────────────

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Data-driven Main Navigation (R13): the menu is GENERATED from the page tree via `{{#each nav.header}}`
 * — desktop bar (hover dropdowns) + a mobile drawer. Goes in the single `website.mainNav` slot (the
 * platform wraps it in `<nav id="main-nav">`, so no `<nav>` here). Models the global `navbar` recipe.
 */
export function nativeMainNav(identity: Pick<CorporateIdentity, 'name' | 'logo'>, decor: { left?: string; right?: string } = {}): string {
  const logo = identity.logo ? `<img src="${esc(identity.logo)}" alt="${esc(identity.name)} logo" class="h-12 w-auto"/>` : '';
  const brand = logo || `<span class="text-lg font-bold text-primary">${esc(identity.name)}</span>`;
  // Captured header decorations pinned to the bar's left/right edges (desktop only, behind the nav content,
  // non-interactive + aria-hidden). Present only when the source had them; else the bar renders decor-free.
  const decorImg = (ref: string | undefined, side: 'left' | 'right'): string =>
    ref ? `<img src="${esc(ref)}" alt="" aria-hidden="true" class="pointer-events-none absolute ${side}-0 top-0 z-0 hidden h-full w-auto max-w-[160px] object-contain lg:block"/>` : '';
  const decoration = decorImg(decor.left, 'left') + decorImg(decor.right, 'right');
  const relative = decoration ? ' relative' : '';
  const z = decoration ? 'relative z-10 ' : '';
  const desktopItem =
    `{{#each nav.header}}{{#if children}}<li class="dropdown dropdown-hover">` +
    `<a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}">{{sw-label}} {{sw-icon "chevron-down" "h-4 w-4 opacity-60"}}</a>` +
    `<ul class="dropdown-content menu z-30 w-56 rounded-box border border-base-200 bg-base-100 p-2 shadow-xl">{{#each children}}<li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}">{{sw-label}}</a></li>{{/each}}</ul></li>` +
    `{{else}}<li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}"{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{sw-label}}</a></li>{{/if}}{{/each}}`;
  const mobileItem =
    `{{#each nav.header}}{{#if children}}<li class="menu-title text-primary">{{sw-label}}</li>{{#each children}}<li><a href="{{sw-url path}}">{{sw-label}}</a></li>{{/each}}` +
    `{{else}}<li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}}>{{sw-label}}</a></li>{{/if}}{{/each}}`;
  return (
    `<div class="navbar${relative} min-h-0 bg-base-100 px-3 py-1.5 shadow-md sm:px-5">` +
    decoration +
    `<div class="${z}flex-1"><a href="{{sw-url '/'}}" class="flex items-center gap-2 no-underline">${brand}</a></div>` +
    `<div class="${z}hidden flex-none lg:block"><ul class="menu menu-horizontal items-center gap-0.5 px-1 text-[15px] font-medium">${desktopItem}</ul></div>` +
    `<div class="${z}flex-none lg:hidden"><div class="dropdown dropdown-end"><div tabindex="0" role="button" class="btn btn-ghost btn-sm">{{sw-icon "menu" "h-5 w-5"}}</div>` +
    `<ul tabindex="0" class="menu dropdown-content z-30 mt-2 w-64 gap-0.5 rounded-box bg-base-100 p-2 text-[15px] shadow-lg">${mobileItem}</ul></div></div>` +
    `</div>`
  );
}

/** A clean native footer from identity (company + contact + optional map + copyright). Agents may enrich it later. */
export function nativeFooter(identity: Pick<CorporateIdentity, 'name' | 'email' | 'telephone' | 'mapUrl'>): string {
  // The CURRENT year via the real helper — `{{year}}` is NOT a binding (it renders empty/literal); the
  // engine's date helper always resolves to this year, so the copyright never goes stale.
  const year = '{{sw-date "now" "YYYY"}}';
  const contacts: string[] = [];
  if (identity.telephone) contacts.push(`<a href="tel:${esc(identity.telephone.replace(/\s+/g, ''))}" class="inline-flex items-center gap-1.5 hover:text-primary">{{sw-icon "phone" "h-4 w-4 text-primary"}}${esc(identity.telephone)}</a>`);
  if (identity.email) contacts.push(`<a href="mailto:${esc(identity.email)}" class="inline-flex items-center gap-1.5 hover:text-primary">{{sw-icon "mail" "h-4 w-4 text-primary"}}${esc(identity.email)}</a>`);
  // The original's footer Google-Maps embed (captured into identity.mapUrl, allow-listed host only). Data-driven
  // via the {{sw-url company.mapUrl}} HELPER — NOT a bare `{{company.mapUrl}}`, which validateTemplate rejects as
  // "a bare value in a URL attribute" (it renders on the no-validation import path but then BLOCKS every later
  // settings save, whose validateSourceOnSave re-validates the chrome slots). sw-url passes validation and returns
  // an absolute external https URL unchanged. A skeleton placeholder shows while it loads. Only when the source had
  // a map — else the footer stays map-free. The iframe is SANDBOXED (the map still works with allow-scripts/
  // -same-origin/-popups/-forms) so the embedded page can't navigate the top-level context. When the consent
  // manager is ENABLED, gateAuthorIframes turns this into a click-to-load embed like any other cross-origin iframe
  // (a Maps embed does set Google cookies); with consent off it loads inline. applyFoundation validates mapUrl
  // (AbsoluteUrlSchema → https-only) before calling; re-check the scheme here as defence-in-depth so a DIRECT caller
  // can't emit a non-http(s) iframe src.
  const hasMap = !!identity.mapUrl && /^https?:\/\//i.test(identity.mapUrl);
  const map = hasMap
    ? `<iframe src="{{sw-url company.mapUrl}}" title="Map" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen sandbox="allow-scripts allow-same-origin allow-popups allow-forms" class="skeleton h-64 w-full border-0"></iframe>`
    : '';
  return (
    `<div class="bg-neutral text-neutral-content">` +
    map +
    `<div class="mx-auto flex max-w-screen-xl flex-col items-center gap-4 px-6 py-10 text-center">` +
    `<span class="text-lg font-bold">${esc(identity.name)}</span>` +
    (contacts.length ? `<div class="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">${contacts.join('')}</div>` : '') +
    `</div>` +
    `<div class="bg-primary text-primary-content"><div class="mx-auto max-w-screen-xl px-6 py-3 text-center text-xs">© ${year} ${esc(identity.name)}</div></div>` +
    `</div>`
  );
}

// ─────────────────────────────── page nav config ───────────────────────────────

/** A clean per-page NAV LABEL: the page title minus the site-name suffix/prefix (`Imprint | eTaxi
 *  Worldwide` → `Imprint`), so the menu doesn't leak the imported `<title>` boilerplate (R13b). */
export function cleanNavLabel(title: string, siteName?: string): string {
  let t = (title ?? '').trim();
  const n = (siteName ?? '').trim();
  if (n) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t
      .replace(new RegExp(`\\s*[|\\-–—:·]\\s*${esc}\\s*$`, 'i'), '')
      .replace(new RegExp(`^\\s*${esc}\\s*[|\\-–—:·]\\s*`, 'i'), '')
      .trim();
  }
  return t || (title ?? '').trim();
}

/**
 * Configure page nav so `buildNav('header')` yields the right menu: top-level pages in header+mobile
 * (ordered, dropdown when they have children); children carry NO nav object (they nest via `parent`).
 * Every top-level page gets a clean `nav.title` LABEL (R13b); the home page (path '') → "Home".
 */
export function configurePageNav(pages: Page[], siteName?: string): void {
  const childParentIds = new Set(pages.filter((p) => p.parent).map((p) => p.parent));
  const isHome = (p: Page): boolean => !p.path || p.path === '' || p.path === '/';
  const topLevel = pages.filter((p) => !p.parent && !p.collection).sort((a, b) => {
    if (isHome(a)) return -1;
    if (isHome(b)) return 1;
    return (a.order ?? a.nav?.order ?? 0) - (b.order ?? b.nav?.order ?? 0) || a.title.localeCompare(b.title, 'en');
  });
  let order = 0;
  for (const p of topLevel) {
    const o = order++;
    p.order = o;
    p.nav = {
      slots: ['header'],
      order: o,
      ...(childParentIds.has(p.id) ? { dropdown: true } : {}),
      title: isHome(p) ? 'Home' : cleanNavLabel(p.title, siteName),
    };
  }
  // Children: order within their sibling group; remove any (empty-slots) nav object so the PUT validates
  // and so they nest under the dropdown parent rather than appearing flat.
  const byParent = new Map<string, Page[]>();
  for (const p of pages) if (p.parent) (byParent.get(p.parent) ?? byParent.set(p.parent, []).get(p.parent)!).push(p);
  for (const kids of byParent.values()) {
    kids.sort((a, b) => (a.order ?? a.nav?.order ?? 0) - (b.order ?? b.nav?.order ?? 0) || a.title.localeCompare(b.title, 'en'));
    kids.forEach((kid, i) => {
      kid.order = i;
      delete (kid as { nav?: unknown }).nav;
    });
  }
}

// ─────────────────────────────── orchestration ───────────────────────────────

export interface FoundationInput {
  cssText: string;
  identity: CorporateIdentity;
  website: WebsiteSettings | undefined;
  pages: Page[];
  hostedFonts: readonly HostedFont[];
  /** Foreign-url → hosted `/media` map (from the import's media pass); lets the body background-image be
   *  captured as the REAL self-hosted texture rather than a generic approximation. */
  assetMap?: ReadonlyMap<string, string>;
}
export interface FoundationResult {
  identity: CorporateIdentity;
  website: WebsiteSettings;
  pages: Page[];
  diagnostics: ImportDiagnostic[];
}

/** Apply the full foundation: theme + fonts + native chrome + page nav, discarding foreign CSS/JS. */
export function applyFoundation(input: FoundationInput): FoundationResult {
  const diagnostics: ImportDiagnostic[] = [];
  const extractedColors = extractColors(input.cssText); // parse the foreign CSS palette once
  const colors = { ...input.identity.colors, ...extractedColors };
  const extractedTypo = extractTypography(input.cssText, input.hostedFonts);
  const baseTypo = input.identity.typography;
  const baseNamed = baseTypo?.named;
  // Merge NAMED slots (don't let a spread of extractedTypo clobber the incoming identity's named fonts).
  const typography = {
    ...(baseTypo ?? {}),
    ...extractedTypo,
    ...(extractedTypo.named || baseNamed ? { named: { ...baseNamed, ...extractedTypo.named } } : {}),
  };
  const identity = CorporateIdentitySchema.parse({ ...input.identity, colors, typography });

  const websiteIn: Record<string, unknown> = { ...(input.website ?? {}) };
  // KEEP the foreign stylesheet <link> in head: the mechanical nativize reads real computed styles from a
  // headless screenshot, and without the CSS the page renders unstyled (every custom-class layout collapses
  // to a plain block). Nativize strips this link again at finalize, so the PUBLISHED site stays clean; a
  // foundation scaffold used WITHOUT nativize simply renders styled by its own sheet until authored.
  delete websiteIn.scripts; // drop the foreign scripts (never needed for the capture)
  // The foreign sidebar is removed (its markup uses foreign classes the discarded CSS styled) — but say
  // so loudly so the author rebuilds it natively if the design needs it (R28), rather than losing it silently.
  const hadSidebar = !!((websiteIn.sidebarLeft as string)?.trim?.() || (websiteIn.sidebarRight as string)?.trim?.());
  delete websiteIn.sidebarLeft;
  delete websiteIn.sidebarRight;
  const bodyImage = input.assetMap ? extractBodyBgImage(input.cssText, input.assetMap) : '';
  websiteIn.criticalCss = foundationCriticalCss(colors['base-200'], bodyImage);
  const contentWidth = extractContentWidth(input.cssText);
  if (contentWidth) websiteIn.containerWidth = contentWidth; // match the source's content width (default is 1200)
  const headerDecor = input.assetMap ? extractHeaderDecor(input.cssText, input.assetMap) : {};
  websiteIn.mainNav = nativeMainNav(identity, headerDecor); // single consolidated nav slot (+ captured edge decorations)
  websiteIn.footer = nativeFooter(identity);
  const website = WebsiteSettingsSchema.parse(websiteIn);

  configurePageNav(input.pages, identity.name);

  if (hadSidebar) {
    diagnostics.push({ code: 'sidebar-discarded', message: 'foreign sidebar/off-canvas removed — rebuild it natively if the design needs it (author rule R28)' });
  }
  if (identity.mapUrl) {
    diagnostics.push({ code: 'footer-map-embedded', message: 'the source\'s Google-Maps embed was reproduced in the native footer via {{company.mapUrl}} — move/restyle it if the design places it elsewhere' });
  }
  if (headerDecor.left || headerDecor.right) {
    diagnostics.push({ code: 'header-decor-captured', message: 'the header\'s left/right decorative images (#nav::before/::after backgrounds) were re-pinned to the native navbar edges (desktop) — restyle/reposition if the design needs it' });
  }

  const namedCount = extractedTypo.named ? Object.keys(extractedTypo.named).length : 0;
  const fontNote = extractedTypo.heading || extractedTypo.body ? (namedCount ? `fonts+${namedCount}named` : 'fonts') : 'no-fonts';
  const colorNote = Object.keys(extractedColors).join('/') || 'defaults';
  const bgNote = bodyImage ? 'real-texture' : 'noise-texture';
  diagnostics.push({ code: 'foundation-applied', message: `native foundation: colors=${colorNote}, ${fontNote}, ${bgNote}, data-driven nav + footer, foreign js discarded; foreign css kept for the nativize capture (stripped at finalize — publish/author it away if you skip nativize)` });
  return { identity, website, pages: input.pages, diagnostics };
}
