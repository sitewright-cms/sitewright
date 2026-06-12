// Code-first HTML document shell. Wraps a pre-rendered Handlebars `<body>` (the tenant's page
// `source`) in the brand-themed platform skeleton: data-driven `<head>` (meta / Open-Graph /
// theme-color / favicon / schema.org JSON-LD), brand + typography CSS, the project-wide skeleton
// slots, and the first-party component scripts. The only raw HTML is the tenant's own head/footer;
// output is served only inside a sandboxed preview iframe or written to the exported artifact.
import type { BrandTokens, MediaAsset, Page } from '@sitewright/schema';
import { escapeAttr, escapeHtml } from './escape.js';
import { metaTags, schemaOrgJsonLd, type SeoMeta, type SchemaOrgInfo } from './head.js';
import { brandToCss } from './brand-css.js';
import { baseStyles } from './base-css.js';
import { previewStyles } from './preview-css.js';
import { typographyCss, type FontAsset } from './typography-css.js';

/** Media context for the document shell — the only render-time inputs the code-first shell reads. */
export interface RenderContext {
  /** Project media — resolves self-hosted (`kind:'font'`) `@font-face` URLs in the `<head>`. */
  media?: readonly MediaAsset[];
  /**
   * Resolves the emitted URL for a file of a media asset. Preview returns the
   * API-served absolute URL; the publisher returns a path relative to the page
   * so the exported artifact is self-contained and portable.
   */
  mediaUrl?: (asset: MediaAsset, file: string) => string;
}

/** Options for {@link renderDocument}. */
export interface RenderDocumentOptions extends RenderContext {
  brand: BrandTokens;
  /**
   * Pre-rendered `<body>` HTML for a code-first (Handlebars `source`) page — used INSTEAD
   * of rendering the block tree. The same head/SEO/CSS/script shell is applied.
   */
  bodyHtml?: string;
  /**
   * Space-separated class(es) for the `<body>` element — the site-wide nav/button effect schemes
   * (`sw-nav-*` / `sw-btn-*`) chosen in Website settings. Cascades to the nav landmarks + `.btn`s;
   * the effect CSS tree-shakes per scheme. Caller-computed (see `websiteThemeClasses`); attribute-escaped.
   */
  bodyClass?: string;
  /**
   * Pre-rendered project-wide skeleton SLOTS (already validated + Handlebars-rendered HTML),
   * injected around the page body in this source order:
   *   `topNav`, `mobileNav`, [body], `sidebarLeft`, `sidebarRight`, `footer`, `bottom`.
   * Shared by every page of a multi-page site (authored once in Website settings). Sidebars
   * render after the body and position themselves via their own classes; `bottom` sits after
   * the footer (global modals / schema.org) and before the raw `customScripts` slot.
   */
  topNav?: string;
  mobileNav?: string;
  sidebarLeft?: string;
  sidebarRight?: string;
  footer?: string;
  bottom?: string;
  /** Document language attribute (defaults to `en`). */
  lang?: string;
  /** SEO/Open-Graph metadata; `title` is always overridden by the page title (there is no separate SEO title). */
  seo?: Partial<SeoMeta>;
  /** Auto-generated schema.org Organization block (from company data). */
  organization?: SchemaOrgInfo;
  /**
   * Raw HTML injected into `<head>` (`head`) and after the page body (`customScripts`) — the
   * contentBase `global_head` / `global_bottom` equivalent (the `website.head` / `website.scripts`
   * raw owner-only slots). Unlike the validated skeleton slots, these are NOT run through the no-JS
   * template validator.
   *
   * @security Intentionally NOT escaped. This is the tenant's own content for
   * their own exported site. Two invariants MUST hold: (1) only owner/admin
   * roles may set these fields, and (2) `renderDocument` output is served to a
   * browser ONLY inside a sandboxed iframe (preview) or written to the exported
   * artifact — NEVER returned as a same-origin `text/html` response in the
   * editor, or raw injection becomes stored XSS against the authed session.
   */
  head?: string;
  customScripts?: string;
  /**
   * Project-wide critical CSS, inlined in `<head>` after the brand styles
   * (contentBase's `critical_css`). Same raw-trust model as the head/customScripts
   * slots (@security above): tenant's own CSS, owner/admin-set, sandboxed/exported only.
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
/**
 * Wrap a skeleton slot's pre-rendered HTML in its platform-owned semantic landmark + unique id —
 * or emit nothing when the slot is empty (no hollow `<nav></nav>` on every page). The `id` is a
 * fixed constant, never author input, so it needs no escaping. Slot CONTENT is validated to NOT
 * itself contain `<nav>/<main>/<footer>/<aside>`, so these landmarks stay unique per document.
 */
function slotLandmark(tag: 'nav' | 'aside' | 'footer' | 'div', id: string, html: string | undefined): string {
  return html ? `<${tag} id="${id}">${html}</${tag}>` : '';
}

export function renderDocument(page: Page, opts: RenderDocumentOptions): string {
  const {
    brand,
    bodyHtml,
    bodyClass,
    topNav,
    mobileNav,
    sidebarLeft,
    sidebarRight,
    footer,
    bottom,
    lang = 'en',
    seo,
    organization,
    head,
    customScripts,
    criticalCss,
    stylesheets,
    inlineStyles,
    scripts,
    inlineScripts,
    ...ctx
  } = opts;
  // Code-first only: the body is always the pre-rendered Handlebars `source` output. A page with
  // no rendered body (e.g. a brand-new, source-less page) gets an empty `<main>`.
  const body = bodyHtml ?? '';
  // Base layer (modern-normalize + platform defaults) FIRST so the skeleton, brand
  // vars, author criticalCss and the unlayered Tailwind utilities all override it.
  const css = `${baseStyles()}\n${previewStyles()}\n${brandToCss(brand)}`;
  // Self-hosted fonts ride in `ctx.media` as `kind:'font'` assets; their `@font-face` urls reuse the
  // media URL resolver (which the publish HTML-rewrite rebases to `_assets/<id>/<file>`).
  const fontAssets = (ctx.media ?? []).filter((m): m is FontAsset => m.kind === 'font');
  const fontUrl = ctx.mediaUrl
    ? (assetId: string, file: string) => {
        const a = fontAssets.find((f) => f.id === assetId);
        return a ? ctx.mediaUrl!(a, file) : '';
      }
    : undefined;
  // The page title IS the document/og title (there is no separate SEO title).
  const title = page.title;
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
    (head ? `${head}\n` : '') +
    `<style>${css}</style>\n` +
    (criticalCss ? `<style>${criticalCss}</style>\n` : '') +
    // Neutralize any `</style` so inlined CSS can't break out of the <style> element
    // (defense-in-depth; mirrors the inlineScripts guard below).
    (inlineStyles ?? []).map((style) => `<style>${style.replace(/<\/(style)/gi, '<\\/$1')}</style>\n`).join('') +
    (stylesheets ?? [])
      .map((href) => `<link rel="stylesheet" href="${escapeAttr(href)}" />\n`)
      .join('') +
    // Heading/body fonts LAST so they win over Tailwind preflight's element resets (utility
    // classes still override per-element). Applies in code-first + block-tree, preview + publish.
    // No `</style` neutralization needed (unlike inlineStyles): the output is built only from
    // hardcoded stacks + schema-validated weights + a regex-checked (no `<`) family name + the
    // app-controlled fontUrl (no `<`). @font-face urls point at LOCAL self-hosted woff2.
    `<style>${typographyCss(brand?.typography, fontAssets, { fontUrl })}</style>\n` +
    `</head>\n` +
    // Skeleton landmarks: the platform OWNS the semantic element + unique id for each slot and the
    // page body, so a slot/page author writes neutral HTML (the validator rejects <nav>/<main>/
    // <footer>/<aside> in their content — those landmarks are declared HERE, once). Order:
    // TOP_NAV, MOBILE_NAV, [<main> page body], SIDEBAR_L, SIDEBAR_R, FOOTER, BOTTOM, then the raw
    // `website.scripts` slot (3rd-party widgets) before the platform's own component <script> tags.
    // A slot wrapper is emitted only when that slot has content; <main id="page-content"> is ALWAYS
    // present (every page has a body).
    `<body${bodyClass ? ` class="${escapeAttr(bodyClass)}"` : ''}>` +
    slotLandmark('nav', 'top-nav', topNav) +
    slotLandmark('nav', 'mobile-nav', mobileNav) +
    `<main id="page-content">${body}</main>` +
    slotLandmark('aside', 'sidebar-left', sidebarLeft) +
    slotLandmark('aside', 'sidebar-right', sidebarRight) +
    slotLandmark('footer', 'footer', footer) +
    slotLandmark('div', 'bottom', bottom) +
    `${customScripts ?? ''}` +
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
