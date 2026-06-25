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
}

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
  aos: AosAttrs | null;
  cls: string;
  style: string;
  children: MergedNode[];
  ariaHidden?: boolean;
  marqueeDup?: boolean;
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

/**
 * Snap a button-like `<a>`/`<button>` to the platform button system (`.btn` + a daisyUI FACE + size), or
 * null if it's a plain link. A brand fill → `btn-primary/secondary/accent` (theme-editable); a border-only
 * control → `btn-outline` (+ the brand face if the border is a brand color); any other fill → `btn-neutral`.
 * Effects/shapes/accents (sw-btn-*) are the operator's site-wide design choice, not derived from the import.
 */
export function snapButton(s: StyleMap, tag: string, palette: NativizePalette): string | null {
  if (tag !== 'a' && tag !== 'button') return null;
  const bg = s['background-color']; // the walk records this ONLY when it differs from the transparent default
  const borderW = parseFloat(s['border-top-width'] || s['border-left-width'] || s['border-bottom-width'] || s['border-right-width'] || '0');
  const padX = Math.max(parseFloat(s['padding-left'] || '0'), parseFloat(s['padding-right'] || '0'));
  const padY = Math.max(parseFloat(s['padding-top'] || '0'), parseFloat(s['padding-bottom'] || '0'));
  // A <button> is always a control; an <a> must LOOK like one (a fill OR an outline, plus button padding)
  // so plain text/nav links stay links.
  const looksButton = tag === 'button' || ((!!bg || borderW > 0) && padX >= BTN_PAD_X && padY >= BTN_PAD_Y);
  if (!looksButton) return null;
  const bgTok = bg ? colorToken(bg, palette) : null;
  let face: string;
  if (bgTok && bgTok !== 'white' && bgTok !== 'black') face = `btn-${bgTok}`;
  else if (!bg && borderW > 0) { const bt = colorToken(s['border-top-color'] || '', palette); face = bt && bt !== 'white' && bt !== 'black' ? `btn-outline btn-${bt}` : 'btn-outline'; }
  else face = 'btn-neutral'; // white/black/non-brand fill → neutral (theme-editable; the agent can recolor)
  const fs = parseFloat(s['font-size'] || '16');
  const size = padY >= 16 || fs >= 19 ? 'btn-lg' : (padY > 0 && padY <= 6) || fs <= 13 ? 'btn-sm' : '';
  return ['btn', face, size].filter(Boolean).join(' ');
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
  // CONTENT CONTAINER: a wide, horizontally-centered structural block (at desktop) is a section's content
  // wrapper → emit the site-wide `.sw-container` instead of a captured per-section width.
  const isContainer = !slider && cw >= CONTAINER_MIN_PX && cml > 0 && Math.abs(cml - cmr) < 2 && nl.tag !== 'img' && nl.tag !== 'iframe' && nl.children.length > 0;
  if (isContainer) for (const m of maps) for (const k of ['w', 'maxw', 'mx', 'px', 'pl', 'pr']) delete m.g[k];
  // A modal container becomes a native <dialog>, which owns its open/closed visibility — drop the captured
  // display:none (it's hidden in the static capture) so the dialog isn't permanently invisible when opened.
  if (nl.isModal) for (const m of maps) delete m.g.display;

  let cls: string;
  let marqueeTrack = false;
  let swMarquee = false;
  // Button/button-link → the platform button system (drop the captured fill/padding/radius; keep only
  // positioning auto-margins). Skipped inside a slider/marquee track (those nodes have their own snap).
  const btn = !slider && !isSlide ? snapButton(nl.s, nl.tag, ctx.palette) : null;
  if (hasTrackChild) { swMarquee = true; cls = ''; } // the VIEWPORT → data-sw-marquee
  else if (isTrack) { marqueeTrack = true; cls = 'sw-marquee-track'; } // the TRACK
  else if (isSlide) { cls = 'sw-marquee-item'; } // each SLIDE
  else if (btn) {
    const keep = mergeGroups(maps).filter((c) => /(?:^|:)(?:mx-auto|ml-auto|mr-auto|my-auto|w-full)$/.test(c));
    cls = [btn, ...keep].join(' ');
  } else {
    cls = (isContainer ? 'sw-container ' : '') + mergeGroups(maps).join(' ');
    if (nl.pflex && !isContainer) cls = (cls ? cls + ' ' : '') + 'min-w-0';
  }
  if (!btn && nl.tag === 'a' && (nl.s['text-decoration-line'] || 'none') !== 'underline') cls = (cls ? cls + ' ' : '') + 'no-underline';

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
    aos: (slider || nl.tag === 'img') ? null : aosAttrs(nl.anim ?? null),
    title: nl.title, cls, style: maps[2]!.st.filter(Boolean).join(';'), children: [],
  };
  for (let i = 0; i < nl.children.length; i++) node.children.push(mergeTree(nb.children[i] ?? EMPTY, nm.children[i] ?? EMPTY, nl.children[i]!, ctx, slider, isTrack));
  return node;
}

/** Convenience: merge a triple of root node lists (smallest→largest), padding missing trees. */
export function mergeTrees(base: CapturedNode[], md: CapturedNode[], lg: CapturedNode[], ctx: NativizeContext): MergedNode[] {
  return lg.map((n, i) => mergeTree(base[i] ?? EMPTY, md[i] ?? EMPTY, n, ctx));
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

  // MODAL container → a native <dialog data-sw-component="modal"> (the platform runtime opens it).
  const tag = n.modalId ? 'dialog' : n.tag;
  const at: string[] = [];
  if (n.modalId) { at.push(`id="${escAttr(n.modalId)}"`, 'data-sw-component="modal"'); }
  if (n.cls) at.push(`class="${n.cls}"`);
  if (n.style) at.push(`style="${n.style}"`);
  if (n.ariaHidden) at.push('aria-hidden="true"');
  if (n.marqueeDup) at.push('data-sw-marquee-dup');
  if (n.aos) { at.push(`data-aos="${n.aos.effect}"`); if (n.aos.delay) at.push(`data-aos-delay="${n.aos.delay}"`); if (n.aos.dur) at.push(`data-aos-duration="${n.aos.dur}"`); }
  if (tag === 'img') { at.push(`src="${escAttr(n.src ?? '')}"`); if (n.alt) at.push(`alt="${escAttr(n.alt)}"`); at.push('loading="lazy"'); }
  // MODAL trigger → reference the dialog: an <a> uses href="#id"; any other element uses [data-sw-modal].
  else if (n.modalTarget && tag === 'a') at.push(`href="#${escAttr(n.modalTarget)}"`);
  else if (n.modalTarget) at.push(`data-sw-modal="${escAttr(n.modalTarget)}"`);
  else if (tag === 'a') at.push(`href="${escAttr(safeHref(n.href, ctx.originHosts))}"`);
  if (tag === 'iframe') { at.push(`src="${escAttr(n.src ?? '')}"`); if (n.title) at.push(`title="${escAttr(n.title)}"`); at.push('loading="lazy"'); }

  const open = `<${tag}${at.length ? ' ' + at.join(' ') : ''}>`;
  if (VOID.has(tag)) return ind + open;
  const inner: string[] = [];
  if (n.text) inner.push('  '.repeat(d + 1) + escText(n.text));
  for (const ch of n.children) inner.push(emitNode(ch, d + 1, ctx, logos));
  // Marquee seamless loop: render the slide set TWICE (2nd copy aria-hidden + data-sw-marquee-dup so
  // reduced-motion can drop it) so the platform translateX(-50%) keyframe wraps without a visible seam.
  if (n.marqueeTrack && n.children.length) for (const ch of n.children) inner.push(emitNode({ ...ch, ariaHidden: true, marqueeDup: true }, d + 1, ctx, logos));
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
