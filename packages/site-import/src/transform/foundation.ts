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
//               into criticalCss; DISCARD the foreign stylesheet link + scripts (head/scripts cleared).
import type { CorporateIdentity, FontSlot, Page, WebsiteSettings } from '@sitewright/schema';
import { CorporateIdentitySchema, WebsiteSettingsSchema } from '@sitewright/schema';
import type { ImportDiagnostic } from '../types.js';

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

/** The font-family declared on the first matching selector (var()s resolved to a single family name). */
function familyForSelectors(cssText: string, selectors: readonly string[], vars: Map<string, string>): string | undefined {
  for (const sel of selectors) {
    // a rule whose selector LIST contains `sel` as a standalone token, with a font-family declaration
    const re = new RegExp(`(?:^|[},])\\s*[^{}]*\\b${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^{}]*\\{([^{}]*font-family[^{}]*)\\}`, 'i');
    const block = cssText.match(re)?.[1];
    if (!block) continue;
    const value = block.match(/font-family\s*:\s*([^;}]+)/i)?.[1];
    if (!value) continue;
    // take the FIRST family token, then resolve a var() to a single family name (strip quotes)
    const firstToken = (value.split(',')[0] ?? '').trim();
    const first = (resolveVar(firstToken, vars).split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');
    if (first && !/^(inherit|initial|unset)$/i.test(first)) return first;
  }
  return undefined;
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
 * Resolve heading + body font slots from the foreign CSS, matched to the self-hosted woffs.
 * Matches by family name; falls back to "the other font" when exactly one side matches and ≥2 fonts
 * exist (the common heading+body pairing), or the single font for body when only one is hosted.
 */
export function extractTypography(cssText: string, fonts: readonly HostedFont[]): { heading?: FontSlot; body?: FontSlot } {
  const distinct = [...new Map(fonts.map((f) => [f.assetId, f])).values()];
  if (distinct.length === 0) return {};
  const vars = readCssVars(cssText);
  const bodyFam = familyForSelectors(cssText, ['body', 'html'], vars);
  const headFam = familyForSelectors(cssText, ['h1', 'h2', 'h3', 'heading', 'title', 'bm-header'], vars);
  const match = (fam: string | undefined): HostedFont | undefined => (fam ? distinct.find((f) => norm(f.family) === norm(fam)) : undefined);
  let head = match(headFam);
  let body = match(bodyFam);
  if (head && !body && distinct.length >= 2) {
    const h = head;
    body = distinct.find((f) => f.assetId !== h.assetId);
  }
  if (body && !head && distinct.length >= 2) {
    const b = body;
    head = distinct.find((f) => f.assetId !== b.assetId);
  }
  if (!head && !body && distinct.length === 1) body = distinct[0];
  const out: { heading?: FontSlot; body?: FontSlot } = {};
  if (head) out.heading = slotFor(head, 700);
  if (body) out.body = slotFor(body, 400);
  return out;
}

// ─────────────────────────────── reusable site CSS (criticalCss) ───────────────────────────────

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E\")";
const SQUARES =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='280'%3E%3Cg fill='none' stroke='%23ffffff' stroke-width='2' opacity='0.16'%3E%3Crect x='24' y='34' width='74' height='74' rx='13'/%3E%3Crect x='312' y='18' width='92' height='92' rx='15'/%3E%3Crect x='168' y='168' width='62' height='62' rx='11'/%3E%3C/g%3E%3Cg fill='%23ffffff' opacity='0.09'%3E%3Crect x='118' y='66' width='54' height='54' rx='11'/%3E%3Crect x='250' y='138' width='86' height='86' rx='15'/%3E%3C/g%3E%3C/svg%3E\")";

/** Reusable site CSS: page background, the `.bp-hero` colored-band texture, and `.bp-card` elevation. */
export function foundationCriticalCss(bg = '#e9e9ec'): string {
  return [
    `body{background-color:${isColor(bg) ? bg : '#e9e9ec'};background-image:${NOISE};}`,
    `.bp-hero{position:relative;overflow:hidden;}`,
    `.bp-hero::before{content:"";position:absolute;inset:0;background-image:${SQUARES};background-size:420px 280px;background-position:center;pointer-events:none;}`,
    `.bp-hero>*{position:relative;}`,
    `.bp-card{box-shadow:0 8px 17px rgba(0,0,0,.16),0 6px 20px rgba(0,0,0,.10);}`,
  ].join('\n');
}

// ─────────────────────────────── native chrome ───────────────────────────────

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Data-driven Main Navigation (R13): the menu is GENERATED from the page tree via `{{#each nav.header}}`
 * — desktop bar (hover dropdowns) + a mobile drawer. Goes in the single `website.mainNav` slot (the
 * platform wraps it in `<nav id="main-nav">`, so no `<nav>` here). Models the global `navbar` recipe.
 */
export function nativeMainNav(identity: Pick<CorporateIdentity, 'name' | 'logo'>): string {
  const logo = identity.logo ? `<img src="${esc(identity.logo)}" alt="${esc(identity.name)} logo" class="h-12 w-auto"/>` : '';
  const brand = logo || `<span class="text-lg font-bold text-primary">${esc(identity.name)}</span>`;
  const desktopItem =
    `{{#each nav.header}}{{#if children}}<li class="dropdown dropdown-hover">` +
    `<a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}">{{sw-label}} {{sw-icon "chevron-down" "h-4 w-4 opacity-60"}}</a>` +
    `<ul class="dropdown-content menu z-30 w-56 rounded-box border border-base-200 bg-base-100 p-2 shadow-xl">{{#each children}}<li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}">{{sw-label}}</a></li>{{/each}}</ul></li>` +
    `{{else}}<li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}"{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{sw-label}}</a></li>{{/if}}{{/each}}`;
  const mobileItem =
    `{{#each nav.header}}{{#if children}}<li class="menu-title text-primary">{{sw-label}}</li>{{#each children}}<li><a href="{{sw-url path}}">{{sw-label}}</a></li>{{/each}}` +
    `{{else}}<li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}}>{{sw-label}}</a></li>{{/if}}{{/each}}`;
  return (
    `<div class="navbar min-h-0 bg-base-100 px-3 py-1.5 shadow-md sm:px-5">` +
    `<div class="flex-1"><a href="{{sw-url '/'}}" class="flex items-center gap-2 no-underline">${brand}</a></div>` +
    `<div class="hidden flex-none lg:block"><ul class="menu menu-horizontal items-center gap-0.5 px-1 text-[15px] font-medium">${desktopItem}</ul></div>` +
    `<div class="flex-none lg:hidden"><div class="dropdown dropdown-end"><div tabindex="0" role="button" class="btn btn-ghost btn-sm">{{sw-icon "menu" "h-5 w-5"}}</div>` +
    `<ul tabindex="0" class="menu dropdown-content z-30 mt-2 w-64 gap-0.5 rounded-box bg-base-100 p-2 text-[15px] shadow-lg">${mobileItem}</ul></div></div>` +
    `</div>`
  );
}

/** A clean native footer from identity (company + contact + copyright). Agents may enrich it later. */
export function nativeFooter(identity: Pick<CorporateIdentity, 'name' | 'email' | 'telephone'>): string {
  const year = '{{year}}';
  const contacts: string[] = [];
  if (identity.telephone) contacts.push(`<a href="tel:${esc(identity.telephone.replace(/\s+/g, ''))}" class="inline-flex items-center gap-1.5 hover:text-primary">{{sw-icon "phone" "h-4 w-4 text-primary"}}${esc(identity.telephone)}</a>`);
  if (identity.email) contacts.push(`<a href="mailto:${esc(identity.email)}" class="inline-flex items-center gap-1.5 hover:text-primary">{{sw-icon "mail" "h-4 w-4 text-primary"}}${esc(identity.email)}</a>`);
  return (
    `<div class="bg-neutral text-neutral-content">` +
    `<div class="mx-auto flex max-w-screen-xl flex-col items-center gap-4 px-6 py-10 text-center">` +
    `<span class="text-lg font-bold">${esc(identity.name)}</span>` +
    (contacts.length ? `<div class="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">${contacts.join('')}</div>` : '') +
    `</div>` +
    `<div class="bg-primary text-primary-content"><div class="mx-auto max-w-screen-xl px-6 py-3 text-center text-xs">© ${year} ${esc(identity.name)}</div></div>` +
    `</div>`
  );
}

// ─────────────────────────────── page nav config ───────────────────────────────

/**
 * Configure page nav so `buildNav('header')` yields the right menu: top-level pages in header+mobile
 * (ordered, dropdown when they have children); children carry NO nav object (they nest via `parent`).
 * The home page (path '') gets nav.title "Home".
 */
export function configurePageNav(pages: Page[]): void {
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
    p.nav = { slots: ['header'], order: o, ...(childParentIds.has(p.id) ? { dropdown: true } : {}), ...(isHome(p) ? { title: 'Home' } : {}) };
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
  const colors = { ...input.identity.colors, ...extractColors(input.cssText) };
  const extractedTypo = extractTypography(input.cssText, input.hostedFonts);
  const typography = { ...input.identity.typography, ...extractedTypo };
  const identity = CorporateIdentitySchema.parse({ ...input.identity, colors, typography });

  const websiteIn: Record<string, unknown> = { ...(input.website ?? {}) };
  delete websiteIn.head; // drop the foreign stylesheet <link>
  delete websiteIn.scripts; // drop the foreign scripts
  delete websiteIn.sidebarLeft;
  delete websiteIn.sidebarRight;
  websiteIn.criticalCss = foundationCriticalCss(colors['base-200']);
  websiteIn.mainNav = nativeMainNav(identity); // single consolidated nav slot
  websiteIn.footer = nativeFooter(identity);
  const website = WebsiteSettingsSchema.parse(websiteIn);

  configurePageNav(input.pages);

  const fontNote = extractedTypo.heading || extractedTypo.body ? 'fonts' : 'no-fonts';
  const colorNote = Object.keys(extractColors(input.cssText)).join('/') || 'defaults';
  diagnostics.push({ code: 'foundation-applied', message: `native foundation: colors=${colorNote}, ${fontNote}, data-driven nav + footer, foreign css/js discarded` });
  return { identity, website, pages: input.pages, diagnostics };
}
