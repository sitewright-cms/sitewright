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
    `<picture data-sw-block="Image">` +
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

  switch (node.type) {
    case 'Section': {
      const toneRaw = String(props.tone ?? 'surface');
      const tone = TONES.has(toneRaw) ? toneRaw : 'surface';
      return `<section data-sw-block="Section" data-tone="${tone}"><div data-sw-part="container">${inner}</div></section>`;
    }
    case 'Grid': {
      const columns = clamp(Number(props.columns) || 3, 1, 6);
      return `<div data-sw-block="Grid" data-columns="${columns}">${inner}</div>`;
    }
    case 'Card':
      return `<div data-sw-block="Card">${inner}</div>`;
    case 'Hero': {
      const title = textProp(props, selfEntry, 'title');
      const subtitle = textProp(props, selfEntry, 'subtitle');
      const ctaText = textProp(props, selfEntry, 'ctaText');
      const ctaHref = resolveInternalUrl(urlProp(props, selfEntry, 'ctaHref', '#'), root);
      return (
        `<div data-sw-block="Hero">` +
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
      return `<h${level} data-sw-block="Heading">${text}</h${level}>`;
    }
    case 'RichText': {
      const text = textProp(props, selfEntry, 'text');
      return `<div data-sw-block="RichText">${text ? `<p>${escapeHtml(text)}</p>` : ''}${inner}</div>`;
    }
    case 'Image': {
      const src = urlProp(props, selfEntry, 'src', '');
      const alt = textProp(props, selfEntry, 'alt');
      if (!src) return `<div data-sw-block="Image" data-sw-empty="1"></div>`;
      const loading = props.priority === true ? 'eager' : 'lazy';
      // A known uploaded asset (matched by url) → optimized <picture>; else plain <img>.
      const asset = ctx.media?.find((m) => m.url === src);
      if (asset && ctx.mediaUrl) return renderPicture(asset, alt, loading, ctx.mediaUrl);
      const imgSrc = resolveInternalUrl(src, root);
      return `<img data-sw-block="Image" src="${escapeAttr(imgSrc)}" alt="${escapeAttr(alt)}" loading="${loading}" />`;
    }
    case 'Button': {
      const text = textProp(props, selfEntry, 'text');
      const href = resolveInternalUrl(urlProp(props, selfEntry, 'href', '#'), root);
      return `<a data-sw-block="Button" href="${escapeAttr(href)}">${escapeHtml(text)}${inner}</a>`;
    }
    case 'Link': {
      const text = textProp(props, selfEntry, 'text');
      const href = resolveInternalUrl(urlProp(props, selfEntry, 'href', '#'), root);
      return `<a data-sw-block="Link" href="${escapeAttr(href)}">${escapeHtml(text)}${inner}</a>`;
    }
    case 'Header': {
      const brand = textProp(props, selfEntry, 'brand');
      return `<header data-sw-block="Header"><div data-sw-part="container"><span data-sw-part="brand">${escapeHtml(brand)}</span><nav data-sw-part="nav">${inner}</nav></div></header>`;
    }
    case 'Footer': {
      const text = textProp(props, selfEntry, 'text');
      return `<footer data-sw-block="Footer"><div data-sw-part="container">${escapeHtml(text)}${inner}</div></footer>`;
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
      return `<nav data-sw-block="Nav" data-slot="${escapeAttr(slot)}">${links}${inner}</nav>`;
    }
    case 'Outlet':
      // Template content-slot marker; normally consumed by resolveTemplate before
      // render. A stray Outlet (page without a template) renders nothing.
      return inner;
    default:
      return `<div data-sw-block="Unknown" data-type="${escapeAttr(node.type)}">Unknown block: ${escapeHtml(node.type)}${inner}</div>`;
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
}

/**
 * Renders a complete, self-contained, brand-themed HTML document — the platform
 * skeleton. The `<head>` (meta/Open-Graph, theme-color, favicon, schema.org
 * JSON-LD) is data-driven; page content is escaped; the only raw HTML is the
 * tenant's own custom head/footer. Safe to drop into a sandboxed preview iframe.
 */
export function renderDocument(page: Page, opts: RenderDocumentOptions): string {
  const { brand, lang = 'en', seo, organization, customHead, customFooter, criticalCss, ...ctx } =
    opts;
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
    `</head>\n` +
    `<body>${body}${customFooter ?? ''}</body>\n` +
    `</html>`
  );
}
