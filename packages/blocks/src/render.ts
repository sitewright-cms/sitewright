// Pure, framework-free HTML renderer for the block tree. Produces semantic HTML
// annotated with `data-sw-block` / `data-sw-part` hooks that the preview
// stylesheet targets. ALL text and attributes are escaped, and URLs are passed
// through an allowlist — the output is safe to drop into a sandboxed preview
// iframe even when the page tree contains hostile content.
import type { Brand, Entry, MediaAsset, Page, PageNode } from '@sitewright/schema';
import { resolveBinding } from '@sitewright/core';
import { escapeAttr, escapeHtml } from './escape.js';
import { textProp, urlProp } from './props.js';
import { resolveInternalUrl } from './url.js';
import { iconBody } from './icons.js';
import { brandIcon } from './brand-icons.js';
import { metaTags, schemaOrgJsonLd, type SeoMeta, type SchemaOrgInfo } from './head.js';
import { brandToCss } from './brand-css.js';
import { previewStyles } from './preview-css.js';

/** Context threaded through the tree while rendering. */
export interface RenderContext {
  /** Dataset slug -> entries, for resolving bindings. */
  datasets?: Record<string, readonly Entry[]>;
  /** The entry currently in scope (set by `single`/`list` bindings). */
  entry?: Entry;
  /** Include `draft` entries (preview), otherwise only `published` (parity with publish). */
  includeDrafts?: boolean;
  /** Project media (matched by `asset.url`) — enables optimized `<picture>` for Image blocks. */
  media?: readonly MediaAsset[];
  /**
   * Resolves the emitted URL for a file of a media asset. Preview returns the
   * API-served absolute URL; the publisher returns a path relative to the page
   * so the exported artifact is self-contained and portable.
   */
  mediaUrl?: (asset: MediaAsset, file: string) => string;
  /**
   * Relative path from the current page to the site root (`''` home, `'../'` one
   * level deep, …). Internal root-relative links and asset paths are rebased onto
   * this so the exported site is portable. See `relativeRoot` in @sitewright/core.
   */
  root?: string;
  /**
   * Page-tree-derived navigation items per slot (`buildNav` in @sitewright/core),
   * consumed by `Nav` blocks. Keyed by slot (`header`/`footer`/`mobile`).
   */
  nav?: Record<string, ReadonlyArray<{ label: string; path: string }>>;
}

const PICTURE_SIZES = '(min-width: 1280px) 1280px, 100vw';

/** Builds an optimized `<picture>` for a known media asset (variants + fallback). */
function renderPicture(
  asset: MediaAsset,
  alt: string,
  loading: string,
  mediaUrl: (asset: MediaAsset, file: string) => string,
  cls = '',
): string {
  const srcsetFor = (format: 'avif' | 'webp'): string =>
    asset.variants
      .filter((v) => v.format === format)
      .slice()
      .sort((a, b) => a.width - b.width)
      .map((v) => `${escapeAttr(mediaUrl(asset, v.path))} ${v.width}w`)
      .join(', ');
  const avif = srcsetFor('avif');
  const webp = srcsetFor('webp');
  const fallback = escapeAttr(mediaUrl(asset, asset.fallback));
  return (
    `<picture data-sw-block="Image"${cls}>` +
    (avif ? `<source type="image/avif" srcset="${avif}" sizes="${PICTURE_SIZES}" />` : '') +
    (webp ? `<source type="image/webp" srcset="${webp}" sizes="${PICTURE_SIZES}" />` : '') +
    `<img src="${fallback}" alt="${escapeAttr(alt)}" width="${asset.width}" height="${asset.height}" loading="${loading}" />` +
    `</picture>`
  );
}

const TONES = new Set(['surface', 'primary', 'muted']);

function clamp(value: number, min: number, max: number): number {
  const n = Number.isFinite(value) ? value : min;
  return Math.min(Math.max(n, min), max);
}

/**
 * The author-supplied Tailwind utility classes for a block, as a ` class="…"`
 * attribute fragment (or `''`). Schema-validated to a safe charset, and escaped
 * here too as defense-in-depth so a raw/un-validated node can never break out.
 */
function classAttr(node: PageNode): string {
  return node.className ? ` class="${escapeAttr(node.className)}"` : '';
}

/**
 * Renders an image as an optimized `<picture>` when its src matches a known media
 * asset, else a plain `<img>`. Shared by the Image block and Slide (Carousel).
 */
function imageTag(
  src: string,
  alt: string,
  loading: string,
  ctx: RenderContext,
  root: string,
  cls = '',
): string {
  const asset = ctx.media?.find((m) => m.url === src);
  if (asset && ctx.mediaUrl) return renderPicture(asset, alt, loading, ctx.mediaUrl, cls);
  const imgSrc = resolveInternalUrl(src, root);
  return `<img data-sw-block="Image"${cls} src="${escapeAttr(imgSrc)}" alt="${escapeAttr(alt)}" loading="${loading}" />`;
}

/** Safe dataset lookup that avoids dynamic object indexing. */
function poolFor(ctx: RenderContext, dataset: string): readonly Entry[] {
  const datasets = ctx.datasets;
  if (!datasets) return [];
  const found = Object.entries(datasets).find(([key]) => key === dataset);
  return found ? found[1] : [];
}

/** The entry that applies to a node's own props (after its own `single` binding). */
function ownEntry(node: PageNode, ctx: RenderContext): Entry | undefined {
  const binding = node.binding;
  if (binding?.mode === 'single') {
    const resolved = resolveBinding(binding, poolFor(ctx, binding.dataset), {
      includeDrafts: ctx.includeDrafts,
    });
    return resolved[0] ?? ctx.entry;
  }
  return ctx.entry;
}

function renderChildren(node: PageNode, ctx: RenderContext, selfEntry: Entry | undefined): string {
  const children = node.children ?? [];
  const binding = node.binding;
  if (binding?.mode === 'list') {
    const bound = resolveBinding(binding, poolFor(ctx, binding.dataset), {
      includeDrafts: ctx.includeDrafts,
    });
    return bound
      .map((boundEntry) =>
        children.map((child) => renderNode(child, { ...ctx, entry: boundEntry })).join(''),
      )
      .join('');
  }
  return children.map((child) => renderNode(child, { ...ctx, entry: selfEntry })).join('');
}

/** Renders a single block node (and its subtree) to an HTML string. */
export function renderNode(node: PageNode, ctx: RenderContext = {}): string {
  const props = node.props ?? {};
  const selfEntry = ownEntry(node, ctx);
  const inner = renderChildren(node, ctx, selfEntry);
  const root = ctx.root ?? '';
  // Author-supplied utility classes for this block's root element (Tailwind layer).
  const cls = classAttr(node);

  switch (node.type) {
    case 'Section': {
      const toneRaw = String(props.tone ?? 'surface');
      const tone = TONES.has(toneRaw) ? toneRaw : 'surface';
      return `<section data-sw-block="Section"${cls} data-tone="${tone}"><div data-sw-part="container">${inner}</div></section>`;
    }
    case 'Grid': {
      const columns = clamp(Number(props.columns) || 3, 1, 6);
      return `<div data-sw-block="Grid"${cls} data-columns="${columns}">${inner}</div>`;
    }
    case 'Card':
      return `<div data-sw-block="Card"${cls}>${inner}</div>`;
    case 'Hero': {
      const title = textProp(props, selfEntry, 'title');
      const subtitle = textProp(props, selfEntry, 'subtitle');
      const ctaText = textProp(props, selfEntry, 'ctaText');
      const ctaHref = resolveInternalUrl(urlProp(props, selfEntry, 'ctaHref', '#'), root);
      return (
        `<div data-sw-block="Hero"${cls}>` +
        (title ? `<h1 data-sw-part="title">${escapeHtml(title)}</h1>` : '') +
        (subtitle ? `<p data-sw-part="subtitle">${escapeHtml(subtitle)}</p>` : '') +
        (ctaText
          ? `<a data-sw-part="cta" href="${escapeAttr(ctaHref)}">${escapeHtml(ctaText)}</a>`
          : '') +
        inner +
        `</div>`
      );
    }
    case 'Heading': {
      const level = clamp(Number(props.level) || 2, 1, 6);
      const text = escapeHtml(textProp(props, selfEntry, 'text'));
      return `<h${level} data-sw-block="Heading"${cls}>${text}</h${level}>`;
    }
    case 'RichText': {
      const text = textProp(props, selfEntry, 'text');
      return `<div data-sw-block="RichText"${cls}>${text ? `<p>${escapeHtml(text)}</p>` : ''}${inner}</div>`;
    }
    case 'Image': {
      const src = urlProp(props, selfEntry, 'src', '');
      const alt = textProp(props, selfEntry, 'alt');
      if (!src) return `<div data-sw-block="Image"${cls} data-sw-empty="1"></div>`;
      const loading = props.priority === true ? 'eager' : 'lazy';
      return imageTag(src, alt, loading, ctx, root, cls);
    }
    case 'Button': {
      const text = textProp(props, selfEntry, 'text');
      const href = resolveInternalUrl(urlProp(props, selfEntry, 'href', '#'), root);
      return `<a data-sw-block="Button"${cls} href="${escapeAttr(href)}">${escapeHtml(text)}${inner}</a>`;
    }
    case 'Link': {
      const text = textProp(props, selfEntry, 'text');
      const href = resolveInternalUrl(urlProp(props, selfEntry, 'href', '#'), root);
      return `<a data-sw-block="Link"${cls} href="${escapeAttr(href)}">${escapeHtml(text)}${inner}</a>`;
    }
    case 'Header': {
      const brand = textProp(props, selfEntry, 'brand');
      return `<header data-sw-block="Header"${cls}><div data-sw-part="container"><span data-sw-part="brand">${escapeHtml(brand)}</span><nav data-sw-part="nav">${inner}</nav></div></header>`;
    }
    case 'Footer': {
      const text = textProp(props, selfEntry, 'text');
      return `<footer data-sw-block="Footer"${cls}><div data-sw-part="container">${escapeHtml(text)}${inner}</div></footer>`;
    }
    case 'Html': {
      // Raw HTML embed (map / form / video / third-party widget) — the contentBase
      // "code snippet" equivalent.
      //
      // @security Intentionally NOT escaped. This is the tenant's OWN trusted
      // content for their own exported site. The same two invariants as
      // customHead/customFooter/criticalCss MUST hold: (1) only owner/admin roles
      // can write it — every content write goes through `requireWriteRole` — and
      // (2) `renderDocument` output is served to a browser ONLY inside a sandboxed
      // iframe (preview) or written to the exported artifact, NEVER as a
      // same-origin `text/html` response injected into the editor. The same-origin
      // `/sites/<id>/` preview is additionally covered by the global CSP
      // (`default-src 'self'` with no `script-src` relaxation, so inline + external
      // scripts are both blocked; `img-src 'self' data:` blocks external CSS exfil),
      // so embedded scripts don't run there; they run only on the customer's own
      // webspace after export.
      const raw = textProp(props, selfEntry, 'html');
      return `<div data-sw-block="Html"${cls}>${raw}</div>`;
    }
    case 'Carousel': {
      // Interactive component. Renders PE-first semantic HTML (a scroll-snap track
      // that swipes with no JS); the platform's `components.js` (shipped only when
      // a component is used, from the site's own origin) enhances it with autoplay/
      // arrows/dots/keyboard. Settings come from typed props (end-user-editable).
      const label = textProp(props, selfEntry, 'label');
      const autoplay = props.autoplay === true;
      const loop = props.loop !== false; // default on
      const interval = clamp(Number(props.interval) || 5000, 1000, 60000);
      const a11y = label ? ` aria-label="${escapeAttr(label)}"` : '';
      const arrows =
        props.showArrows !== false
          ? `<button type="button" data-sw-part="prev" aria-label="Previous slide">‹</button>` +
            `<button type="button" data-sw-part="next" aria-label="Next slide">›</button>`
          : '';
      // The dots are built by JS (so the no-JS fallback shows none); the container
      // is decorative until enhanced.
      const dots = props.showDots !== false ? `<div data-sw-part="dots" aria-hidden="true"></div>` : '';
      return (
        `<div data-sw-block="Carousel"${cls} data-sw-component="carousel" ` +
        `data-autoplay="${autoplay}" data-interval="${interval}" data-loop="${loop}" ` +
        `role="region" aria-roledescription="carousel"${a11y}>` +
        `<div data-sw-part="track">${inner}</div>${arrows}${dots}</div>`
      );
    }
    case 'Slide': {
      // One carousel slide: an optional optimized image + an escaped caption. Any
      // author-placed child blocks render after the figure.
      const caption = textProp(props, selfEntry, 'caption');
      const src = urlProp(props, selfEntry, 'image', '');
      const alt = textProp(props, selfEntry, 'alt');
      const img = src ? imageTag(src, alt, 'lazy', ctx, root) : '';
      const figure =
        img || caption
          ? `<figure>${img}${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`
          : '';
      return (
        `<div data-sw-block="Slide"${cls} data-sw-part="slide" role="group" ` +
        `aria-roledescription="slide">${figure}${inner}</div>`
      );
    }
    case 'Accordion':
      // Zero-JS disclosure group (native <details> children). CSS-only component.
      return `<div data-sw-block="Accordion"${cls}>${inner}</div>`;
    case 'AccordionItem': {
      const title = textProp(props, selfEntry, 'title');
      const open = props.open === true ? ' open' : '';
      return (
        `<details data-sw-block="AccordionItem"${cls}${open}>` +
        `<summary>${escapeHtml(title)}</summary>` +
        `<div data-sw-part="content">${inner}</div></details>`
      );
    }
    case 'Lightbox': {
      // A thumbnail grid; the platform JS opens a full-screen overlay. PE-first:
      // the empty overlay is hidden until enhanced; items are plain anchors that,
      // with no JS, just open the full image.
      const label = textProp(props, selfEntry, 'label');
      const a11y = label ? ` aria-label="${escapeAttr(label)}"` : '';
      return (
        `<div data-sw-block="Lightbox"${cls} data-sw-component="lightbox" role="group"${a11y}>` +
        `<div data-sw-part="grid">${inner}</div>` +
        `<div data-sw-part="overlay" aria-hidden="true"></div></div>`
      );
    }
    case 'LightboxItem': {
      const full = urlProp(props, selfEntry, 'image', '');
      if (!full) return `<a data-sw-block="LightboxItem"${cls} data-sw-empty="1"></a>`;
      const thumb = urlProp(props, selfEntry, 'thumb', '') || full;
      const alt = textProp(props, selfEntry, 'alt');
      const caption = textProp(props, selfEntry, 'caption');
      const href = escapeAttr(resolveInternalUrl(full, root));
      const data = caption ? ` data-caption="${escapeAttr(caption)}"` : '';
      // The thumbnail reuses the optimized <picture>/<img> path; the anchor's href
      // (the full image) is the no-JS fallback and the overlay's source.
      return (
        `<a data-sw-block="LightboxItem"${cls} data-sw-part="item" href="${href}"${data}>` +
        `${imageTag(thumb, alt, 'lazy', ctx, root)}</a>`
      );
    }
    case 'Modal': {
      // A trigger button + a native <dialog> (the platform JS wires open/close;
      // <dialog> itself provides focus trap, Escape, and ::backdrop). PE: without
      // JS the dialog stays closed; the trigger is visible.
      const trigger = textProp(props, selfEntry, 'trigger') || 'Open';
      const label = textProp(props, selfEntry, 'label');
      const a11y = label ? ` aria-label="${escapeAttr(label)}"` : '';
      return (
        `<div data-sw-block="Modal"${cls} data-sw-component="modal">` +
        `<button type="button" data-sw-part="open">${escapeHtml(trigger)}</button>` +
        `<dialog data-sw-part="dialog"${a11y} aria-modal="true">` +
        `<button type="button" data-sw-part="close" aria-label="Close">×</button>` +
        `<div data-sw-part="content">${inner}</div></dialog></div>`
      );
    }
    case 'CookieConsent': {
      // Dismissable banner, rendered `hidden`; the platform JS reveals it only when
      // consent isn't already stored, and remembers dismissal. With no JS: no banner.
      const message =
        textProp(props, selfEntry, 'message') || 'We use cookies to improve your experience.';
      const acceptText = textProp(props, selfEntry, 'acceptText') || 'Accept';
      const policyHref = urlProp(props, selfEntry, 'policyHref', '');
      const policyText = textProp(props, selfEntry, 'policyText') || 'Learn more';
      const link = policyHref
        ? ` <a href="${escapeAttr(resolveInternalUrl(policyHref, root))}">${escapeHtml(policyText)}</a>`
        : '';
      return (
        `<div data-sw-block="CookieConsent"${cls} data-sw-component="cookie-consent" ` +
        `role="region" aria-label="Cookie consent" hidden>` +
        `<p>${escapeHtml(message)}${link}</p>` +
        `<button type="button" data-sw-part="accept">${escapeHtml(acceptText)}</button></div>`
      );
    }
    case 'Tabs':
      // The JS builds the tablist from the panels' titles. PE: no JS → the tablist
      // stays hidden (CSS) and all panels render stacked.
      return (
        `<div data-sw-block="Tabs"${cls} data-sw-component="tabs">` +
        `<div data-sw-part="tablist" role="tablist"></div>${inner}</div>`
      );
    case 'Tab': {
      // A tab panel; its `title` (escaped) becomes the generated tab button label.
      const title = textProp(props, selfEntry, 'title');
      return (
        `<div data-sw-block="Tab"${cls} data-sw-part="panel" role="tabpanel" ` +
        `data-sw-title="${escapeAttr(title)}">${inner}</div>`
      );
    }
    case 'Nav': {
      // Auto-nav: render the page-tree-derived menu for this slot. Each item's
      // href is rebased relative to the current page (portable), label escaped.
      // Author-placed child blocks (`inner`) render AFTER the auto-links inside
      // the <nav> wrapper (e.g. a brand mark or CTA) — the block is a container.
      const slot = String(props.slot ?? 'header');
      // Safe lookup (no dynamic object indexing), mirroring poolFor.
      const items = ctx.nav ? (Object.entries(ctx.nav).find(([k]) => k === slot)?.[1] ?? []) : [];
      const links = items
        .map(
          (item) =>
            `<a data-sw-part="nav-link" href="${escapeAttr(resolveInternalUrl(item.path, root))}">${escapeHtml(item.label)}</a>`,
        )
        .join('');
      return `<nav data-sw-block="Nav"${cls} data-slot="${escapeAttr(slot)}">${links}${inner}</nav>`;
    }
    case 'Icon': {
      // Inline a built-in SVG (only used icons ship — no font download). `name`
      // only selects trusted static markup (unknown → empty placeholder). Size is
      // clamped; the accessible label is escaped.
      const size = clamp(Number(props.size) || 24, 8, 256);
      const label = textProp(props, selfEntry, 'label');
      const name = textProp(props, selfEntry, 'name');
      // Brand/social logos (simple-icons): `brand:<slug>` → a single FILL path.
      // Default to `currentColor` (themeable via className/text color); opt into
      // the official brand color with `brandColor: true`. Brand icons are usually
      // the sole content of a link, so they default to a title aria-label.
      if (name.startsWith('brand:')) {
        const brand = brandIcon(name.slice('brand:'.length));
        if (!brand) return `<span data-sw-block="Icon"${cls} data-sw-empty="1"></span>`;
        const fill = props.brandColor === true ? brand.hex : 'currentColor';
        return (
          `<svg data-sw-block="Icon"${cls} xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
          `viewBox="0 0 24 24" fill="${escapeAttr(fill)}" role="img" ` +
          // `path` is a trusted build-time constant (no `"` in SVG path data), but
          // escape it anyway so the attribute-escaping policy is uniform.
          `aria-label="${escapeAttr(label || brand.title)}"><path d="${escapeAttr(brand.path)}"/></svg>`
        );
      }
      // Lucide (stroke-based) UI glyphs.
      const body = iconBody(name);
      if (!body) return `<span data-sw-block="Icon"${cls} data-sw-empty="1"></span>`;
      const a11y = label ? ` role="img" aria-label="${escapeAttr(label)}"` : ' aria-hidden="true"';
      return (
        `<svg data-sw-block="Icon"${cls} xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
        `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
        `stroke-linecap="round" stroke-linejoin="round"${a11y}>${body}</svg>`
      );
    }
    case 'Outlet':
      // Template content-slot marker; normally consumed by resolveTemplate before
      // render. A stray Outlet (page without a template) renders nothing.
      return inner;
    default:
      return `<div data-sw-block="Unknown"${cls} data-type="${escapeAttr(node.type)}">Unknown block: ${escapeHtml(node.type)}${inner}</div>`;
  }
}

/** Renders a page's root subtree to an HTML body fragment. */
export function renderPage(page: Page, ctx: RenderContext = {}): string {
  return renderNode(page.root, ctx);
}

/** Options for {@link renderDocument}. */
export interface RenderDocumentOptions extends RenderContext {
  brand: Brand;
  /** Document language attribute (defaults to `en`). */
  lang?: string;
  /** SEO/Open-Graph metadata; `title` falls back to the page title. */
  seo?: Partial<SeoMeta>;
  /** Auto-generated schema.org Organization block (from company data). */
  organization?: SchemaOrgInfo;
  /**
   * Raw HTML injected into `<head>` / before `</body>` (e.g. analytics tags) —
   * the contentBase `global_head` / `global_bottom` equivalent.
   *
   * @security Intentionally NOT escaped. This is the tenant's own content for
   * their own exported site. Two invariants MUST hold: (1) only owner/admin
   * roles may set these fields, and (2) `renderDocument` output is served to a
   * browser ONLY inside a sandboxed iframe (preview) or written to the exported
   * artifact — NEVER returned as a same-origin `text/html` response in the
   * editor, or raw injection becomes stored XSS against the authed session.
   */
  customHead?: string;
  customFooter?: string;
  /**
   * Project-wide critical CSS, inlined in `<head>` after the brand styles
   * (contentBase's `critical_css`). Same raw-trust model as customHead/customFooter
   * (@security above): tenant's own CSS, owner/admin-set, sandboxed/exported only.
   */
  criticalCss?: string;
  /**
   * External stylesheet hrefs linked at the END of `<head>` (after the inline
   * brand + critical CSS) — the compiled Tailwind utility sheet. Placed last so
   * equal-specificity utilities win by source order. Hrefs are relative to the
   * page (use the page `root`) so the exported bundle stays portable.
   */
  stylesheets?: readonly string[];
  /**
   * CSS inlined as `<style>` blocks at the END of `<head>` (after the brand +
   * critical CSS, alongside `stylesheets`) — the preview's self-contained
   * equivalent of the linked utility sheet. Trusted, machine-generated CSS only
   * (the compiled Tailwind output); never raw user input.
   */
  inlineStyles?: readonly string[];
  /**
   * Deferred external script srcs linked just before `</body>` — the platform's
   * `components.js` (interactive-component behavior), served from the site's own
   * origin so it loads under the `default-src 'self'` CSP. First-party, audited
   * code only; never tenant input. The publish path links these.
   */
  scripts?: readonly string[];
  /**
   * JavaScript inlined in `<script>` blocks just before `</body>` — the preview's
   * self-contained equivalent of `scripts` (the preview document is served under
   * `Content-Security-Policy: sandbox`, an opaque isolated origin, so its inline
   * scripts run but cannot touch the editor). First-party, audited platform code
   * only (the bundled component behavior); never tenant input. The `</script`
   * sequence is neutralized so a future component can't break out of the tag.
   */
  inlineScripts?: readonly string[];
}

/**
 * Renders a complete, self-contained, brand-themed HTML document — the platform
 * skeleton. The `<head>` (meta/Open-Graph, theme-color, favicon, schema.org
 * JSON-LD) is data-driven; page content is escaped; the only raw HTML is the
 * tenant's own custom head/footer. Safe to drop into a sandboxed preview iframe.
 */
export function renderDocument(page: Page, opts: RenderDocumentOptions): string {
  const {
    brand,
    lang = 'en',
    seo,
    organization,
    customHead,
    customFooter,
    criticalCss,
    stylesheets,
    inlineStyles,
    scripts,
    inlineScripts,
    ...ctx
  } = opts;
  const body = renderPage(page, ctx);
  const css = `${previewStyles()}\n${brandToCss(brand)}`;
  // `||` not `??`: an empty-string SEO title must fall back to the page title.
  const title = seo?.title || page.title;
  const meta = metaTags({ ...seo, title });
  const jsonLd = schemaOrgJsonLd(organization);
  return (
    `<!doctype html>\n` +
    `<html lang="${escapeAttr(lang)}">\n` +
    `<head>\n` +
    `<meta charset="utf-8" />\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />\n` +
    `<title>${escapeHtml(title)}</title>\n` +
    `${meta}\n` +
    (jsonLd ? `${jsonLd}\n` : '') +
    (customHead ? `${customHead}\n` : '') +
    `<style>${css}</style>\n` +
    (criticalCss ? `<style>${criticalCss}</style>\n` : '') +
    (inlineStyles ?? []).map((style) => `<style>${style}</style>\n`).join('') +
    (stylesheets ?? [])
      .map((href) => `<link rel="stylesheet" href="${escapeAttr(href)}" />\n`)
      .join('') +
    `</head>\n` +
    `<body>${body}${customFooter ?? ''}` +
    (scripts ?? [])
      .map((src) => `<script defer src="${escapeAttr(src)}"></script>`)
      .join('') +
    (inlineScripts ?? [])
      // Neutralize any `</script` so trusted bundled JS can't close the tag early.
      .map((js) => `<script>${js.replace(/<\/(script)/gi, '<\\/$1')}</script>`)
      .join('') +
    `</body>\n` +
    `</html>`
  );
}
