// Pure, framework-free HTML renderer for the block tree. Produces semantic HTML
// annotated with `data-sw-block` / `data-sw-part` hooks that the preview
// stylesheet targets. ALL text and attributes are escaped, and URLs are passed
// through an allowlist — the output is safe to drop into a sandboxed preview
// iframe even when the page tree contains hostile content.
import type { Brand, Entry, Page, PageNode } from '@sitewright/schema';
import { resolveBinding } from '@sitewright/core';
import { escapeAttr, escapeHtml } from './escape.js';
import { textProp, urlProp } from './props.js';
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
      const ctaHref = urlProp(props, selfEntry, 'ctaHref', '#');
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
      return `<img data-sw-block="Image" src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" loading="${loading}" />`;
    }
    case 'Button': {
      const text = textProp(props, selfEntry, 'text');
      const href = urlProp(props, selfEntry, 'href', '#');
      return `<a data-sw-block="Button" href="${escapeAttr(href)}">${escapeHtml(text)}${inner}</a>`;
    }
    case 'Link': {
      const text = textProp(props, selfEntry, 'text');
      const href = urlProp(props, selfEntry, 'href', '#');
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
}

/**
 * Renders a complete, self-contained, brand-themed HTML document for the live
 * preview iframe. Pure inline CSS + escaped content; no scripts.
 */
export function renderDocument(page: Page, opts: RenderDocumentOptions): string {
  const { brand, lang = 'en', ...ctx } = opts;
  const body = renderPage(page, ctx);
  const css = `${previewStyles()}\n${brandToCss(brand)}`;
  return (
    `<!doctype html>\n` +
    `<html lang="${escapeAttr(lang)}">\n` +
    `<head>\n` +
    `<meta charset="utf-8" />\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />\n` +
    `<title>${escapeHtml(page.title)}</title>\n` +
    `<style>${css}</style>\n` +
    `</head>\n` +
    `<body>${body}</body>\n` +
    `</html>`
  );
}
