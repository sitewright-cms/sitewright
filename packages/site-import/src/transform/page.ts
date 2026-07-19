// HTML → faithful literal-HTML page source. The output contains NO Handlebars ({{ }}) — which is the
// whole trick: literal HTML with no mustaches passes `validateTemplate` (its URL-attr/style/unquoted
// checks only run inside a mustache). So we only have to obey the structural rules: no <script>, none
// of the four skeleton landmarks (<nav>/<main>/<footer>/<aside>), no on* handlers, and no stray `{{`.
import { validateTemplate } from '@sitewright/blocks';
import { removeElement, replaceElement, textContent } from 'domutils';
import { isComment, Text } from 'domhandler';
import {
  elements,
  eachTextLike,
  getBody,
  isTag,
  neutralizeMustaches,
  prettySerialize,
  type AnyNode,
  type Document,
  type Element,
} from '../dom.js';
import { assetKey, pickFromSrcset, resolveUrl, rewriteHref, SYNTHETIC_HOST } from '../url-util.js';
import { LAZY_ATTRS, effectiveBg, effectiveSrc, effectiveSrcset } from './assets.js';
import { mapAosAnimation, AOS_ATTRS } from './effects.js';
import { mapIconClass, mapMaterialLigature, mapFlagClass, type IconMapping } from './icon-map.js';
import { isAllowedEmbed } from '../embeds.js';
import type { ImportDiagnostic, ImportLimits } from '../types.js';

/** Skeleton-owned landmarks the platform declares once — author content must use a neutral element. */
const LANDMARK_TAGS = new Set(['nav', 'main', 'footer', 'aside']);
/** Elements removed outright from a page source (no execution / no foreign embeds we can't self-host). */
const REMOVE_TAGS = new Set(['script', 'noscript', 'template', 'style', 'object', 'embed', 'applet', 'base']);

/** Foreign "back to top" control idioms (id/class) — the platform injects its OWN back-to-top, so a
 *  duplicate imported one (and any wrapper it leaves empty) is stripped. */
const BACK_TO_TOP_RE = /back-?to-?top|backtotop|scroll-?to-?top|scroll-?top|go-?to-?top|gototop|scroll-?up|\btotop\b|\bbtt\b/i;
const isBackToTop = (el: Element): boolean =>
  (el.name === 'a' || el.name === 'button') && BACK_TO_TOP_RE.test(`${el.attribs.id ?? ''} ${el.attribs.class ?? ''}`);
/** Foreign page PRELOADER / loading overlay (the spinner cover shown on `<body class="loading">`) — the
 *  platform has its own preloader; the imported one nativizes to a stray full-screen / black band. */
const PRELOADER_RE = /\b(?:preloader|pre-loader|page-loader|site-loader|loading-(?:animation|overlay|screen|spinner|wrap|wrapper|container))\b/i;
const matchesPreloader = (el: Element): boolean => PRELOADER_RE.test(`${el.attribs.id ?? ''} ${el.attribs.class ?? ''}`);
/**
 * Does this overlay hold REAL content rather than just a spinner/logo? A heading, a `<form>`, ≥2
 * links/buttons, or ≥60 chars of visible text means the "loading-overlay"/"splash" is actually the page
 * HERO — a common pattern where a site reuses its intro-animation markup as the above-the-fold hero
 * (e.g. `.loading-overlay > .splash-heading + CTAs`). Such a band must NOT be stripped as a preloader,
 * or the whole above-the-fold vanishes. A genuine (transient) preloader has none of these.
 */
export function isContentfulOverlay(el: Element): boolean {
  // Only count a link/button as a CTA when it has a TEXT LABEL — an icon-only `<a><i class="fa-…"></i></a>`
  // (e.g. social icons on a loader screen) is NOT content, so a bare preloader with a couple of social
  // links isn't mistaken for a hero. Returns early once the verdict is settled.
  let ctas = 0;
  const walk = (nodes: Element['children']): boolean => {
    for (const n of nodes) {
      if (!isTag(n)) continue;
      if (/^h[1-6]$/.test(n.name) || n.name === 'form') return true; // a heading or form ⇒ real content
      if ((n.name === 'a' || n.name === 'button') && textContent([n]).trim().length >= 2) {
        ctas += 1;
        if (ctas >= 2) return true; // ≥2 labelled CTAs ⇒ a hero, not a spinner
      }
      if (walk(n.children)) return true;
    }
    return false;
  };
  if (walk(el.children)) return true;
  return textContent([el]).replace(/\s+/g, ' ').trim().length >= 60; // substantial copy ⇒ real content
}
/** A foreign preloader to strip: matches the class/id pattern AND is genuinely content-less (not a hero). */
const isPreloader = (el: Element): boolean => matchesPreloader(el) && !isContentfulOverlay(el);
/** A wrapper with no element children and no non-whitespace text (e.g. once its only child was removed). */
const isEmptyWrapper = (el: Element): boolean => el.children.filter(isTag).length === 0 && textContent([el]).trim() === '';

/**
 * Foreign OFF-CANVAS MOBILE-NAV drawer idioms (id/class) — a hidden slide-in menu that DUPLICATES the
 * site's navigation (Materialize `sidenav`, mmenu, `mobile-nav`, `off-canvas` nav, …). The captured
 * header/footer become the native `mainNav`/`footer` slots and the platform's nav skeleton is already
 * responsive, so an imported drawer is redundant chrome. Worse, its foreign `width:0`/off-screen CSS is
 * dropped on import, so the hidden drawer un-hides into a stray full-width menu band in the page body.
 * Bare `off-canvas`/`offcanvas` is deliberately EXCLUDED (it also names carts/filters/search panels —
 * the {@link isMobileNavDrawer} content guard is the safety net when those tokens DO co-occur with a nav token).
 */
const MOBILE_NAV_RE =
  /\b(?:mobile-?nav(?:igation)?|mobile-?menu|nav-?drawer|menu-?drawer|slide-?menu|push-?menu|off-?canvas-?nav|hamburger-?menu|mmenu|sidenav)\b/i;
/**
 * A foreign mobile-nav drawer safe to strip from a PAGE BODY: id/class matches {@link MOBILE_NAV_RE},
 * it actually carries navigation (≥2 links), and it is NOT a content panel — a heading or a form means
 * it's an off-canvas cart/search/filters panel with real content, so it is kept. Conservative on purpose.
 * (Note: a `<button>` inside a link-only drawer does NOT count as content — only a heading/form does — so
 * a bare menu with a close button is still strippable; that matches the redundant-nav use case.)
 */
function isMobileNavDrawer(el: Element): boolean {
  if (!MOBILE_NAV_RE.test(`${el.attribs.id ?? ''} ${el.attribs.class ?? ''}`)) return false;
  // Count nav links; bail the moment a heading/form appears (⇒ real content, keep it) — mirrors the
  // early-return in isContentfulOverlay so a large content panel isn't traversed in full.
  let links = 0;
  const hasContent = (nodes: Element['children']): boolean => {
    for (const n of nodes) {
      if (!isTag(n)) continue;
      if (/^h[1-6]$/.test(n.name) || n.name === 'form') return true;
      if (n.name === 'a') links += 1;
      if (hasContent(n.children)) return true;
    }
    return false;
  };
  if (hasContent(el.children)) return false;
  return links >= 2;
}

export interface TransformCtx {
  /** This page's own source URL — the base for resolving its relative references. */
  pageUrl: string;
  /** The captured site's base — classifies internal vs external links. */
  siteBase: string;
  /** normalized page URL → FINAL Sitewright route (so links point where pages actually landed). */
  internalRoutes: ReadonlyMap<string, string>;
  /** asset key → hosted `AssetRef` (`/media/...`). */
  assetMap: ReadonlyMap<string, string>;
  /** asset key → responsive WebP `srcset` for hosted images (so `<img>` serves the efficient format). */
  srcsetMap?: ReadonlyMap<string, string>;
  limits: ImportLimits;
}

/** Rewrite an image-bearing URL to its hosted ref; keep an absolute https hotlink; else null (drop). */
export function imageRef(raw: string, ctx: TransformCtx): string | null {
  // Inline data:image URIs are already self-contained — keep them verbatim (no hosting needed).
  if (/^data:image\//i.test(raw.trim())) return raw.trim();
  const key = assetKey(raw, ctx.pageUrl);
  if (key && ctx.assetMap.has(key)) return ctx.assetMap.get(key) ?? null;
  const abs = resolveUrl(raw, ctx.pageUrl);
  if (!abs || !/^https:\/\//i.test(abs)) return null;
  // A miss on the synthetic upload host is a dead link (no real server) → drop it, don't "hotlink".
  try {
    if (new URL(abs).host === SYNTHETIC_HOST) return null;
  } catch {
    return null;
  }
  return abs;
}

/** Rewrite every `url(...)` inside an inline style: hosted ref if known, else absolute https, else left. */
function rewriteStyleUrls(style: string, ctx: TransformCtx): string {
  return style.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, _q: string, url: string) => {
    const ref = imageRef(url, ctx);
    return ref ? `url('${ref}')` : whole;
  });
}

/** Material Icons carry their glyph as LIGATURE TEXT (`<i class="material-icons">home</i>`), so the icon
 *  name is the element's text, not a class — detect the marker class family to route those to the ligature. */
const MATERIAL_ICON_RE = /\bmaterial-(?:icons|symbols)\b/;
/** FA sizing keyword (`fa-2x` … `fa-10x`) → a Tailwind box size the `{{sw-icon}}` svg honors (foreign FA CSS
 *  is dropped on import, so the numeric size must be carried over as a class or the icon renders tiny). */
const FA_SIZE: Readonly<Record<string, string>> = {
  '1': 'h-4 w-4', '2': 'h-8 w-8', '3': 'h-12 w-12', '4': 'h-16 w-16', '5': 'h-20 w-20',
  '6': 'h-24 w-24', '7': 'h-28 w-28', '8': 'h-32 w-32', '9': 'h-36 w-36', '10': 'h-40 w-40',
};
/** Tailwind font-size token → a box size (an icon sized by `text-2xl` on a webfont must become an explicit
 *  svg box; `text-white`/`text-center` and other non-size `text-*` are kept verbatim as color/alignment). */
const TEXT_SIZE_BOX: Readonly<Record<string, string>> = {
  xs: 'h-3 w-3', sm: 'h-4 w-4', base: 'h-4 w-4', lg: 'h-5 w-5', xl: 'h-6 w-6',
  '2xl': 'h-8 w-8', '3xl': 'h-10 w-10', '4xl': 'h-12 w-12', '5xl': 'h-16 w-16', '6xl': 'h-20 w-20',
};
const BOX_CLASS_RE = /^(?:w|h|size|min-w|min-h|max-w|max-h)-/;

/**
 * The size/spacing classes worth carrying onto the mapped `{{sw-icon}}` svg: explicit box dimensions
 * (`w-*`/`h-*`/`size-*`), font-size and FA sizing translated to a box, and margin utilities for spacing.
 * Anything else (colors, layout) is dropped — the platform icon themes with `currentColor`. Always yields a
 * concrete box size (defaulting to `h-5 w-5`), since we pass an explicit class arg to the helper.
 */
function preserveIconSizeClasses(classStr: string, defaultBox = 'h-5 w-5'): string {
  const kept: string[] = [];
  const add = (...cs: string[]): void => { for (const c of cs) if (c && !kept.includes(c)) kept.push(c); };
  for (const t of classStr.split(/\s+/).filter(Boolean)) {
    let m: RegExpMatchArray | null;
    if (BOX_CLASS_RE.test(t)) add(t); // an explicit box dimension — keep as-is
    else if ((m = t.match(/^text-(\S+)$/))) add(...(TEXT_SIZE_BOX[m[1] ?? ''] ?? t).split(' '));
    else if ((m = t.match(/^fa-(\d{1,2})x$/))) add(...(FA_SIZE[m[1] ?? ''] ?? '').split(' ').filter(Boolean));
    else if (/^m[trblxyse]?-\S+$/.test(t)) add(t); // margin/spacing
  }
  if (!kept.some((c) => BOX_CLASS_RE.test(c))) add(...defaultBox.split(' '));
  return kept.join(' ');
}

/** A resolved icon → its `{{sw-icon}}` name (`brand:<slug>` for a brand logo, else the bare Lucide name). */
function iconName(mapping: IconMapping): string {
  return 'brand' in mapping ? `brand:${mapping.brand}` : mapping.icon;
}

/** Resolve an inline `<svg>` to a platform icon ONLY when it carries a clear name hint — a `lucide-<name>`
 *  class, a `data-lucide`/`data-icon`/`data-feather` attr, or a single-word `aria-label`. A nameless svg is
 *  already a clean vector icon (its own paths survive import) and is left untouched. */
function svgIconMapping(el: Element): IconMapping | null {
  const byClass = mapIconClass(el.attribs.class);
  if (byClass) return byClass;
  const hint = el.attribs['data-lucide'] ?? el.attribs['data-icon'] ?? el.attribs['data-feather'] ?? el.attribs['aria-label'];
  return hint ? mapMaterialLigature(hint) : null; // mapMaterialLigature also resolves a bare hyphenated name
}

/**
 * Replace foreign ICON-FONT / sprite markup with the platform's `{{sw-icon}}` helper so imported icons keep
 * rendering after their webfont + stylesheet are dropped. Matches leaf `<i>`/`<span>` whose class is a known
 * icon set (FontAwesome/Bootstrap/Ionicons/Feather/Glyphicons — via {@link mapIconClass}), Material Icons
 * (whose glyph is the ligature TEXT), and hinted inline `<svg>`s. Anything without a platform equivalent is
 * LEFT UNCHANGED. Returns the emitted mustache text nodes so the caller's mustache-neutralizing pass skips
 * them (they are the one intentional `{{ }}` in an otherwise literal-HTML source).
 */
function mapForeignIcons(nodes: AnyNode[], ctx: TransformCtx, diags: ImportDiagnostic[]): Set<{ data: string }> {
  const emitted = new Set<{ data: string }>();
  for (const el of elements(nodes)) {
    if (!el.parent) continue; // detached by an earlier replacement in this same pass → skip
    const cls = el.attribs.class ?? '';
    let mustache = '';
    let label = '';
    let target = '';
    if (el.name === 'i' || el.name === 'span') {
      if (el.children.some(isTag)) continue; // a wrapper holding real elements is not a bare icon carrier
      const flag = mapFlagClass(cls); // a country flag uses the SEPARATE {{sw-flag}} helper (own default size)
      if (flag) {
        target = `flag:${flag.flag}`;
        mustache = `{{sw-flag "${flag.flag}" "${preserveIconSizeClasses(cls, 'h-4')}"}}`;
        label = iconSourceLabel(cls);
      } else {
        let mapping: IconMapping | null;
        if (MATERIAL_ICON_RE.test(cls)) {
          const ligature = textContent([el]).trim();
          mapping = mapMaterialLigature(ligature);
          label = `material:${ligature}`;
        } else {
          mapping = mapIconClass(cls);
          label = iconSourceLabel(cls);
        }
        if (!mapping) continue;
        target = iconName(mapping);
        mustache = `{{sw-icon "${target}" "${preserveIconSizeClasses(cls)}"}}`;
      }
    } else if (el.name === 'svg') {
      const mapping = svgIconMapping(el);
      if (!mapping) continue;
      target = iconName(mapping);
      mustache = `{{sw-icon "${target}" "${preserveIconSizeClasses(cls)}"}}`;
      label = `<svg> ${iconSourceLabel(cls) || (el.attribs['data-lucide'] ?? el.attribs['data-icon'] ?? el.attribs['aria-label'] ?? '')}`.trim();
    } else {
      continue;
    }
    const node = new Text(mustache);
    replaceElement(el, node);
    emitted.add(node);
    diags.push({ code: 'icon-mapped', message: `${label} → ${target}`, page: ctx.pageUrl });
  }
  return emitted;
}

/** The foreign icon-class token to name in a diagnostic (`fa-facebook`, `bi-telephone`, …), else the first class. */
function iconSourceLabel(cls: string): string {
  for (const t of cls.split(/\s+/).filter(Boolean)) {
    if (/^(?:fa|bi|ion|feather|glyphicon|lucide|flag-icon|flag|fi)-/.test(t)) return t;
  }
  return cls.trim().split(/\s+/)[0] ?? 'icon';
}

/**
 * Mutate a set of nodes (and their descendants) into source-safe literal HTML: rename landmarks, drop
 * forbidden elements, strip on* and data-sw-* attributes, rewrite URLs (links → routes, images → hosted
 * refs), map foreign icons to `{{sw-icon}}`, and neutralize stray `{{`. Pushes diagnostics for anything
 * dropped/changed materially.
 */
export function sanitizeForSource(nodes: AnyNode[], ctx: TransformCtx, diags: ImportDiagnostic[]): void {
  // Strip HTML comments — pure dead weight in an EDITABLE source. A foreign page routinely carries
  // kilobytes of commented-out markup (e.g. phoenix ships a disabled legacy nav as a 12.8KB `<!-- … -->`
  // block); it renders nothing, so keep it out of the source a human/agent edits. Collect first, since
  // removeElement mutates the tree.
  const comments: AnyNode[] = [];
  const collectComments = (ns: AnyNode[]): void => {
    for (const n of ns) {
      if (isComment(n)) comments.push(n);
      else if (isTag(n)) collectComments(n.children);
    }
  };
  collectComments(nodes);
  for (const c of comments) removeElement(c);
  // Then remove forbidden elements (snapshot, since removeElement mutates the tree).
  for (const el of elements(nodes)) {
    if (REMOVE_TAGS.has(el.name)) {
      if (el.name === 'script') diags.push({ code: 'script-dropped', message: 'inline/external <script> removed', page: ctx.pageUrl });
      else if (el.name === 'style') diags.push({ code: 'style-removed', message: '<style> block removed (CSS hoisted separately)', page: ctx.pageUrl });
      removeElement(el);
    }
  }
  // Strip foreign PRELOADER / loading overlays (the platform provides its own; the imported one nativizes
  // to a stray full-screen grey/black band). Remove the whole subtree.
  for (const el of elements(nodes)) {
    if (isPreloader(el)) { removeElement(el); diags.push({ code: 'preloader-removed', message: 'foreign preloader/loading overlay removed', page: ctx.pageUrl }); }
  }
  // Strip foreign BACK-TO-TOP buttons (the platform injects its own); also drop any ancestor wrapper left
  // empty once the button is gone (a section/div that ONLY held the back-to-top → would nativize to a
  // stray empty band). Snapshot, since removeElement mutates the tree.
  for (const el of elements(nodes)) {
    if (!isBackToTop(el)) continue;
    let parent = el.parent;
    removeElement(el);
    diags.push({ code: 'back-to-top-removed', message: 'foreign back-to-top button removed (the platform provides one)', page: ctx.pageUrl });
    while (parent && isTag(parent) && ['div', 'section', 'nav', 'aside', 'span'].includes(parent.name) && isEmptyWrapper(parent)) {
      const grandparent = parent.parent;
      removeElement(parent);
      parent = grandparent;
    }
  }
  // Map foreign icon-font / sprite markup to the platform's `{{sw-icon}}` helper (before the survivor loop,
  // so its attr-rewrite skips the icons we've already turned into text). The returned nodes are the ONLY
  // intentional mustaches in the source, so the neutralize pass below leaves them intact.
  const iconMustaches = mapForeignIcons(nodes, ctx, diags);
  // Then rewrite the survivors.
  for (const el of elements(nodes)) {
    if (LANDMARK_TAGS.has(el.name)) {
      el.name = 'div';
      el.tagName = 'div';
    }
    if (el.name === 'form') {
      el.name = 'div';
      el.tagName = 'div';
      diags.push({ code: 'form-inerted', message: '<form> converted to an inert <div>', page: ctx.pageUrl });
    }
    rewriteElementAttrs(el, ctx, diags);
  }
  // Finally neutralize braces in every surviving TEXT node so no literal {{ remains — EXCEPT the
  // `{{sw-icon}}` mustaches we emitted above (neutralizing them would insert a zero-width space and break
  // the helper). Comments were stripped above, so eachTextLike's comment branch is inert here.
  eachTextLike(nodes, (n) => {
    if (iconMustaches.has(n)) return;
    n.data = neutralizeMustaches(n.data);
  });
}

/** Promote JS lazy-load attrs (`data-src`/`data-srcset`/`data-bg`) to real `src`/`srcset`/inline bg,
 *  then drop the now-redundant lazy attrs — so images survive after the loader script is stripped. */
function promoteLazyAttrs(el: Element): void {
  if (el.name === 'img' || el.name === 'source' || el.name === 'iframe') {
    const src = effectiveSrc(el.attribs); // iframes (video/maps) are often lazy too (data-src)
    if (src) el.attribs.src = src;
    if (el.name !== 'iframe') {
      const srcset = effectiveSrcset(el.attribs);
      if (srcset) el.attribs.srcset = srcset;
    }
  }
  const bg = effectiveBg(el.attribs);
  if (bg) {
    const url = bg.replace(/['")]/g, ''); // strip quotes/paren so it can't break out of url(...)
    // The constructed style value (incl. any pre-existing style) is later run through
    // rewriteStyleUrls + neutralizeMustaches by the main attribute loop (this runs BEFORE it).
    el.attribs.style = `${el.attribs.style ? `${el.attribs.style};` : ''}background-image:url('${url}')`;
  }
  for (const a of LAZY_ATTRS) delete el.attribs[a];
}

/** Merge extra class tokens into a class attribute, idempotently (no duplicates). */
function addClasses(existing: string | undefined, ...add: string[]): string {
  const cur = (existing ?? '').split(/\s+/).filter(Boolean);
  for (const c of add) if (!cur.includes(c)) cur.push(c);
  return cur.join(' ');
}

function rewriteElementAttrs(el: Element, ctx: TransformCtx, diags: ImportDiagnostic[]): void {
  promoteLazyAttrs(el); // lazy-load data-* → real src/srcset/bg before the normal url rewrite hosts them
  // A self-hosted DOCUMENT embed in a modal <iframe> (<embed>/<object> are already stripped by REMOVE_TAGS
  // before this pass, so only <iframe> reaches here — the common PDF-modal pattern).
  //  • A PDF is served INLINE + same-origin-frameable, so KEEP it as a lazy <iframe> pointing at the
  //    hosted /media ref — the browser's sandboxed viewer renders it (e.g. the original's "Company Profile"
  //    modal PDF). Carries loading="lazy" + `.skeleton .loading` (platform rule: every iframe lazy-loads
  //    behind a placeholder) + a min-height so the frame has size before it paints. Finalised HERE and the
  //    function RETURNS — otherwise the main src loop would run isAllowedEmbed() on this same-origin /media
  //    path (not an allow-listed provider host) and DROP it.
  //  • A NON-PDF doc (doc/xls/…) a browser can't render inline → convert to a LINK the browser downloads.
  if (el.name === 'iframe') {
    const rawSrc = el.attribs.src;
    const dkey = rawSrc ? assetKey(rawSrc, ctx.pageUrl) : null;
    const hostedDoc = dkey ? ctx.assetMap.get(dkey) : undefined;
    if (hostedDoc && /\.pdf(?:$|[?#])/i.test(hostedDoc)) {
      const title = (el.attribs.title || el.attribs['aria-label'] || 'Document').trim() || 'Document';
      el.name = 'iframe';
      (el as { tagName?: string }).tagName = 'iframe';
      for (const k of Object.keys(el.attribs)) delete el.attribs[k];
      el.attribs.src = hostedDoc; // same-origin /media ref; publish rebases it to _assets/….pdf
      el.attribs.title = title;
      el.attribs.loading = 'lazy';
      el.attribs.class = 'skeleton loading w-full border-0';
      el.attribs.style = 'min-height:80vh';
      el.children = [];
      diags.push({ code: 'document-embed-framed', message: `a PDF embed was self-hosted and kept as a lazy inline <iframe> (PDFs are served frameable): ${truncate(hostedDoc)}`, page: ctx.pageUrl });
      return;
    }
    if (hostedDoc) {
      const label = (el.attribs.title || el.attribs['aria-label'] || 'View document').trim() || 'View document';
      el.name = 'a';
      (el as { tagName?: string }).tagName = 'a';
      for (const k of Object.keys(el.attribs)) delete el.attribs[k];
      el.attribs.href = hostedDoc;
      el.attribs.target = '_blank';
      el.attribs.rel = 'noopener';
      const text = new Text(label);
      text.parent = el;
      el.children = [text];
      diags.push({ code: 'document-embed-linked', message: `a document embed (non-PDF) was self-hosted and converted to a download link — office/other docs are served download-only and can't be iframed: ${truncate(hostedDoc)}`, page: ctx.pageUrl });
      return; // fully rewritten to an <a href=/media/…> — skip the attr loop (mirrors the PDF branch), else
      //        it would re-resolve the already-hosted href and (for a subpath crawl) corrupt it to "/".
    }
  }
  // Map foreign AOS scroll-motion (data-aos="fade-up" …) to the native data-sw-animation primitives, then
  // strip the AOS attrs. Computed now, ATTACHED after the loop (the loop deletes any data-sw-* to block
  // forged directives — adding it afterwards keeps our sanitised, enum-checked mapping).
  const aos = mapAosAnimation(el.attribs);
  for (const a of AOS_ATTRS) delete el.attribs[a];
  const isImageEl = el.name === 'img';
  const isMediaSource = el.name === 'source' || el.name === 'picture';
  // When a self-hosted <img> carries a srcset, promote its LARGEST variant to `src`. Otherwise the clone
  // shows the tiny placeholder `src` (a thumbnail) while the full-size srcset image sits hosted-but-orphaned
  // — the double-capture. collectImageRefs() mirrors this (it collects ONLY the largest), so exactly one
  // full-res asset is hosted per image and it's the one rendered.
  if (isImageEl && el.attribs.src) {
    const largest = pickFromSrcset(el.attribs.srcset ?? el.attribs.imagesrcset ?? '');
    if (largest) el.attribs.src = largest;
  }
  // Capture the <img>'s ORIGINAL asset key now (before the loop rewrites src to the /media ref) so we
  // can attach the hosted WebP srcset after the foreign srcset has been stripped.
  const imgKey = isImageEl && el.attribs.src ? assetKey(el.attribs.src, ctx.pageUrl) : null;
  /* eslint-disable security/detect-object-injection -- `name` iterates the element's OWN attribute keys (a plain parsed Record), not attacker-controlled object access */
  for (const name of Object.keys(el.attribs)) {
    const value = el.attribs[name] ?? '';
    // Event handlers + forged platform markers are stripped (on* would even fail validateTemplate).
    if (name.startsWith('on') || name.startsWith('data-sw-')) {
      delete el.attribs[name];
      continue;
    }
    if (name === 'srcset' || name === 'imagesrcset') {
      const pick = pickFromSrcset(value);
      const ref = pick ? imageRef(pick, ctx) : null;
      if (ref && !el.attribs.src && (isImageEl || isMediaSource)) el.attribs.src = ref;
      delete el.attribs[name];
      continue;
    }
    if (name === 'href') {
      // A self-hosted document (PDF/doc/…) → point at its /media file instead of the source server or a
      // dead internal route (the asset map now also carries document downloads).
      const docKey = assetKey(value, ctx.pageUrl);
      const hostedDoc = docKey ? ctx.assetMap.get(docKey) : undefined;
      if (hostedDoc) { el.attribs.href = hostedDoc; continue; }
      const decision = rewriteHref(value, ctx.pageUrl, ctx.siteBase, ctx.internalRoutes);
      if (decision.kind === 'set') el.attribs.href = decision.value;
      else if (decision.kind === 'unsafe') {
        el.attribs.href = '#';
        diags.push({ code: 'unsafe-url-dropped', message: `unsafe href "${truncate(value)}" → #`, page: ctx.pageUrl });
      }
      continue;
    }
    if (name === 'src') {
      if (el.name === 'iframe') {
        const abs = resolveUrl(value, ctx.pageUrl);
        // (A self-hosted DOCUMENT embed was already converted to a link in the pre-pass — download-only docs
        // can't be iframed.) Keep embeds only from the trusted provider allowlist (video, maps, social incl.
        // Facebook, audio, forms, code, commerce, …); they're origin-isolated. Defer loading, allow the usual
        // embed capabilities + fullscreen, and don't leak the full referrer. Anything else is dropped.
        if (abs && isAllowedEmbed(abs)) {
          el.attribs.src = abs;
          if (!el.attribs.loading) el.attribs.loading = 'lazy';
          // Modern strict default: send only the origin (not the page path/query) to the embed host.
          if (!el.attribs.referrerpolicy) el.attribs.referrerpolicy = 'strict-origin-when-cross-origin';
          // No clipboard-write by default (silent-clipboard risk); a legit embed's own allow is kept.
          if (!('allow' in el.attribs)) el.attribs.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen';
          if (!('allowfullscreen' in el.attribs)) el.attribs.allowfullscreen = '';
          // LOADING STATE (platform rule: every iframe = lazy + a `.skeleton` shimmer placeholder until it
          // paints, so a slow cross-origin embed shows no blank grey box). Idempotent class merge.
          el.attribs.class = addClasses(el.attribs.class, 'skeleton');
        } else {
          removeElement(el);
          if (abs) diags.push({ code: 'unsafe-url-dropped', message: `iframe from non-allowlisted host dropped: ${truncate(abs)}`, page: ctx.pageUrl });
        }
      } else if (isImageEl || isMediaSource || el.name === 'video' || el.name === 'audio') {
        const ref = el.name === 'video' || el.name === 'audio' ? keepHttps(value, ctx) : imageRef(value, ctx);
        if (ref) el.attribs.src = ref;
        else delete el.attribs.src;
      }
      continue;
    }
    if (name === 'poster') {
      const ref = imageRef(value, ctx);
      if (ref) el.attribs.poster = ref;
      else delete el.attribs.poster;
      continue;
    }
    if (name === 'style') {
      el.attribs.style = neutralizeMustaches(rewriteStyleUrls(value, ctx));
      continue;
    }
    // Any other attribute: just make sure it can't smuggle a mustache.
    el.attribs[name] = neutralizeMustaches(value);
  }
  /* eslint-enable security/detect-object-injection */

  // Serve the efficient WebP variants: attach the hosted responsive srcset to a self-hosted <img>
  // (the foreign srcset was stripped above; `src` stays the fallback for legacy browsers).
  const srcset = imgKey ? ctx.srcsetMap?.get(imgKey) : undefined;
  if (isImageEl && srcset && el.attribs.src && !el.attribs.srcset) {
    el.attribs.srcset = srcset;
    if (!el.attribs.sizes) el.attribs.sizes = '100vw';
    if (!el.attribs.loading) el.attribs.loading = 'lazy';
    if (!el.attribs.decoding) el.attribs.decoding = 'async';
  }

  // Attach the mapped AOS → native scroll-motion (AFTER the loop's data-sw-* strip, so it survives). Values
  // are enum-checked / bounded in mapAosAnimation, so this can't smuggle an arbitrary directive.
  if (aos) {
    el.attribs['data-sw-animation'] = aos.animation;
    if (aos.duration) el.attribs['data-sw-duration'] = aos.duration;
    if (aos.delay) el.attribs['data-sw-delay'] = aos.delay;
  }
}

function keepHttps(raw: string, ctx: TransformCtx): string | null {
  const abs = resolveUrl(raw, ctx.pageUrl);
  return abs && /^https:\/\//i.test(abs) ? abs : null;
}

function truncate(s: string): string {
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

/** The body children to use as the page's content (the <body>, or the whole doc for a bare fragment). */
function contentNodes(doc: Document): AnyNode[] {
  const body = getBody(doc);
  if (body) return body.children;
  // Bare fragment: drop a stray <head>/<html> wrapper if the parser synthesized one.
  return doc.children;
}

/**
 * Keep the longest prefix of top-level children whose serialized bytes fit `maxBytes` (well-formed
 * HTML — never splits an element). O(n): each child is serialized once. `droppedAll` means not even the
 * first child fit, so the caller falls back to text.
 */
function fitSource(nodes: AnyNode[], maxBytes: number): { source: string; truncated: boolean; droppedAll: boolean } {
  // Pretty-print each top-level child so the imported page `source` is readable/editable (block elements
  // on their own indented lines); inter-element whitespace only — semantically identical to serialize().
  const parts = nodes.map((n) => prettySerialize(n)).filter((p) => p !== '');
  const full = parts.join('\n');
  if (byteLength(full) <= maxBytes) return { source: full, truncated: false, droppedAll: false };
  const kept: string[] = [];
  let total = 0;
  for (const part of parts) {
    const b = byteLength(part) + (kept.length > 0 ? 1 : 0); // a joining newline precedes every part but the first
    if (total + b > maxBytes) break;
    kept.push(part);
    total += b;
  }
  return { source: kept.join('\n'), truncated: true, droppedAll: kept.length === 0 && parts.length > 0 };
}

function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/**
 * Transform a parsed document's body into a page `source` guaranteed to pass `validateTemplate`.
 * On the rare chance the transform still produces invalid source, falls back to escaped text content.
 */
export function transformBody(doc: Document, ctx: TransformCtx): { source: string; diagnostics: ImportDiagnostic[] } {
  const diagnostics: ImportDiagnostic[] = [];
  const nodes = contentNodes(doc);
  // Strip foreign off-canvas mobile-nav drawers from the PAGE BODY (not shared with chrome extraction,
  // which owns the real nav) — see {@link isMobileNavDrawer}. Also drop any ancestor wrapper left empty by
  // the removal (else it serializes to a stray empty band) — mirrors the back-to-top cleanup below. Snapshot,
  // since removeElement mutates the tree (a nested drawer already detached with its ancestor is a safe no-op).
  for (const el of elements(nodes)) {
    if (!isMobileNavDrawer(el)) continue;
    let parent = el.parent;
    removeElement(el);
    diagnostics.push({ code: 'mobile-nav-removed', message: 'foreign off-canvas mobile-nav drawer removed (the platform provides a responsive nav)', page: ctx.pageUrl });
    while (parent && isTag(parent) && ['div', 'section', 'nav', 'aside', 'span'].includes(parent.name) && isEmptyWrapper(parent)) {
      const grandparent = parent.parent;
      removeElement(parent);
      parent = grandparent;
    }
  }
  sanitizeForSource(nodes, ctx, diagnostics);
  const maxBytes = ctx.limits.maxSourceBytes;
  const fit = fitSource(nodes, maxBytes);
  let source = fit.source;
  // A single oversized top-level element can't be trimmed by dropping siblings → fall back to text.
  if (fit.droppedAll) {
    source = textFallback(nodes, maxBytes);
    diagnostics.push({ code: 'source-truncated', message: 'oversized page reduced to text to fit the source cap', page: ctx.pageUrl });
  } else if (fit.truncated) {
    diagnostics.push({ code: 'source-truncated', message: 'page trimmed to fit the source size cap', page: ctx.pageUrl });
  }
  try {
    validateTemplate(source);
    return { source, diagnostics };
  } catch {
    diagnostics.push({ code: 'invalid-source-fallback', message: 'transformed source failed validation; fell back to text', page: ctx.pageUrl });
    return { source: textFallback(nodes, maxBytes), diagnostics };
  }
}

/** Escaped, mustache-safe text content of `nodes`, wrapped in a div and shrunk to fit the byte cap. */
function textFallback(nodes: AnyNode[], maxBytes: number): string {
  let text = neutralizeMustaches(escapeHtml(textContent(nodes).trim()));
  const wrap = (t: string): string => `<div class="sw-import-fallback">${t}</div>`;
  while (text.length > 0 && byteLength(wrap(text)) > maxBytes) {
    text = text.slice(0, Math.floor(text.length * 0.9));
  }
  return wrap(text);
}

/**
 * Transform a chrome subtree (header/footer) into a validated skeleton-slot string, capped to the slot
 * byte limit. Returns null if it can't be made valid or doesn't fit — the caller then leaves the chrome
 * inline on each page instead of extracting it.
 */
export function transformFragment(node: Element, ctx: TransformCtx, maxBytes: number): string | null {
  const diags: ImportDiagnostic[] = [];
  sanitizeForSource([node], ctx, diags);
  const html = prettySerialize(node); // readable/editable slot HTML (block elements indented)
  if (byteLength(html) > maxBytes) return null;
  try {
    validateTemplate(html);
    return html;
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
