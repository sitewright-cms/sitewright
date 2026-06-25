// The styled-tree pipeline: merge the 3 per-viewport capture trees into one node carrying mobile-first
// responsive classes + snap decisions (container / carousel / marquee / flip card / icon), then render
// that to validator-safe Handlebars HTML. The nativizer REFERENCES platform primitives (a marquee snaps
// to `{{> logo-marquee}}`, icons to `{{sw-icon}}`, internal links to `{{sw-url}}`) rather than
// reconstructing dynamic markup. Pure — no browser — so it unit-tests with fixture trees. Ported from
// the matured _clone.mjs spike.
import { type EmitContext, type StyleMap, emitGroups, mergeGroups } from './tailwind.js';
import { mapFaIcon } from './icon-map.js';
import { colorToken, dim, hexOf, type NativizePalette } from './tokens.js';
import { aosAttrs, type AosAttrs } from './aos.js';

/** A node from the multi-viewport DOM walk (structure is shared; the style map `s` is per-viewport). */
export interface CapturedNode {
  tag: string;
  s: Readonly<Record<string, string>>;
  children: CapturedNode[];
  text?: string;
  pflex?: boolean;
  anim?: { name: string; delay: string; dur: string } | null;
  src?: string;
  alt?: string;
  href?: string;
  title?: string;
  icon?: string;
  iconSize?: string;
  iconColor?: string;
  flip?: boolean;
  isBack?: boolean;
  flipH?: string;
  /** Element id (captured only when it's a modal target or a modal container — for trigger↔dialog wiring). */
  id?: string;
  /** This element is a modal/dialog container (class~="modal" / role="dialog") with an id → snap to <dialog>. */
  isModal?: boolean;
  /** This element triggers a modal: the referenced modal id (from data-(bs-)target / href="#id"). */
  modalTarget?: string;
  /** A JS-component snap recognized from STATIC markup (carousel/tabs/accordion parts). */
  snap?: SnapKind;
  /** A tab panel's label (looked up from the source's matching tab button) → data-sw-title. */
  tabTitle?: string;
  /** This element started BELOW the fold in this viewport (top past the viewport height) → its image /
   *  background can be lazy-loaded; an above-the-fold one stays eager (LCP). */
  belowFold?: boolean;
  /** The element carries a foreign `.container`/content-wrapper class → snap to `.sw-container`. */
  containerHint?: boolean;
}

/** A component part recognized from the source's static class markers → a platform primitive on emit. */
export type SnapKind =
  | 'carousel' // root → data-sw-component="carousel" data-sw-block="Carousel" (+ prev/next/dots)
  | 'carousel-direct' // owl/declarative-slick root: slides are DIRECT children (no track/slide classes) → expanded to a carousel + synthesized track in the mergeTrees pre-pass
  | 'carousel-track' // the slide row → data-sw-part="track"
  | 'carousel-slide' // one slide → data-sw-part="slide"
  | 'tabs' // the panel container → data-sw-component="tabs"
  | 'tab-panel' // one panel → data-sw-part="panel" data-sw-title
  | 'details' // an accordion item → native <details>
  | 'summary' // an accordion header button → native <summary>
  | 'unwrap' // a structural wrapper to remove (e.g. an accordion header/collapse) → emit its children only
  | 'drop'; // the source's own tab BUTTONS (the runtime rebuilds them) → omit

/** A merged node: final responsive classes + the snap flags the renderer acts on. */
export interface MergedNode {
  tag: string;
  text?: string;
  href?: string;
  src?: string;
  alt?: string;
  title?: string;
  swicon: string | null;
  iconSize?: string;
  iconColor?: string;
  marqueeTrack: boolean;
  swMarquee: boolean;
  flip?: boolean;
  isBack?: boolean;
  flipH?: string;
  /** A modal container → rendered as `<dialog id data-sw-component="modal">`. */
  modalId?: string;
  /** A trigger → rendered with `href="#<modalTarget>"` so the platform modal runtime opens it. */
  modalTarget?: string;
  /** A component-part snap (carousel/tabs/accordion) → platform markup on emit. */
  snap?: SnapKind;
  /** A tab panel's data-sw-title. */
  tabTitle?: string;
  aos: AosAttrs | null;
  cls: string;
  style: string;
  children: MergedNode[];
  ariaHidden?: boolean;
  marqueeDup?: boolean;
  /** Below the fold in EVERY captured viewport → eligible for lazy image/background loading. */
  belowFold?: boolean;
}

export interface NativizeContext extends EmitContext {
  /** Source hostnames to strip from hrefs → root-relative routes (e.g. ['advancedtechcc.com']). */
  originHosts: readonly string[];
  /** Breakpoint prefixes for the 3 capture trees, smallest→largest. Default ['', 'md:', 'lg:']. */
  breakpoints: readonly string[];
}

const EMPTY: CapturedNode = { tag: '', s: {}, children: [] };
const SLIDER_TRACK_PX = 2500; // a JS slider leaves a huge transformed track (e.g. 45000px) → snap to marquee
const CONTAINER_MIN_PX = 760; // a wide, centered structural block → the site-wide .sw-container
const BTN_PAD_X = 8; // a button-like <a> needs real horizontal padding (a fill/outline + padding, not a text link)
const BTN_PAD_Y = 4;

/** The result of a button snap: the `.btn …` classes, and whether the captured fill/text color should be
 *  dropped (a brand/outline face owns the color) or KEPT (a non-brand color the theme can't tokenize). */
export interface ButtonSnap {
  classes: string;
  keepColor: boolean;
}

/**
 * Snap a button-like `<a>`/`<button>` to the platform button system (`.btn` + a daisyUI FACE + size), or
 * null if it's a plain link. A brand fill → `btn-primary/secondary/accent` (theme-editable, color dropped);
 * a border-only control → `btn-outline` (+ brand face if the border is a brand color); a small ~square
 * fill → `btn-square` (icon button); any other fill → bare `.btn` with the captured color KEPT (so a
 * non-brand button stays its real color — the agent can map it to a token). Effects/shapes/accents
 * (sw-btn-*) are the operator's site-wide design choice, not derived from the import.
 */
export function snapButton(s: StyleMap, tag: string, palette: NativizePalette): ButtonSnap | null {
  if (tag !== 'a' && tag !== 'button') return null;
  const bg = s['background-color']; // the walk records this ONLY when it differs from the transparent default
  const borderW = parseFloat(s['border-top-width'] || s['border-left-width'] || s['border-bottom-width'] || s['border-right-width'] || '0');
  const padX = Math.max(parseFloat(s['padding-left'] || '0'), parseFloat(s['padding-right'] || '0'));
  const padY = Math.max(parseFloat(s['padding-top'] || '0'), parseFloat(s['padding-bottom'] || '0'));
  const w = parseFloat(s.width || '0'), h = parseFloat(s.height || '0');
  const bgTok = bg ? colorToken(bg, palette) : null;
  const brandFace = bgTok && bgTok !== 'white' && bgTok !== 'black' ? `btn-${bgTok}` : null;
  const fs = parseFloat(s['font-size'] || '16');
  // A LARGE-font box (a heading-sized link with an icon, e.g. burmeister's "The Company"/"New Building
  // Inauguration" cards) is a CONTENT CARD, not a button — snapping it to `.btn` collapses it to an
  // inline pill (icon beside text, nowrap title clipped). Leave it as a styled link.
  if (fs >= 24) return null;
  const size = padY >= 16 || fs >= 19 ? 'btn-lg' : (padY > 0 && padY <= 6) || (fs > 0 && fs <= 13) ? 'btn-sm' : '';
  const wrap = (face: string, keepColor: boolean): ButtonSnap => ({ classes: ['btn', face, size].filter(Boolean).join(' '), keepColor });

  // PADDED control (a fill OR an outline + button padding), or ANY <button>.
  if (tag === 'button' || ((!!bg || borderW > 0) && padX >= BTN_PAD_X && padY >= BTN_PAD_Y)) {
    if (brandFace) return wrap(brandFace, false); // face owns the color → drop the captured fill/text
    if (!bg && borderW > 0) { const bt = colorToken(s['border-top-color'] || '', palette); return wrap(bt && bt !== 'white' && bt !== 'black' ? `btn-outline btn-${bt}` : 'btn-outline', false); }
    if (bg) return wrap('', true); // non-brand fill → bare .btn, KEEP the color
    // No fill + no border: a TEXT/ICON button (e.g. a `bg-transparent primary-text` table action). If it
    // carries a text color it's a styled text link → `btn-ghost` KEEPING that color (not a dark `btn-neutral`
    // fill — burmeister's red "VIEW" buttons were rendering as dark boxes).
    return s.color ? wrap('btn-ghost', true) : wrap('btn-neutral', false);
  }
  // SQUARE ICON button: a small ~square fixed-size control with a fill but little/no padding.
  if (!!bg && w >= 24 && w <= 80 && h >= 24 && h <= 80 && Math.abs(w - h) <= 10 && padX < BTN_PAD_X) {
    return brandFace ? { classes: `btn btn-square ${brandFace}`, keepColor: false } : { classes: 'btn btn-square', keepColor: true };
  }
  return null;
}

/**
 * Walk the 3 same-shape trees (small→large) in parallel into one merged node with responsive classes +
 * snap decisions. `inSlider`/`pTrack` thread the carousel/marquee context down the recursion.
 */
export function mergeTree(nb: CapturedNode, nm: CapturedNode, nl: CapturedNode, ctx: NativizeContext, inSlider = false, pTrack = false): MergedNode {
  const bp = ctx.breakpoints;
  const maps = [
    { bp: bp[0] ?? '', ...emitGroups(nb.s, nl.tag, !!nb.pflex, ctx) },
    { bp: bp[1] ?? 'md:', ...emitGroups(nm.s, nl.tag, !!nm.pflex, ctx) },
    { bp: bp[2] ?? 'lg:', ...emitGroups(nl.s, nl.tag, !!nl.pflex, ctx) },
  ];
  const cw = parseFloat(nl.s.width || '');
  const cml = parseFloat(nl.s['margin-left'] || '0');
  const cmr = parseFloat(nl.s['margin-right'] || '0');
  // CAROUSEL/MARQUEE: a JS slider leaves a huge transformed TRACK inside an overflow-hidden viewport. We
  // can't run the source's JS → re-express it with the platform's CSS-only marquee primitive.
  const isTrack = cw > SLIDER_TRACK_PX;
  const hasTrackChild = nl.children.some((c) => parseFloat((c.s || {}).width || '0') > SLIDER_TRACK_PX);
  const isSlide = !!pTrack;
  const slider = !!(inSlider || isTrack || hasTrackChild);
  // CONTENT CONTAINER → the site-wide `.sw-container` (capped + centred + responsive gutter) instead of a
  // captured per-section width. Detected EITHER as a wide horizontally-centred block (visible only at a
  // viewport wider than its max-width) OR — crucially — by a captured `max-width` cap (a `width:100%;
  // max-width:Npx; margin:auto` container reads as full-width at the capture viewport, with margin:auto
  // resolving to 0, so the centring is invisible; the max-width cap is the reliable signal).
  const cmw = parseFloat(nl.s['max-width'] || '0');
  const structural = !slider && !nl.snap && nl.tag !== 'img' && nl.tag !== 'iframe' && nl.children.length > 0;
  const wideOrFull = cw >= 400 || nl.s.width === '100%' || !nl.s.width; // not a narrow fixed-width widget
  const isContainer = structural && (
    (nl.containerHint && wideOrFull) || // a foreign `.container`/content-wrapper class (most reliable)
    (cw >= CONTAINER_MIN_PX && cml > 0 && Math.abs(cml - cmr) < 2) || // a wide centered block (at a wide capture)
    (cmw >= CONTAINER_MIN_PX && cmw <= 2000) // a captured max-width cap
  );
  if (isContainer) for (const m of maps) for (const k of ['w', 'maxw', 'mx', 'px', 'pl', 'pr']) delete m.g[k];
  // A modal container becomes a native <dialog>, which owns its open/closed visibility — drop the captured
  // display:none (it's hidden in the static capture) so the dialog isn't permanently invisible when opened.
  if (nl.isModal) for (const m of maps) delete m.g.display;

  let cls: string;
  let marqueeTrack = false;
  let swMarquee = false;
  // Button/button-link → the platform button system (drop the captured fill/padding/radius; keep only
  // positioning auto-margins). Skipped inside a slider/marquee track (those nodes have their own snap).
  const btn = !slider && !isSlide && !nl.snap ? snapButton(nl.s, nl.tag, ctx.palette) : null;
  if (hasTrackChild) { swMarquee = true; cls = ''; } // the VIEWPORT → data-sw-marquee
  else if (isTrack) { marqueeTrack = true; cls = 'sw-marquee-track'; } // the TRACK
  else if (isSlide) { cls = 'sw-marquee-item'; } // each SLIDE
  else if (btn) {
    // Keep positioning (auto-margins / w-full) always; keep the captured fill/text color only when the
    // chosen face doesn't own it (a non-brand button stays its real color).
    const keep = mergeGroups(maps).filter((c) =>
      /(?:^|:)(?:mx-auto|ml-auto|mr-auto|my-auto|w-full)$/.test(c) || (btn.keepColor && /(?:^|:)(?:bg-|text-)/.test(c)),
    );
    cls = [btn.classes, ...keep].join(' ');
  } else {
    cls = (isContainer ? 'sw-container ' : '') + mergeGroups(maps).join(' ');
    if (nl.pflex && !isContainer) cls = (cls ? cls + ' ' : '') + 'min-w-0';
  }
  if (!btn && nl.tag === 'a' && (nl.s['text-decoration-line'] || 'none') !== 'underline') cls = (cls ? cls + ' ' : '') + 'no-underline';
  // A content-wrapping link (an image/card TILE, not a text link) lost its :hover in the static capture —
  // restore a subtle, universally-safe hover so tiles still feel interactive (the exact original hover
  // can't be captured: getComputedStyle only sees the resting state).
  if (!btn && nl.tag === 'a' && !nl.text && nl.children.length > 0) cls = (cls ? cls + ' ' : '') + 'transition-opacity hover:opacity-90';

  let swicon: string | null = null;
  if ((nl.tag === 'i' || nl.tag === 'span') && nl.icon) {
    swicon = mapFaIcon(nl.icon);
    if (!swicon) { const fa = nl.icon.split(/\s+/).filter((x) => /^fa([bsrl]?$|-)/.test(x) && !/['"<>&]/.test(x)).join(' '); if (fa) cls = (cls ? cls + ' ' : '') + fa; } // keep only attr-safe FA tokens
  }

  const node: MergedNode = {
    tag: nl.tag, text: nl.text, href: nl.href, src: nl.src, alt: nl.alt, swicon, iconSize: nl.iconSize, iconColor: nl.iconColor,
    marqueeTrack, swMarquee, flip: nl.flip, isBack: nl.isBack, flipH: nl.flipH,
    modalId: nl.isModal && nl.id ? nl.id : undefined,
    modalTarget: nl.modalTarget,
    snap: nl.snap,
    tabTitle: nl.tabTitle,
    aos: (slider || nl.tag === 'img') ? null : aosAttrs(nl.anim ?? null),
    title: nl.title, cls, style: maps[2]!.st.filter(Boolean).join(';'), children: [],
    // Lazy-eligible only when below the fold in EVERY viewport (so an above-the-fold-anywhere hero/LCP
    // image or background stays eager).
    belowFold: !!(nb.belowFold && nm.belowFold && nl.belowFold),
  };
  for (let i = 0; i < nl.children.length; i++) node.children.push(mergeTree(nb.children[i] ?? EMPTY, nm.children[i] ?? EMPTY, nl.children[i]!, ctx, slider, isTrack));
  return node;
}

/**
 * Pre-pass: expand owl/declarative-slick roots (snap 'carousel-direct' — slides are the root's DIRECT
 * children, with no track/slide classes) into the normal carousel shape — a synthesized `track` wrapping
 * the children, each marked a `slide` — so the standard carousel emit handles them. Pure + immutable; run
 * on EACH capture tree before the merge so all three trees share the new shape (the index-zip stays aligned).
 */
export function expandCarouselDirect(nodes: readonly CapturedNode[]): CapturedNode[] {
  return nodes.map((n) => {
    const children = expandCarouselDirect(n.children);
    if (n.snap === 'carousel-direct') {
      const slides = children.map((c) => (c.snap ? c : { ...c, snap: 'carousel-slide' as const }));
      const track: CapturedNode = { tag: 'div', s: {}, children: slides, snap: 'carousel-track' };
      return { ...n, snap: 'carousel' as const, children: [track] };
    }
    return { ...n, children };
  });
}

/** Convenience: merge a triple of root node lists (smallest→largest), padding missing trees. */
export function mergeTrees(base: CapturedNode[], md: CapturedNode[], lg: CapturedNode[], ctx: NativizeContext): MergedNode[] {
  const b = expandCarouselDirect(base), m = expandCarouselDirect(md), l = expandCarouselDirect(lg);
  return l.map((n, i) => mergeTree(b[i] ?? EMPTY, m[i] ?? EMPTY, n, ctx));
}

const VOID = new Set(['img', 'input', 'br', 'hr']); // NB: <iframe> is NOT void

/** Strip a source origin → a root-relative `{{sw-url '/slug'}}` (keeps a #anchor); non-internal → unchanged. */
export function toRoute(href: string | undefined, hosts: readonly string[]): string | undefined {
  if (!href) return href;
  let x = href;
  for (const h of hosts) {
    const bare = h.replace(/^www\./, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!bare) continue; // an empty host would build a catch-all that strips ANY origin → skip
    x = x.replace(new RegExp(`^https?://(www\\.)?${bare}`, 'i'), '');
  }
  x = x.replace(/^\.\//, '/');
  if (x === '' || x === '/' || x === '.') return `{{sw-url '/'}}`;
  const m = x.match(/^\/([a-z0-9-]+)\/?(#[^"']*)?$/i);
  return m ? `{{sw-url '/${m[1]}'}}${m[2] || ''}` : href;
}

// Captured text/attrs come from an EXTERNAL imported site — entity-encode before inserting into HTML so a
// stray `"`/`<`/`&` can't break out of an attribute or inject markup (defense-in-depth; page.source is
// also validateTemplate-checked downstream). Handlebars expressions emit() inserts are added separately,
// so they pass through intact.
const escAttr = (v: string): string => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const escText = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Route an href, then neutralize script-y schemes (javascript:/vbscript:/data:) → '#'. */
function safeHref(href: string | undefined, hosts: readonly string[]): string {
  const r = toRoute(href, hosts) ?? '';
  return /^\s*(javascript|vbscript|data):/i.test(r) ? '#' : r;
}

export interface RenderResult {
  html: string;
  /** Logos the marquee snap collected → the deploy step populates the logo-marquee widget's dataset. */
  marqueeLogos: { image: string; alt: string }[];
}

/** Render merged root nodes to Handlebars HTML, collecting any marquee logos for the widget dataset. */
export function renderTree(nodes: readonly MergedNode[], ctx: NativizeContext): RenderResult {
  const marqueeLogos: { image: string; alt: string }[] = [];
  const html = nodes.map((n) => emitNode(n, 0, ctx, marqueeLogos)).join('\n');
  return { html, marqueeLogos };
}

function emitNode(n: MergedNode, d: number, ctx: NativizeContext, logos: { image: string; alt: string }[]): string {
  const ind = '  '.repeat(d);
  // MARQUEE → snap to the official widget; collect its logos for the config dataset.
  if (n.swMarquee) { collectLogos(n, logos); return ind + '{{> logo-marquee}}'; }
  if (n.flip) return emitFlip(n, ind);
  if (n.swicon) return emitIcon(n, ind, ctx);

  if (n.snap === 'drop') return ''; // the source's own tab buttons — the tabs runtime rebuilds them
  // UNWRAP a structural wrapper (accordion header/collapse) → emit its children at THIS depth so a native
  // <summary>/body lands as a direct child of <details> (a <summary> must be the dialog's direct child).
  if (n.snap === 'unwrap') { const kids = n.children.map((ch) => emitNode(ch, d, ctx, logos)).filter(Boolean); return kids.join('\n'); }
  // Effective tag: an accordion item/header → native <details>/<summary>; a modal → <dialog>; else as-is.
  const tag = n.snap === 'details' ? 'details' : n.snap === 'summary' ? 'summary' : n.modalId ? 'dialog' : n.tag;
  // A carousel root needs position:relative for its overlay arrows/dots.
  const clsPrefix = n.snap === 'carousel' && !/(^|\s)relative(\s|$)/.test(n.cls || '') ? 'relative ' : '';
  const at: string[] = [];
  if (n.modalId) at.push(`id="${escAttr(n.modalId)}"`, 'data-sw-component="modal"');
  // Component-part markers (carousel/tabs) → the platform runtime + CSS enhance these.
  if (n.snap === 'carousel') at.push('data-sw-component="carousel"', 'data-sw-block="Carousel"');
  else if (n.snap === 'carousel-track') at.push('data-sw-part="track"');
  else if (n.snap === 'carousel-slide') at.push('data-sw-part="slide"');
  else if (n.snap === 'tabs') at.push('data-sw-component="tabs"');
  else if (n.snap === 'tab-panel') { at.push('data-sw-part="panel"'); if (n.tabTitle) at.push(`data-sw-title="${escAttr(n.tabTitle)}"`); }
  if (n.cls || clsPrefix) at.push(`class="${(clsPrefix + (n.cls ?? '')).trim()}"`);
  // Backgrounds stay EAGER inline styles: these tiles carry a dark overlay, so a deferred (data-bg) load
  // flashes BLACK until it resolves — worse than the original. Below-the-fold lazy loading is applied to
  // <img>/<iframe> instead (native loading="lazy", robust), via `belowFold` below.
  if (n.style) at.push(`style="${n.style}"`);
  if (n.ariaHidden) at.push('aria-hidden="true"');
  if (n.marqueeDup) at.push('data-sw-marquee-dup');
  if (n.aos) { at.push(`data-aos="${n.aos.effect}"`); if (n.aos.delay) at.push(`data-aos-delay="${n.aos.delay}"`); if (n.aos.dur) at.push(`data-aos-duration="${n.aos.dur}"`); }
  if (tag === 'img') { at.push(`src="${escAttr(n.src ?? '')}"`); if (n.alt) at.push(`alt="${escAttr(n.alt)}"`); at.push(`loading="${n.belowFold ? 'lazy' : 'eager'}"`); }
  // MODAL trigger → reference the dialog: an <a> uses href="#id"; any other element uses [data-sw-modal].
  else if (n.modalTarget && tag === 'a') at.push(`href="#${escAttr(n.modalTarget)}"`);
  else if (n.modalTarget) at.push(`data-sw-modal="${escAttr(n.modalTarget)}"`);
  else if (tag === 'a') at.push(`href="${escAttr(safeHref(n.href, ctx.originHosts))}"`);
  if (tag === 'iframe') { at.push(`src="${escAttr(n.src ?? '')}"`); if (n.title) at.push(`title="${escAttr(n.title)}"`); at.push(`loading="${n.belowFold === false ? 'eager' : 'lazy'}"`); }

  const open = `<${tag}${at.length ? ' ' + at.join(' ') : ''}>`;
  if (VOID.has(tag)) return ind + open;
  const inner: string[] = [];
  if (n.text) inner.push('  '.repeat(d + 1) + escText(n.text));
  for (const ch of n.children) { const e = emitNode(ch, d + 1, ctx, logos); if (e) inner.push(e); } // skip dropped nodes
  // Marquee seamless loop: render the slide set TWICE (2nd copy aria-hidden + data-sw-marquee-dup so
  // reduced-motion can drop it) so the platform translateX(-50%) keyframe wraps without a visible seam.
  if (n.marqueeTrack && n.children.length) for (const ch of n.children) inner.push(emitNode({ ...ch, ariaHidden: true, marqueeDup: true }, d + 1, ctx, logos));
  // A carousel root gets prev/next arrows + a dots mount (hidden until the runtime enhances it).
  if (n.snap === 'carousel') {
    const ci = '  '.repeat(d + 1);
    inner.push(`${ci}<button type="button" data-sw-part="prev" aria-label="Previous slide">{{sw-icon "chevron-left" "size-6"}}</button>`);
    inner.push(`${ci}<button type="button" data-sw-part="next" aria-label="Next slide">{{sw-icon "chevron-right" "size-6"}}</button>`);
    inner.push(`${ci}<div data-sw-part="dots" aria-hidden="true"></div>`);
  }
  return inner.length ? `${ind}${open}\n${inner.join('\n')}\n${ind}</${tag}>` : `${ind}${open}</${tag}>`;
}

function emitIcon(n: MergedNode, ind: string, ctx: NativizeContext): string {
  const szN = n.iconSize ? Math.round(parseFloat(n.iconSize)) : 0;
  const size = szN ? `${dim('h', szN + 'px', 3)} ${dim('w', szN + 'px', 3)}` : 'h-[1em] w-[1em]';
  const t = n.iconColor ? colorToken(n.iconColor, ctx.palette) : null;
  const color = n.iconColor ? (t ? `text-${t}` : `text-[${hexOf(n.iconColor)}]`) : '';
  return ind + `{{sw-icon "${n.swicon}" "inline-block align-[-0.125em] ${size}${color ? ' ' + color : ''}"}}`;
}

// ROTATING TILE (flip card): rebuild a clean pure-Tailwind 3D flip from the captured front (icon + title)
// + back (.back subtree text). Don't wrap the source's messy face markup — EXTRACT the essentials.
function emitFlip(n: MergedNode, ind: string): string {
  const h = n.flipH ? dim('h', String(Math.round(parseFloat(n.flipH))) + 'px', 4) : 'h-56';
  const backNode = findBack(n.children);
  const icon = findIcon(n.children, backNode) || 'square';
  const title = allText(n.children, backNode); // front text, EXCLUDING the back subtree
  let desc = backNode ? allText([backNode], null) : ''; // the back description
  if (title && desc.startsWith(title)) desc = desc.slice(title.length).trim(); // back repeats the title → drop it
  return `${ind}<div class="group ${h} perspective-distant">
${ind}  <div class="relative h-full w-full transition-transform duration-700 transform-3d group-hover:rotate-y-180">
${ind}    <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-box bg-base-100 p-6 text-center shadow backface-hidden">
${ind}      {{sw-icon "${icon}" "h-10 w-10 text-primary"}}
${ind}      <h3 class="font-heading text-lg font-semibold text-base-content">${escText(title)}</h3>
${ind}    </div>
${ind}    <div class="absolute inset-0 flex items-center justify-center rounded-box bg-primary p-6 text-center text-primary-content shadow rotate-y-180 backface-hidden">
${ind}      <p>${escText(desc)}</p>
${ind}    </div>
${ind}  </div>
${ind}</div>`;
}

function collectLogos(n: MergedNode, logos: { image: string; alt: string }[]): void {
  if (n.tag === 'img' && n.src && !logos.some((m) => m.image === n.src)) logos.push({ image: n.src, alt: n.alt || '' });
  for (const c of n.children) collectLogos(c, logos);
}

// `.back` is nested (.flippable > .card > [front + .back]) → find it ANYWHERE, not just direct children.
function findBack(ns: readonly MergedNode[]): MergedNode | null {
  for (const x of ns) { if (x.isBack) return x; const f = findBack(x.children); if (f) return f; }
  return null;
}
function findIcon(ns: readonly MergedNode[], skip: MergedNode | null): string | null {
  for (const x of ns) { if (x === skip) continue; if (x.swicon) return x.swicon; const f = findIcon(x.children, skip); if (f) return f; }
  return null;
}
function allText(ns: readonly MergedNode[], skip: MergedNode | null): string {
  let t = '';
  for (const x of ns) { if (x === skip) continue; if (x.text) t += x.text + ' '; t += allText(x.children, skip); }
  return t.replace(/\s+/g, ' ').trim();
}
