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
import { themeCss, themeHtmlAttr, lightContentTokensCss, type ThemeMode } from './theme-mode.js';
import { previewStyles } from './preview-css.js';
import { typographyCss, type FontAsset } from './typography-css.js';
import { stickyHeaderCss } from './sticky-header.js';
import type { StickyHeaderMode } from '@sitewright/schema';

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
   * Opt-in light/dark themes (Website settings). When `enabled`, the dark token CSS is
   * inlined and the `default` theme is pinned onto `<html data-sw-theme>` ('auto' follows the OS).
   * Absent / `enabled:false` → current single-theme behaviour (no change for existing sites).
   */
  theme?: { enabled: boolean; default?: ThemeMode };
  /**
   * Emit the brand's derived light `--sw-color-*-content` tokens even when themes are off — set when a
   * site uses custom effect code (the "None / Custom Code" slots), whose fork snippets reference those
   * text-on-brand tokens. Themes already emit them, so this only fires for themes-off custom sites;
   * sites without custom code stay byte-for-byte unchanged.
   */
  emitBrandContentTokens?: boolean;
  /**
   * RAW-HTML mode (driven by the page's `rawHtml` setting): render the page as FREE-FORM HTML with NO
   * platform injection — omit the platform's OWN CSS (modern-normalize, the unlayered platform defaults,
   * brand tokens, the typography/@font-face block AND the compiled utility sheet) and the platform's OWN
   * JS (the no-flash theme init + the component runtimes) — so the page's own `<style>`/`<script>` (and
   * the site head/criticalCss/scripts slots) are the only styling/behaviour. Used for pasting a
   * self-contained external page verbatim; the preview bridge runtime still loads in the editor preview.
   */
  rawFidelity?: boolean;
  /**
   * Site-wide CONTENT WIDTH (Website "Content width" setting): a CSS px length (e.g. `1200px`) or
   * `none` (full-bleed). Emitted as `:root{--sw-container:…}`, consumed by the `.sw-container` helper.
   * Unset → the helper's built-in `1200px` default. Sanitized before emit (defense-in-depth).
   */
  containerWidth?: string;
  /**
   * Pre-rendered `<body>` HTML for a code-first (Handlebars `source`) page — used INSTEAD
   * of rendering the block tree. The same head/SEO/CSS/script shell is applied.
   */
  bodyHtml?: string;
  /**
   * Space-separated class(es) for the `<body>` element — the site-wide nav/button effect schemes
   * (`sw-nav-*` / `sw-btn-*`) chosen in Website settings. Cascades to the `.menu` nav links + `.btn`s;
   * the effect CSS tree-shakes per scheme. Caller-computed (see `websiteEffectsClasses`); attribute-escaped.
   */
  bodyClass?: string;
  /**
   * STICKY top-header mode (`website.effects.stickyHeader`). When set (not 'none') the `#main-nav`
   * landmark is fixed to the top and the `--sw-header-h` offset token + `.sw-top-padding` spacer are
   * emitted into the base `<style>` here — at first paint, so there's no layout shift. The 'hide-on-
   * scroll'/'shrink' scroll-state runtime is wired by the caller (publish/preview), gated on the mode.
   */
  stickyHeader?: StickyHeaderMode | 'none';
  /**
   * Pre-rendered project-wide skeleton SLOTS (already validated + Handlebars-rendered HTML),
   * injected around the page body in this source order:
   *   `mainNav`, [body], `sidebarLeft`, `sidebarRight`, `footer`, `bottom`.
   * Shared by every page of a multi-page site (authored once in Website settings). Sidebars
   * render after the body and position themselves via their own classes; `bottom` sits after
   * the footer (global modals / schema.org) and before the raw `customScripts` slot.
   */
  mainNav?: string;
  sidebarLeft?: string;
  sidebarRight?: string;
  footer?: string;
  bottom?: string;
  /**
   * Pre-rendered PRELOADER overlay (`<div data-sw-preloader …>`), injected as the FIRST body child
   * when the site enables a preloader. Built by @sitewright/blocks `preloaderHtml()`. A `<noscript>`
   * rule hiding it is emitted alongside so no-JS visitors are never blocked.
   */
  preloader?: string;
  /**
   * Pre-rendered BACK-TO-TOP button (`<button data-sw-back-to-top …>`), injected at body-END (after the
   * bottom slot, before the script slot) when the site enables it. Built by `backToTopHtml()`.
   */
  backToTop?: string;
  /**
   * Pre-rendered CONSENT MANAGER mount (`<div id="sw-consent" data-sw-consent …>`), auto-injected at
   * body-END whenever `website.consent.enabled`. Built by `consentMountMarkup()`. position:fixed, so its
   * DOM location is irrelevant — the author no longer places a `{{sw-consent}}` marker.
   */
  consentMount?: string;
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
  /** Consent-derived `<meta http-equiv="Content-Security-Policy">` content (static-export parity). Omit = none. */
  metaCsp?: string;
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
   * External script srcs linked SYNCHRONOUSLY (no `defer`) at the START of `<head>` — the theme
   * NO-FLASH init (theme.js): it re-applies a returning visitor's stored theme onto `<html
   * data-sw-theme>` before first paint, so their choice never flashes the server default. Render-
   * blocking BY DESIGN (it must run pre-paint) but tiny + cached, and shipped only when a page has a
   * `{{sw-theme-toggle}}`. Served from the site's own origin so it loads under `default-src 'self'`.
   * First-party, audited code only; never tenant input.
   */
  headScripts?: readonly string[];
  /**
   * JS inlined SYNCHRONOUSLY in `<head>` (no `defer`) — the PREVIEW's self-contained equivalent of
   * `headScripts` (the preview is served under `Content-Security-Policy: sandbox`, an opaque origin,
   * so inline scripts run but can't touch the editor). Same pre-paint role as `headScripts`. The
   * `</script` sequence is neutralized. First-party, audited platform code only; never tenant input.
   */
  headInlineScripts?: readonly string[];
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
  /**
   * PREVIEW-ONLY (the whole-site draft preview): move the page scroll from the iframe VIEWPORT onto
   * the `<body>`. Chrome renders a sandboxed sub-frame's VIEWPORT scrollbar as an auto-hiding overlay
   * (so the brand `::-webkit-scrollbar` never shows), but a non-root scroll container's scrollbar is
   * classic + styleable — so the preview gets a real, visible scrollbar like the published tab. The
   * preview runtime bridges `window.scrollY`/scroll events to the body so scroll-linked JS still works.
   * Never set on publish (a top-level tab's viewport scrollbar is already classic).
   */
  previewScroll?: boolean;
  /**
   * The resolved SYSTEM UI strings as a JSON string (see @sitewright/blocks `systemI18nData`),
   * stamped onto `<html data-sw-i18n="…">` for the first-party component RUNTIMES to read +
   * JSON.parse. It MUST be an ATTRIBUTE, not an inline `<script>`: the published site's CSP is
   * `default-src 'self'` with NO `script-src 'unsafe-inline'`, so an inline dict script is blocked
   * (that's also why the component runtimes are external files). Pass it only when interactive
   * components ship (only-used-ships). First-party; never tenant input.
   */
  systemI18n?: string;
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
    theme,
    rawFidelity,
    emitBrandContentTokens,
    containerWidth,
    bodyHtml,
    bodyClass,
    stickyHeader,
    preloader,
    backToTop,
    consentMount,
    mainNav,
    sidebarLeft,
    sidebarRight,
    footer,
    bottom,
    lang = 'en',
    seo,
    organization,
    head,
    customScripts,
    metaCsp,
    criticalCss,
    stylesheets,
    inlineStyles,
    headScripts,
    headInlineScripts,
    scripts,
    inlineScripts,
    previewScroll,
    systemI18n,
    ...ctx
  } = opts;
  // Code-first only: the body is always the pre-rendered Handlebars `source` output. A page with
  // no rendered body (e.g. a brand-new, source-less page) gets an empty `<main>`.
  const body = bodyHtml ?? '';
  // Base layer (modern-normalize + platform defaults) FIRST so the skeleton, brand
  // vars, author criticalCss and the unlayered Tailwind utilities all override it.
  // Site-wide content width → the `--sw-container` var consumed by the `.sw-container` helper (base CSS).
  // Sanitized (schema already constrains it; defense-in-depth keeps any future caller from injecting CSS).
  const containerCss =
    containerWidth && /^(none|\d{2,4}px)$/.test(containerWidth) ? `\n:root{--sw-container:${containerWidth}}` : '';
  // Preview-only: give the sandboxed sub-frame a real, visible scrollbar like the published tab.
  // Two sub-frame-specific problems to beat (neither bites a top-level tab):
  //   1. Chrome paints a sub-frame's VIEWPORT scrollbar as an auto-hiding overlay → move the scroll onto
  //      <body> (a non-root scroll container), whose scrollbar reserves space and stays put.
  //   2. daisyUI's styles.css sets `:root{scrollbar-color: <translucent> transparent}`, which both puts
  //      Chrome in STANDARD-scrollbar mode (so the brand `::-webkit-scrollbar` pseudo never paints in the
  //      sub-frame) AND makes that standard bar see-through. So colour the standard scrollbar with the
  //      OPAQUE brand tokens here — a visible indigo thumb on a page-coloured track. `scrollbar-width:thin`
  //      keeps it slim (like the editor's own bars) so the track isn't the wide OS default.
  // Appended LAST so it wins over previewStyles' `body{min-height:100dvh}`. The preview runtime bridges
  // window scroll → the body so scroll-linked page JS keeps working. NEVER emitted on publish.
  const previewScrollCss = previewScroll
    ? '\nhtml{height:100%;overflow:hidden}' +
      '\nbody{height:100%;min-height:0;overflow-y:auto;scrollbar-width:thin;' +
      // `body` is the scroll container in the preview, so the anchor offset must live here too (it sits
      // on :root for the published site, where html scrolls). `--sw-header-h` is 0 unless a sticky
      // header set it, so this is inert for a static-header preview.
      'scroll-padding-top:var(--sw-header-h,0px);' +
      'scrollbar-color:var(--sw-color-primary,#4f46e5) var(--sw-color-base-100,#ffffff)}'
    : '';
  // Sticky/fixed top-header CSS (the fixed `#main-nav` + the `--sw-header-h` offset token + the
  // `.sw-top-padding` spacer). Emitted here so the offset is correct at FIRST PAINT (no layout shift);
  // '' when the site keeps a static header, so a default site is byte-identical.
  const stickyHeaderStyles = stickyHeaderCss(stickyHeader);
  const css = `${baseStyles()}\n${previewStyles()}\n${brandToCss(brand)}${
    theme?.enabled
      ? `\n${themeCss(brand.colors)}`
      : emitBrandContentTokens
        ? `\n${lightContentTokensCss(brand.colors)}`
        : ''
  }${containerCss}${previewScrollCss}${stickyHeaderStyles ? `\n${stickyHeaderStyles}` : ''}`;
  // Opt-in themes pin the project default onto <html data-sw-theme> ('auto' emits nothing →
  // the prefers-color-scheme media query in the CSS above governs).
  const dataThemeAttr = theme?.enabled ? themeHtmlAttr(theme.default) : '';
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
    `<html lang="${escapeAttr(lang)}"${dataThemeAttr}${systemI18n ? ` data-sw-i18n="${escapeAttr(systemI18n)}"` : ''}>\n` +
    `<head>\n` +
    `<meta charset="utf-8" />\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />\n` +
    // Consent-derived CSP for static-export parity (so a strict external host allows the consented
    // third-party origins); platform-local serving ALSO sets it as a response header. Omitted when no
    // consent integrations are configured, so a consent-off site is byte-identical.
    (metaCsp ? `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(metaCsp)}" />\n` : '') +
    // No-flash color-scheme init FIRST (sync, pre-paint): re-applies a returning visitor's stored
    // scheme before the document renders. External (publish) or inlined (sandboxed preview).
    // RAW-HTML pages omit ALL platform JS (this theme init + the component runtimes below).
    (rawFidelity ? '' : (headScripts ?? []).map((src) => `<script src="${escapeAttr(src)}"></script>\n`).join('')) +
    (rawFidelity
      ? ''
      : (headInlineScripts ?? []).map((js) => `<script>${js.replace(/<\/(script)/gi, '<\\/$1')}</script>\n`).join('')) +
    `<title>${escapeHtml(title)}</title>\n` +
    `${meta}\n` +
    (jsonLd ? `${jsonLd}\n` : '') +
    (head ? `${head}\n` : '') +
    // RAW-FIDELITY replicas omit the platform's own base CSS so it can't fight the imported stylesheet.
    (rawFidelity ? '' : `<style>${css}</style>\n`) +
    (criticalCss ? `<style>${criticalCss}</style>\n` : '') +
    // Neutralize any `</style` so inlined CSS can't break out of the <style> element
    // (defense-in-depth; mirrors the inlineScripts guard below).
    (inlineStyles ?? []).map((style) => `<style>${style.replace(/<\/(style)/gi, '<\\/$1')}</style>\n`).join('') +
    // RAW-FIDELITY replicas also skip the platform's compiled utility sheet (styles.css) — its Tailwind
    // utilities collide with the imported site's same-named classes (e.g. `.w-100` = 100 spacing units
    // here vs. the site's `width:100%`), which would clobber the imported layout.
    (rawFidelity ? [] : (stylesheets ?? []))
      .map((href) => `<link rel="stylesheet" href="${escapeAttr(href)}" />\n`)
      .join('') +
    // Heading/body fonts LAST so they win over Tailwind preflight's element resets (utility
    // classes still override per-element). Applies in code-first + block-tree, preview + publish.
    // No `</style` neutralization needed (unlike inlineStyles): the output is built only from
    // hardcoded stacks + schema-validated weights + a regex-checked (no `<`) family name + the
    // app-controlled fontUrl (no `<`). @font-face urls point at LOCAL self-hosted woff2.
    (rawFidelity ? '' : `<style>${typographyCss(brand?.typography, fontAssets, { fontUrl })}</style>\n`) +
    `</head>\n` +
    // Skeleton landmarks: the platform OWNS the semantic element + unique id for each slot and the
    // page body, so a slot/page author writes neutral HTML (the validator rejects <nav>/<main>/
    // <footer>/<aside> in their content — those landmarks are declared HERE, once). Order:
    // TOP_NAV, MOBILE_NAV, [<main> page body], SIDEBAR_L, SIDEBAR_R, FOOTER, BOTTOM, then the raw
    // `website.scripts` slot (3rd-party widgets) before the platform's own component <script> tags.
    // A slot wrapper is emitted only when that slot has content; <main id="page-content"> is ALWAYS
    // present (every page has a body).
    `<body${bodyClass ? ` class="${escapeAttr(bodyClass)}"` : ''}>` +
    // PRELOADER overlay first (covers first paint + navigation); the <noscript> rule hides it when
    // scripting is off so a no-JS visitor is never trapped behind a never-cleared overlay.
    (preloader ? `${preloader}<noscript><style>[data-sw-preloader]{display:none!important}</style></noscript>` : '') +
    slotLandmark('nav', 'main-nav', mainNav) +
    `<main id="page-content">${body}</main>` +
    slotLandmark('aside', 'sidebar-left', sidebarLeft) +
    slotLandmark('aside', 'sidebar-right', sidebarRight) +
    slotLandmark('footer', 'footer', footer) +
    slotLandmark('div', 'bottom', bottom) +
    `${backToTop ?? ''}` +
    // CONSENT MANAGER mount — auto-injected at body-end when consent is enabled (position:fixed; order N/A).
    `${consentMount ?? ''}` +
    `${customScripts ?? ''}` +
    // RAW-HTML pages omit the platform component runtimes (the page brings its own scripts).
    (rawFidelity ? [] : (scripts ?? []))
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
