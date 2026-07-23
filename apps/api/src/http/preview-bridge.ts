import {
  RICH_TOOLBAR,
  RICH_COLORS,
  RICH_HIGHLIGHTS,
  RICH_SIZES,
  RICH_ALIGNS,
  RICH_COLOR_CLASSES,
  RICH_HIGHLIGHT_CLASSES,
  RICH_SIZE_CLASSES,
  RICH_ALIGN_CLASSES,
  RICH_INDENT_STEPS,
} from '@sitewright/blocks';

// The shared rich-text toolbar vocabulary + palettes, serialised into the injected bridge so the on-page
// `data-sw-html` toolbar renders the SAME commands/order/classes as the dataset richtext toolbar (React).
// Pure DATA only (functions can't cross into the injected string) — the bridge re-implements the tiny
// class-toggle math (setGroupClass/stepIndent) inline in vanilla JS below.
const RICH_TB_DATA = {
  toolbar: RICH_TOOLBAR,
  colors: RICH_COLORS,
  highlights: RICH_HIGHLIGHTS,
  sizes: RICH_SIZES,
  aligns: RICH_ALIGNS,
  colorClasses: [...RICH_COLOR_CLASSES],
  highlightClasses: [...RICH_HIGHLIGHT_CLASSES],
  sizeClasses: [...RICH_SIZE_CLASSES],
  alignClasses: [...RICH_ALIGN_CLASSES],
  indentSteps: RICH_INDENT_STEPS,
};

/**
 * First-party bridge script injected into the SANDBOXED preview document (opaque origin, no
 * `allow-same-origin`) — the only way the editor parent can coordinate with it is `postMessage`.
 *
 * It is added to the preview doc's `inlineScripts` ONLY from the `/preview` route (never from the
 * publish build), so it can never reach a published artifact. Injected at the END of `<body>`, so
 * the document is laid out by the time it runs.
 *
 * Protocol (every message carries a `source` tag; both ends validate it + the parent additionally
 * checks `event.source === iframe.contentWindow`):
 *   preview → editor: { source:'sitewright-preview', type:'ready' }
 *                     { source:'sitewright-preview', type:'scroll', y }
 *                     { source:'sitewright-preview', type:'edit', key, value }          (plain text)
 *                     { source:'sitewright-preview', type:'translate-edit', key, value } (data-sw-translate → website.translations)
 *                     { source:'sitewright-preview', type:'rich-edit', key, html }       (data-sw-html)
 *                     { source:'sitewright-preview', type:'link-edit', hrefKey, href, textKey, text } (data-sw-href)
 *                     { source:'sitewright-preview', type:'pick-image', key, kind:'image'|'bg' }   (data-sw-src/bg)
 *                     { source:'sitewright-preview', type:'open-entry', dataset, id }              (data-sw-entry)
 *                     { source:'sitewright-preview', type:'edit-html-source', key, html }          (data-sw-html → source modal)
 *                     { source:'sitewright-preview', type:'pick-media' }                            (rich toolbar → open media picker)
 *                     { source:'sitewright-preview', type:'control-edit', target, as, value }       (sw-control set)
 *                     { source:'sitewright-preview', type:'control-pick-image', target, as }        (sw-control image/file)
 *                     { source:'sitewright-preview', type:'regions', items:[{rid,kind,label,dataset?,id?}] } (Regions rail manifest)
 *   editor → preview: { source:'sitewright-editor', type:'scrollTo', y }
 *                     { source:'sitewright-editor', type:'setMode', mode }
 *                     { source:'sitewright-editor', type:'edit-region', rid }   (Regions rail: locate + edit a region)
 *                     { source:'sitewright-editor', type:'ci-palette', colors, fonts } (brand colours/font slots → rich toolbar)
 *                     { source:'sitewright-editor', type:'insert-media', url, alt, width, height }  (media dialog → <img>)
 *
 * Editing surfaces (content mode): [data-sw-text] → plaintext contenteditable;
 * [data-sw-translate] → plaintext contenteditable too, but the edit writes the SHARED project
 * translation catalog (website.translations) instead of page.data; [data-sw-html] → rich
 * contenteditable with a floating formatting toolbar; [data-sw-href] anchor →
 * a URL(+text) popover; [data-sw-src]/[data-sw-bg] → click to replace via the editor's file picker.
 * The parent re-sanitizes rich/link payloads + URLs (the iframe is untrusted).
 *
 * Scroll RESTORE across a full reload is done via the `#sw-y=<n>` hash the editor appends to each
 * new preview URL (read synchronously here), not an inbound message — a brand-new document's
 * listener may not be attached yet when the parent fires.
 */
export const PREVIEW_BRIDGE_JS = `(function () {
  var SELF = 'sitewright-preview', PARENT = 'sitewright-editor';
  function post(msg) { var out = {}; for (var k in msg) out[k] = msg[k]; out.source = SELF; try { parent.postMessage(out, '*'); } catch (e) {} }
  function restore() {
    var m = /[#&]sw-y=(\\d+)/.exec(location.hash || '');
    if (m) { try { window.scrollTo(0, parseInt(m[1], 10) || 0); } catch (e) {} }
  }
  // Report scroll back to the editor (rAF-coalesced) so it can restore on the next reload.
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      post({ type: 'scroll', y: window.scrollY || window.pageYOffset || 0 });
      repositionHud(); // keep the active-element HUD glued to its target as the page scrolls
    });
  }, { passive: true });

  var editing = false, styled = false;

  // --- Shared rich-text toolbar spec (from @sitewright/blocks) + the project's CI palette (set by the editor
  //     via a 'ci-palette' message). Icons are inline SVG paths keyed by the SAME command ids the dataset
  //     toolbar maps to lucide components, so the two toolbars look identical. ---
  var RTB = ${JSON.stringify(RICH_TB_DATA)};
  var ciColors = [], ciFonts = [];
  var TB_ICONS = {
    bold: '<path d="M6 12h8a4 4 0 0 0 0-8H6z"/><path d="M6 12h9a4 4 0 0 1 0 8H6z"/>',
    italic: '<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
    underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/>',
    strike: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/>',
    superscript: '<path d="m4 19 8-8"/><path d="m12 19-8-8"/><path d="M20 12h-4c0-1.5.5-2 1.5-2.5S20 8.5 20 7.5a1.5 1.5 0 0 0-3 0"/>',
    subscript: '<path d="m4 5 8 8"/><path d="m12 5-8 8"/><path d="M20 21h-4c0-1.5.5-2 1.5-2.5S20 17.5 20 16.5a1.5 1.5 0 0 0-3 0"/>',
    color: '<path d="m2 15 7-7 7 7"/><path d="M12 5 9 8"/><path d="M5 15h8"/><path d="M18 22a2 2 0 0 0 2-2c0-1.5-2-4-2-4s-2 2.5-2 4a2 2 0 0 0 2 2Z"/>',
    highlight: '<path d="m9 11-6 6v3h3l6-6"/><path d="m22 12-4.6 4.6a1.4 1.4 0 0 1-2 0l-5-5a1.4 1.4 0 0 1 0-2L15 5"/>',
    font: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
    size: '<path d="M3.5 13h6"/><path d="m2 16 4.5-9 4.5 9"/><path d="M18 16V7"/><path d="m14 11 4-4 4 4"/>',
    h2: '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 10c1.5-1.5 4 0 4 2 0 1-1 2-2 2.5L17 18h4"/>',
    h3: '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.5-1 3.5 0 3.5 1.5s-1.5 2-2 2"/><path d="M17 17c1.5 1 4 .5 4-1.5s-2-2.5-3-1.5"/>',
    paragraph: '<path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/>',
    quote: '<path d="M7 6H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2c0 2-1 3-2 3"/><path d="M17 6h-3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2c0 2-1 3-2 3"/>',
    bulletList: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><circle cx="3.5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="3.5" cy="18" r="1" fill="currentColor" stroke="none"/>',
    orderedList: '<line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
    outdent: '<polyline points="7 8 3 12 7 16"/><line x1="21" x2="11" y1="12" y2="12"/><line x1="21" x2="11" y1="6" y2="6"/><line x1="21" x2="11" y1="18" y2="18"/>',
    indent: '<polyline points="3 8 7 12 3 16"/><line x1="21" x2="11" y1="12" y2="12"/><line x1="21" x2="11" y1="6" y2="6"/><line x1="21" x2="11" y1="18" y2="18"/>',
    align: '<line x1="21" x2="3" y1="6" y2="6"/><line x1="15" x2="3" y1="12" y2="12"/><line x1="17" x2="3" y1="18" y2="18"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    media: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    table: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
    rule: '<path d="M5 12h14"/>',
    clear: '<path d="m7 21-4.3-4.3a2 2 0 0 1 0-2.8l9-9a2 2 0 0 1 2.8 0l4.6 4.6a2 2 0 0 1 0 2.8L15 21"/><path d="M22 21H8"/><path d="m5 11 9 9"/>',
    source: '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>',
    more: '<circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/>'
  };
  function tbSvg(id) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (TB_ICONS[id] || TB_ICONS.paragraph) + '</svg>'; }

  // Internal-link navigation: a click on a SITE link (root-relative "/path") tells the EDITOR to open
  // that page's editor, instead of navigating this sandboxed preview to a non-preview URL (which just
  // breaks the iframe). Capture phase so it precedes the per-anchor handlers; while editing, an
  // editable [data-sw-href] link keeps its own link-edit popover (its bubble handler), so skip those.
  // External ("//"/"http"/"mailto:"…), fragment ("#") and target=_blank links are left alone.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    if (editing && a.hasAttribute('data-sw-href')) return; // editable link → its edit popover wins
    if (editing && a.closest('[data-sw-entry]')) return; // inside an editable dataset card → entry editor wins
    // While editing, a link that sits INSIDE editable content (e.g. an <a> in rich html, or an external-href
    // editable link) must never navigate — you're editing, not browsing. Suppress it entirely.
    if (editing && a.closest('[data-sw-text],[data-sw-html],[data-sw-translate],[data-sw-src],[data-sw-bg],[data-sw-control]')) { e.preventDefault(); e.stopPropagation(); return; }
    if (a.getAttribute('target') === '_blank') return;
    var href = a.getAttribute('href') || '';
    if (href.charAt(0) !== '/' || href.charAt(1) === '/') return; // only root-relative site routes
    e.preventDefault();
    e.stopPropagation();
    post({ type: 'link-click', href: href });
  }, true);

  function ensureStyle() {
    if (styled) return; styled = true;
    var s = document.createElement('style');
    s.textContent =
      // Base affordance for EVERY editable leaf: a THICK, INSET, dashed outline (transparent here —
      // each on-state rule below supplies only the outline-COLOR). In content mode the on-state
      // classes light this up so every editable element is clearly marked AT REST, no hover needed.
      '[data-sw-text],[data-sw-html],[data-sw-href],[data-sw-src],[data-sw-bg],[data-sw-translate]{outline:2px dashed transparent;outline-offset:-2px;border-radius:2px;transition:outline-color .12s,background-color .12s}' +
      // Text/rich: dashed indigo at rest; a faint bg tint on hover; the outline goes SOLID while editing (focus).
      '.sw-edit-on{cursor:text;outline-color:#6366f1}' +
      '.sw-edit-on:hover{background:rgba(99,102,241,.08)}' +
      '.sw-edit-on:focus{outline-style:solid;background:rgba(99,102,241,.12)}' +
      // Translations: same plaintext editing, but GREEN (a site-wide shared string, not page content).
      '.sw-tr-on{cursor:text;outline-color:#059669}' +
      '.sw-tr-on:hover{background:rgba(5,150,105,.08)}' +
      '.sw-tr-on:focus{outline-style:solid;background:rgba(5,150,105,.12)}' +
      // Links: dashed indigo at rest; a bg tint on hover (a click opens the link editor).
      '[data-sw-href].sw-link-on{cursor:pointer;outline-color:#6366f1}' +
      '[data-sw-href].sw-link-on:hover{background:rgba(99,102,241,.10)}' +
      // Images/bg: dashed indigo at rest; an inset tint overlay on hover (a click opens the picker).
      '[data-sw-src].sw-img-on,[data-sw-bg].sw-img-on{cursor:pointer;outline-color:#6366f1}' +
      '[data-sw-src].sw-img-on:hover,[data-sw-bg].sw-img-on:hover{box-shadow:inset 0 0 0 9999px rgba(99,102,241,.12)}' +
      // Dataset rows: same always-on marker, in teal to distinguish a structured entry from inline content.
      '[data-sw-entry].sw-entry-on{cursor:pointer;outline:2px dashed #14b8a6;outline-offset:-2px;border-radius:3px;transition:outline-color .12s,background-color .12s}' +
      '[data-sw-entry].sw-entry-on:hover{background:rgba(20,184,166,.08)}' +
      // --- Editable-region OVERLAY HUD: the field-name BADGES + the active OUTLINE live in a body-level,
      // position:fixed, max-z layer (built in JS below) — NOT as a host ::before. So they are never
      // clipped by the host's (or an ancestor's) overflow, never covered by host content, immune to host
      // styling, and CLICKABLE. The ambient dashed outline above still marks every region at rest; the
      // HUD reinforces + makes interactive the element(s) under the pointer/focus. ---
      '.sw-ov{position:fixed;inset:0;pointer-events:none;z-index:2147483646}' +
      '.sw-ov-box{position:fixed;pointer-events:none;border:2px dashed #6366f1;border-radius:3px;box-sizing:border-box}' +
      '.sw-ov-box.sw-b-tr{border-color:#059669}.sw-ov-box.sw-b-entry{border-color:#14b8a6}' +
      '.sw-ov-row{position:fixed;display:flex;flex-wrap:wrap;align-items:flex-end;gap:4px;pointer-events:none;max-width:90vw}' +
      // all:unset wipes host inheritance; an explicit MONOSPACE font + WHITE svg icon make every badge
      // uniform regardless of the element it marks. pointer-events:auto → the badge itself is clickable.
      '.sw-ov-badge{all:unset;position:relative;box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;pointer-events:auto;cursor:pointer;padding:2px 6px 2px 5px;border-radius:5px 5px 5px 0;background:#6366f1;color:#fff;font:600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35)}' +
      '.sw-ov-badge:hover{filter:brightness(1.12);z-index:3}' + // raise the hovered badge so its tooltip clears its neighbours
      '.sw-ov-badge.sw-b-tr{background:#059669}.sw-ov-badge.sw-b-entry{background:#14b8a6}' +
      '.sw-ov-badge svg{width:13px;height:13px;flex:0 0 auto;display:block;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
      // DaisyUI-style DETAIL tooltip on a badge (self-contained — never depends on the rendered site CSS).
      // It names the binding TYPE + the FULL path of the field to edit, BELOW the badge (the badge sits on
      // the element's top edge, so below keeps the bubble in view + over the element). content=data-tip.
      '.sw-ov-badge[data-tip]:hover::after,.sw-ov-badge[data-tip]:focus-visible::after{content:attr(data-tip);position:absolute;left:0;top:calc(100% + 6px);z-index:1;width:max-content;max-width:300px;white-space:normal;word-break:break-word;padding:5px 9px;border-radius:5px;background:#111827;color:#fff;font:500 11.5px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:normal;text-align:left;box-shadow:0 6px 20px rgba(0,0,0,.45)}' +
      '.sw-ov-badge[data-tip]:hover::before,.sw-ov-badge[data-tip]:focus-visible::before{content:"";position:absolute;left:11px;top:calc(100% + 1px);z-index:1;border:5px solid transparent;border-bottom-color:#111827}' +
      // Locate flash: a brief amber ring when the Regions panel jumps to an element (fades out via the keyframe).
      '@keyframes sw-flash{0%{box-shadow:0 0 0 3px #f59e0b}100%{box-shadow:0 0 0 3px rgba(245,158,11,0)}}' +
      '.sw-flash{animation:sw-flash 1.2s ease-out;border-radius:3px}' +
      // Floating rich-text toolbar — matches the dataset richtext toolbar's look (light bar, lucide-style SVG
      // icons, indigo hover, group separators). SOLID white (not translucent) so it stays legible over any
      // rendered site content it floats above.
      '.sw-tb{position:fixed;z-index:2147483647;display:none;align-items:center;gap:1px;padding:3px;border-radius:9px;background:#fff;border:1px solid #e2e8f0;box-shadow:0 6px 22px rgba(15,23,42,.18);font:600 12px system-ui,-apple-system,Segoe UI,sans-serif}' +
      '.sw-tb button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:26px;min-width:26px;padding:0 3px;border-radius:6px;color:#64748b;cursor:pointer}' +
      '.sw-tb button:hover{background:#eef2ff;color:#4338ca}' +
      '.sw-tb button.sw-tb-on{background:#e0e7ff;color:#4338ca}' +
      '.sw-tb button svg{width:16px;height:16px;display:block;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
      '.sw-tb .sw-tb-sep{width:1px;height:15px;margin:0 2px;background:#e2e8f0;flex:0 0 auto}' +
      // Popover (colour/highlight swatch grids · font/size/align menus · link URL input · the overflow "more"
      // list). Fixed-position, max-z, own styling — never depends on the rendered site CSS.
      '.sw-tb-pop{position:fixed;z-index:2147483647;display:none;box-sizing:border-box;padding:8px;border-radius:10px;background:#fff;border:1px solid #e2e8f0;box-shadow:0 10px 30px rgba(15,23,42,.22);font:500 12px system-ui,-apple-system,Segoe UI,sans-serif;color:#334155;max-width:290px}' +
      '.sw-tb-pop .sw-tb-h{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#94a3b8;margin:0 0 5px}' +
      '.sw-tb-pop .sw-tb-grid{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 8px}' +
      '.sw-tb-pop .sw-tb-grid:last-child{margin-bottom:0}' +
      '.sw-tb-sw{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;border:1px solid #e2e8f0;cursor:pointer;font-weight:800;font-size:13px;color:#334155}' +
      '.sw-tb-sw:hover{outline:2px solid #a5b4fc;outline-offset:1px}' +
      '.sw-tb-item{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:7px;width:100%;padding:5px 9px;border-radius:6px;cursor:pointer;color:#334155;white-space:nowrap}' +
      '.sw-tb-item:hover{background:#eef2ff;color:#4338ca}' +
      '.sw-tb-item svg{width:15px;height:15px;flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
      '.sw-tb-pop .sw-tb-row{display:flex;align-items:center;gap:6px}' +
      '.sw-tb-pop input{font:500 12px system-ui;padding:5px 7px;border:1px solid #cbd5e1;border-radius:6px;width:210px;outline:none}' +
      '.sw-tb-pop input:focus{border-color:#6366f1}' +
      '.sw-tb-pop .sw-tb-apply{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;padding:6px 11px;border-radius:6px;background:#4f46e5;color:#fff;font-weight:600;cursor:pointer}' +
      '.sw-tb-pop .sw-tb-check{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;color:#475569;cursor:pointer;user-select:none}' +
      '.sw-tb-pop .sw-tb-check input{width:auto;padding:0;margin:0;cursor:pointer}' +
      '.sw-pop{position:fixed;z-index:2147483647;display:none;flex-direction:column;gap:6px;padding:8px;border-radius:10px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25);font:13px system-ui,sans-serif;min-width:240px}' +
      '.sw-pop label{display:flex;flex-direction:column;gap:2px;font-size:11px;color:#64748b}' +
      '.sw-pop input,.sw-pop select,.sw-pop textarea{font:13px system-ui;padding:5px 7px;border:1px solid #cbd5e1;border-radius:6px}' +
      '.sw-pop .sw-pop-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:2px}' +
      '.sw-pop button{font:600 12px system-ui;padding:4px 10px;border-radius:6px;border:0;cursor:pointer}' +
      '.sw-pop .sw-ok{background:#4f46e5;color:#fff}.sw-pop .sw-cancel{background:#e2e8f0;color:#334155}' +
      // Editor-only CONTROL chips: hidden by default; shown as an inline pill ONLY in content mode (the
      // bridge adds .sw-control-on). Publish strips the element entirely (directives.ts).
      '[data-sw-control]{display:none}' +
      '.sw-control-on{display:inline-flex;align-items:center;gap:.35em;cursor:pointer;max-width:22rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 9px;border-radius:9999px;background:#eef2ff;border:1px dashed #6366f1;color:#4338ca;font:600 12px system-ui,sans-serif;line-height:1.5;vertical-align:middle}' +
      '.sw-control-on:hover{background:#e0e7ff}' +
      // Inline image RESIZE overlay: a fixed outline over the selected rich-content <img> with 4 corner
      // handles (aspect-locked drag) + a live dimension badge. Body-level, max-z, so it never clips.
      '.sw-rz{position:fixed;z-index:2147483646;box-sizing:border-box;display:none;border:1.5px solid #6366f1;pointer-events:none}' +
      '.sw-rz-h{position:absolute;width:11px;height:11px;background:#fff;border:1.5px solid #6366f1;border-radius:2px;pointer-events:auto}' +
      '.sw-rz-se{right:-6px;bottom:-6px;cursor:nwse-resize}' +
      '.sw-rz-dim{position:absolute;right:0;bottom:-21px;background:#0f172a;color:#fff;font:600 10px system-ui,sans-serif;padding:1px 6px;border-radius:4px;white-space:nowrap;pointer-events:none}';
    (document.head || document.documentElement).appendChild(s);
  }

  // closest ancestor (incl. self) that has the given attribute.
  function closestAttr(node, attr) {
    while (node && node !== document) {
      if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute(attr)) return node;
      node = node.parentNode;
    }
    return null;
  }

  // --- Plain text ([data-sw-text], excluding link anchors) ---
  function plainKey(el) { return el.getAttribute('data-sw-text') || ''; }
  function onPlainInput(e) { var el = e.currentTarget; post({ type: 'edit', key: plainKey(el), value: el.textContent || '' }); }

  // --- Project translations ([data-sw-translate]): plain-text editing that writes the SHARED catalog. ---
  function onTranslateInput(e) { var el = e.currentTarget; post({ type: 'translate-edit', key: el.getAttribute('data-sw-translate') || '', value: el.textContent || '' }); }

  // --- Rich ([data-sw-html]) floating toolbar — built from the shared RTB spec; emits Tailwind CLASSES for
  //     colour/highlight/size/font/align/indent (mirrors apps/editor/src/lib/rich-dom.ts) + semantic tags for
  //     marks/blocks. Single row that COLLAPSES trailing groups into a ⋯ overflow menu, positioned ABOVE the
  //     selection (never covering the text being edited). ---
  var toolbar = null, tbMore = null, tbMoreItems = [], tbPop = null, tbActiveId = null, tbLastAvail = -1, tbSavedRange = null, tbLinkRange = null;
  function currentRich() {
    var sel = window.getSelection && window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    return closestAttr(sel.anchorNode, 'data-sw-html');
  }
  function onRichInput(e) { var el = e.currentTarget; post({ type: 'rich-edit', key: el.getAttribute('data-sw-html'), html: el.innerHTML }); }
  function tbEmit() { var rich = currentRich(); if (rich) post({ type: 'rich-edit', key: rich.getAttribute('data-sw-html'), html: rich.innerHTML }); }

  // ---- pure class-list math (mirrors @sitewright/blocks setGroupClass / stepIndentClass) ----
  function tbTokens(cls) { var out = [], parts = (cls || '').split(/\\s+/); for (var i = 0; i < parts.length; i++) { var t = parts[i]; if (t && out.indexOf(t) < 0) out.push(t); } return out; }
  function tbSetGroup(cls, group, add) { var kept = tbTokens(cls).filter(function (t) { return group.indexOf(t) < 0; }); if (add) kept.push(add); return kept.join(' '); }
  function tbStepIndent(cls, dir) {
    var steps = RTB.indentSteps, toks = tbTokens(cls), cur = '';
    for (var i = 0; i < toks.length; i++) { if (steps.indexOf(toks[i]) > 0) { cur = toks[i]; break; } }
    var idx = steps.indexOf(cur); if (idx < 0) idx = 0;
    var n = Math.min(steps.length - 1, Math.max(0, idx + dir));
    return tbSetGroup(cls, steps.filter(function (s) { return s; }), steps[n] || undefined);
  }
  // ---- DOM apply (mirrors apps/editor/src/lib/rich-dom.ts) ----
  function tbSelRange(rich) { var sel = window.getSelection(); if (!sel || !sel.rangeCount) return null; var r = sel.getRangeAt(0); if (r.collapsed || !rich.contains(r.commonAncestorContainer)) return null; return r; }
  function tbApplyInline(rich, group, cls) {
    var r = tbSelRange(rich); if (!r) return;
    // Fast path: selection covers a whole <span> wrapper → retag its group class in place (no nested spans).
    var host = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
    if (host && host !== rich && host.tagName === 'SPAN' && host.textContent === r.toString()) {
      var retag = tbSetGroup(host.getAttribute('class'), group, cls || undefined);
      if (retag) host.setAttribute('class', retag); else host.removeAttribute('class');
      return;
    }
    var holder = document.createElement('div'); holder.appendChild(r.extractContents());
    var kids = holder.querySelectorAll('[class]');
    for (var i = 0; i < kids.length; i++) { var c = tbSetGroup(kids[i].getAttribute('class'), group); if (c) kids[i].setAttribute('class', c); else kids[i].removeAttribute('class'); }
    var ins;
    if (cls) { var span = document.createElement('span'); span.className = cls; while (holder.firstChild) span.appendChild(holder.firstChild); ins = span; }
    else { ins = document.createDocumentFragment(); while (holder.firstChild) ins.appendChild(holder.firstChild); }
    var f = ins.firstChild, l = ins.lastChild; r.insertNode(ins);
    var sel = window.getSelection();
    if (sel && f && l) { var nr = document.createRange(); nr.setStartBefore(cls ? ins : f); nr.setEndAfter(cls ? ins : l); sel.removeAllRanges(); sel.addRange(nr); }
  }
  function tbTopBlock(rich, node) { var el = node.nodeType === 1 ? node : node.parentNode; while (el && el !== rich) { if (el.parentNode === rich) return el; el = el.parentNode; } return null; }
  function tbBlocks(rich) {
    var sel = window.getSelection(); if (!sel || !sel.rangeCount) return [];
    var r = sel.getRangeAt(0); if (!rich.contains(r.commonAncestorContainer)) return [];
    var start = tbTopBlock(rich, r.startContainer);
    if (!start) { try { document.execCommand('formatBlock', false, 'p'); } catch (e) {} var s2 = window.getSelection(); if (!s2 || !s2.rangeCount) return []; r = s2.getRangeAt(0); start = tbTopBlock(rich, r.startContainer); if (!start) return []; }
    var end = tbTopBlock(rich, r.endContainer) || start, out = [];
    for (var el = start; el; el = el.nextElementSibling) { out.push(el); if (el === end) break; }
    return out;
  }
  function tbApplyBlock(rich, group, cls) { var bs = tbBlocks(rich); for (var i = 0; i < bs.length; i++) { var c = tbSetGroup(bs[i].getAttribute('class'), group, cls || undefined); if (c) bs[i].setAttribute('class', c); else bs[i].removeAttribute('class'); } }
  function tbStepBlockIndent(rich, dir) { var bs = tbBlocks(rich); for (var i = 0; i < bs.length; i++) { var c = tbStepIndent(bs[i].getAttribute('class'), dir); if (c) bs[i].setAttribute('class', c); else bs[i].removeAttribute('class'); } }
  function tbInsertTable() { try { document.execCommand('insertHTML', false, '<table><thead><tr><th>Heading</th><th>Heading</th></tr></thead><tbody><tr><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td></tr></tbody></table><p><br></p>'); } catch (e) {} }
  // The <a> enclosing the current selection within the rich region (for edit-in-place / pre-fill), or null.
  function tbCurrentAnchor(rich) {
    var sel = window.getSelection(); if (!sel || !sel.rangeCount) return null;
    var cac = sel.getRangeAt(0).commonAncestorContainer;
    if (!rich.contains(cac)) return null; // selection not in this region (e.g. focus moved to a popover input)
    var n = cac.nodeType === 1 ? cac : (cac ? cac.parentNode : null);
    while (n && n !== rich) { if (n.nodeType === 1 && n.tagName === 'A') return n; n = n.parentNode; }
    return null;
  }
  // Apply a link: edit the enclosing <a> in place, else wrap a non-empty selection (createLink), else insert a
  // NEW anchor with the URL as its text (so a collapsed caret still produces a clickable link). Empty url unlinks.
  // newTab → target=_blank + rel (the sanitizer also forces rel on target). All hrefs are scheme-gated.
  function tbApplyLink(rich, url, newTab) {
    url = tbSafeHref(url);
    var existing = tbCurrentAnchor(rich);
    if (!url) { if (existing) { try { document.execCommand('unlink'); } catch (e) {} } return; }
    function setTab(a) { if (newTab) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); } else { a.removeAttribute('target'); a.removeAttribute('rel'); } }
    if (existing) { existing.setAttribute('href', url); setTab(existing); return; }
    var sel = window.getSelection();
    var collapsed = !sel || !sel.rangeCount || sel.getRangeAt(0).collapsed;
    if (collapsed) {
      var a = document.createElement('a'); a.setAttribute('href', url); a.textContent = url; setTab(a);
      if (sel && sel.rangeCount) { var r = sel.getRangeAt(0); r.insertNode(a); r.setStartAfter(a); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
      else rich.appendChild(a);
    } else {
      try { document.execCommand('createLink', false, url); } catch (e) {}
      var made = tbCurrentAnchor(rich); if (made) setTab(made);
    }
  }
  // Positive-integer px string (or '') for a width/height attribute; bounds an absurd value.
  function tbDim(v) { var n = Math.round(Number(v)); return (isFinite(n) && n > 0) ? String(Math.min(n, 4000)) : ''; }
  // Insert an <img> (+ optional alt/width/height) at the saved caret (captured before the media dialog opened).
  function tbInsertImage(url, alt, width, height) {
    url = tbSafeHref(url); if (!url) { tbSavedRange = null; return; }
    var rich = tbSavedRange ? closestAttr(tbSavedRange.commonAncestorContainer, 'data-sw-html') : currentRich();
    if (!rich) { tbSavedRange = null; return; }
    var img = document.createElement('img'); img.setAttribute('src', url); img.setAttribute('alt', typeof alt === 'string' ? alt : '');
    var w = tbDim(width), h = tbDim(height);
    if (w) img.setAttribute('width', w);
    if (h) img.setAttribute('height', h);
    if (tbSavedRange) { try { tbSavedRange.insertNode(img); } catch (e) { rich.appendChild(img); } }
    else rich.appendChild(img);
    tbSavedRange = null;
    post({ type: 'rich-edit', key: rich.getAttribute('data-sw-html'), html: rich.innerHTML });
  }

  // ---- Inline image resize (aspect-locked corner drag on a rich-content <img>; writes width/height attrs) ----
  var rzImg = null, rzBox = null, rzDrag = null;
  function rzEnsure() {
    if (rzBox) return rzBox;
    rzBox = document.createElement('div'); rzBox.className = 'sw-rz';
    // Only the bottom-right handle: an <img> in normal flow keeps its top-left origin when its width/height
    // ATTRIBUTES change (the sanitizer strips margin/transform, so nw/ne/sw can't anchor their opposite corner
    // under the cursor). SE grows down-right, tracking the cursor 1:1.
    var h = document.createElement('div'); h.className = 'sw-rz-h sw-rz-se'; h.setAttribute('data-c', 'se');
    h.addEventListener('mousedown', rzStart);
    rzBox.appendChild(h);
    var dim = document.createElement('div'); dim.className = 'sw-rz-dim'; rzBox.appendChild(dim);
    document.body.appendChild(rzBox);
    return rzBox;
  }
  function rzPosition() {
    if (!rzImg || !rzImg.getClientRects || !rzImg.getClientRects().length) { rzHide(); return; }
    var r = rzImg.getBoundingClientRect(), b = rzEnsure();
    b.style.display = 'block'; b.style.left = r.left + 'px'; b.style.top = r.top + 'px'; b.style.width = r.width + 'px'; b.style.height = r.height + 'px';
    b.querySelector('.sw-rz-dim').textContent = Math.round(r.width) + ' \\u00d7 ' + Math.round(r.height);
  }
  function rzSelect(img) { rzImg = img; rzPosition(); }
  function rzHide() { rzImg = null; if (rzBox) rzBox.style.display = 'none'; }
  function rzStart(e) {
    if (!rzImg) return;
    e.preventDefault(); e.stopPropagation();
    var r = rzImg.getBoundingClientRect();
    rzDrag = { x: e.clientX, w: r.width, aspect: r.width / (r.height || 1) };
    document.addEventListener('mousemove', rzMove, true);
    document.addEventListener('mouseup', rzEnd, true);
  }
  function rzMove(e) {
    if (!rzDrag || !rzImg) return;
    var w = Math.max(24, Math.min(rzDrag.w + (e.clientX - rzDrag.x), 4000)); // se: cursor delta grows down-right
    rzImg.setAttribute('width', String(Math.round(w)));
    rzImg.setAttribute('height', String(Math.round(w / rzDrag.aspect))); // aspect-locked
    rzPosition();
  }
  function rzEnd() {
    document.removeEventListener('mousemove', rzMove, true);
    document.removeEventListener('mouseup', rzEnd, true);
    rzDrag = null;
    var rich = rzImg && closestAttr(rzImg, 'data-sw-html');
    if (rich) post({ type: 'rich-edit', key: rich.getAttribute('data-sw-html'), html: rich.innerHTML });
    rzPosition();
  }
  // Content-mode click: selecting a rich-content <img> shows its resize handles; a click elsewhere hides them.
  function rzClick(e) {
    if (!editing) return;
    var t = e.target;
    if (t && t.tagName === 'IMG' && closestAttr(t, 'data-sw-html')) rzSelect(t);
    else if (!(rzBox && rzBox.contains(t))) rzHide();
  }
  function tbColorGroup() { var g = RTB.colorClasses.slice(); for (var i = 0; i < ciColors.length; i++) g.push(ciColors[i].cls); return g; }
  function tbFontGroup() { var g = []; for (var i = 0; i < ciFonts.length; i++) g.push(ciFonts[i].cls); return g; }
  // Scheme-gate a link URL — the SAME allowlist as the editor's safeUrl (SAFE_URL in @sitewright/blocks/url,
  // which the dataset toolbar + data-sw-href editor use): absolute http(s), mailto/tel/sms, a root-relative
  // /path, or a #fragment. A javascript:/data:/vbscript: (or scheme-less) URL returns '' → the link is dropped
  // rather than written into href. The authoritative boundary is still sanitizeRichHtml at render; this keeps
  // the two toolbars consistent and hardens the live preview.
  function tbSafeHref(u) { u = String(u || ''); return /^(?:https?:\\/\\/|mailto:|tel:|sms:|\\/(?!\\/)|#)/i.test(u) ? u : ''; }

  // ---- popover (swatch grid / menu / link input / overflow) ----
  function tbEnsurePop() {
    if (tbPop) return tbPop;
    tbPop = document.createElement('div'); tbPop.className = 'sw-tb-pop';
    tbPop.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep the selection
    document.addEventListener('mousedown', function (e) { if (!tbPop || tbPop.style.display === 'none') return; if (tbPop.contains(e.target) || (toolbar && toolbar.contains(e.target))) return; tbClosePop(); }, true);
    document.body.appendChild(tbPop);
    return tbPop;
  }
  function tbClosePop() { if (tbPop) tbPop.style.display = 'none'; setTbActive(null); }
  function setTbActive(id) { tbActiveId = id; if (!toolbar) return; var bs = toolbar.querySelectorAll('button'); for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('sw-tb-on', id != null && bs[i].getAttribute('data-tbid') === id); }
  function tbHeading(text) { var h = document.createElement('p'); h.className = 'sw-tb-h'; h.textContent = text; return h; }
  function tbSwatchBtn(label, styleText, glyph, onPick) { var b = document.createElement('button'); b.type = 'button'; b.className = 'sw-tb-sw'; b.title = label; b.setAttribute('aria-label', label); if (styleText) b.setAttribute('style', styleText); b.textContent = glyph; b.addEventListener('mousedown', function (e) { e.preventDefault(); }); b.addEventListener('click', function (e) { e.preventDefault(); onPick(); }); return b; }
  function tbItemBtn(label, iconId, onPick) { var b = document.createElement('button'); b.type = 'button'; b.className = 'sw-tb-item'; b.setAttribute('aria-label', label); if (iconId) b.innerHTML = tbSvg(iconId); b.appendChild(document.createTextNode(label)); b.addEventListener('mousedown', function (e) { e.preventDefault(); }); b.addEventListener('click', function (e) { e.preventDefault(); onPick(); }); return b; }
  function tbShowPop(anchor) {
    var p = tbPop; p.style.display = 'block';
    var r = anchor ? anchor.getBoundingClientRect() : (toolbar ? toolbar.getBoundingClientRect() : { left: 20, right: 60, top: 40, bottom: 60 });
    requestAnimationFrame(function () {
      var top = r.bottom + 6, left = r.left;
      var maxLeft = window.innerWidth - p.offsetWidth - 6; if (left > maxLeft) left = maxLeft > 6 ? maxLeft : 6; if (left < 6) left = 6;
      if (top + p.offsetHeight > window.innerHeight - 6) top = r.top - p.offsetHeight - 6;
      if (top < 6) top = 6;
      p.style.top = top + 'px'; p.style.left = left + 'px';
    });
  }
  function tbFinish() { tbEmit(); tbClosePop(); positionToolbar(); }
  function tbOpenSwatch(rich, cmd, anchor) {
    var p = tbEnsurePop(); while (p.firstChild) p.removeChild(p.firstChild);
    var isColor = cmd.kind === 'color';
    p.appendChild(tbHeading(cmd.label));
    function pick(cls) { if (isColor) tbApplyInline(rich, tbColorGroup(), cls); else tbApplyInline(rich, RTB.highlightClasses, cls); tbFinish(); }
    function grid(list) {
      var g = document.createElement('div'); g.className = 'sw-tb-grid';
      for (var i = 0; i < list.length; i++) (function (sw) {
        var style = sw.value ? (isColor ? 'color:' + sw.value : 'background:' + sw.value) : '';
        g.appendChild(tbSwatchBtn(sw.label, style, sw.cls ? 'A' : '\\u2298', function () { pick(sw.cls); }));
      })(list[i]);
      return g;
    }
    if (isColor && ciColors.length) { p.appendChild(tbHeading('Brand')); p.appendChild(grid(ciColors)); p.appendChild(tbHeading('Standard')); }
    p.appendChild(grid(isColor ? RTB.colors : RTB.highlights));
    tbShowPop(anchor); setTbActive(cmd.id);
  }
  function tbOpenMenu(rich, cmd, anchor, items, applyFn) {
    var p = tbEnsurePop(); while (p.firstChild) p.removeChild(p.firstChild);
    p.appendChild(tbHeading(cmd.label));
    for (var i = 0; i < items.length; i++) (function (it) { p.appendChild(tbItemBtn(it.label, null, function () { applyFn(it.cls); tbFinish(); })); })(items[i]);
    tbShowPop(anchor); setTbActive(cmd.id);
  }
  function tbOpenLink(rich, cmd, anchor) {
    var p = tbEnsurePop(); while (p.firstChild) p.removeChild(p.firstChild);
    // Capture the caret NOW (before the input steals focus) so Apply acts on the ORIGINAL selection.
    var s0 = window.getSelection(); tbLinkRange = s0 && s0.rangeCount ? s0.getRangeAt(0).cloneRange() : null;
    var existing = tbCurrentAnchor(rich); // pre-fill + edit-in-place when the caret is inside a link
    var row = document.createElement('div'); row.className = 'sw-tb-row';
    var input = document.createElement('input'); input.type = 'text'; input.placeholder = 'https://\\u2026 or /path';
    if (existing) input.value = existing.getAttribute('href') || '';
    var apply = document.createElement('button'); apply.type = 'button'; apply.className = 'sw-tb-apply'; apply.textContent = 'Apply';
    row.appendChild(input); row.appendChild(apply); p.appendChild(row);
    // "Open in new tab" → target=_blank (rel is forced by the sanitizer). Pre-checked from an existing anchor.
    var check = document.createElement('label'); check.className = 'sw-tb-check';
    var box = document.createElement('input'); box.type = 'checkbox'; if (existing && existing.getAttribute('target') === '_blank') box.checked = true;
    check.appendChild(box); check.appendChild(document.createTextNode('Open in new tab')); p.appendChild(check);
    function doApply() {
      // Restore the caret captured at open (the input moved the live selection off the region).
      var s = window.getSelection();
      if (s && tbLinkRange && rich.contains(tbLinkRange.commonAncestorContainer)) { s.removeAllRanges(); s.addRange(tbLinkRange); }
      tbApplyLink(rich, input.value.replace(/^\\s+|\\s+$/g, ''), box.checked);
      tbLinkRange = null;
      try { rich.focus(); } catch (e) {}
      tbFinish();
    }
    apply.addEventListener('mousedown', function (e) { e.preventDefault(); });
    apply.addEventListener('click', function (e) { e.preventDefault(); doApply(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doApply(); } else if (e.key === 'Escape') { e.preventDefault(); tbClosePop(); } });
    tbShowPop(anchor); setTbActive(cmd.id);
    requestAnimationFrame(function () { try { input.focus(); } catch (e) {} });
  }
  // Save the caret + ask the editor to open its media picker; the pick round-trips back as an 'insert-media'
  // message (the picker is a modal in the PARENT window, so the saved range stays valid meanwhile).
  function tbPickMedia() {
    var sel = window.getSelection();
    tbSavedRange = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    tbClosePop(); post({ type: 'pick-media' });
  }
  function tbOpenMore(anchor) {
    var p = tbEnsurePop(); while (p.firstChild) p.removeChild(p.firstChild);
    for (var i = 0; i < tbMoreItems.length; i++) (function (cmd) {
      var row = tbItemBtn(cmd.label, cmd.id, function () { tbRun(cmd, row); });
      p.appendChild(row);
    })(tbMoreItems[i]);
    tbShowPop(anchor);
  }
  function tbRun(cmd, anchor) {
    var rich = currentRich(); if (!rich) return;
    if (cmd.kind === 'source') { post({ type: 'edit-html-source', key: rich.getAttribute('data-sw-html'), html: rich.innerHTML }); tbClosePop(); hideToolbar(); return; }
    if (cmd.kind === 'exec') { try { document.execCommand(cmd.cmd, false, cmd.arg); } catch (e) {} tbFinish(); return; }
    if (cmd.kind === 'indent') { tbStepBlockIndent(rich, cmd.cmd === '-1' ? -1 : 1); tbFinish(); return; }
    if (cmd.kind === 'table') { tbInsertTable(); tbFinish(); return; }
    if (cmd.kind === 'media') { tbPickMedia(); return; } // hands off to the editor's media picker
    // Popover commands: a second click on the open control closes it (toggle).
    if (tbPop && tbPop.style.display !== 'none' && tbActiveId === cmd.id) { tbClosePop(); return; }
    if (cmd.kind === 'color' || cmd.kind === 'highlight') tbOpenSwatch(rich, cmd, anchor);
    else if (cmd.kind === 'size') tbOpenMenu(rich, cmd, anchor, RTB.sizes, function (c) { tbApplyInline(rich, RTB.sizeClasses, c); });
    else if (cmd.kind === 'align') tbOpenMenu(rich, cmd, anchor, RTB.aligns, function (c) { tbApplyBlock(rich, RTB.alignClasses, c); });
    else if (cmd.kind === 'font') tbOpenMenu(rich, cmd, anchor, [{ label: 'Default', cls: '' }].concat(ciFonts), function (c) { tbApplyInline(rich, tbFontGroup(), c); });
    else if (cmd.kind === 'link') tbOpenLink(rich, cmd, anchor);
  }
  function tbButton(cmd) {
    var b = document.createElement('button'); b.type = 'button'; b.title = cmd.label; b.setAttribute('aria-label', cmd.label); b.setAttribute('data-tbid', cmd.id);
    b.innerHTML = tbSvg(cmd.id);
    b.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep the editable's selection
    b.addEventListener('click', function (e) { e.preventDefault(); tbRun(cmd, b); });
    return b;
  }
  function ensureToolbar() {
    if (toolbar) return toolbar;
    toolbar = document.createElement('div'); toolbar.className = 'sw-tb';
    tbMore = document.createElement('button'); tbMore.type = 'button'; tbMore.title = 'More'; tbMore.setAttribute('aria-label', 'More formatting'); tbMore.innerHTML = tbSvg('more');
    tbMore.addEventListener('mousedown', function (e) { e.preventDefault(); });
    tbMore.addEventListener('click', function (e) { e.preventDefault(); tbOpenMore(tbMore); });
    document.body.appendChild(toolbar);
    return toolbar;
  }
  // Rebuild the single row, collapsing whatever doesn't fit into the ⋯ overflow menu. Constant widths (fixed
  // by CSS) — no layout thrash. Skipped when the available width is unchanged (so selection moves don't rebuild).
  function tbReflow(force) {
    var tb = ensureToolbar();
    var avail = Math.min((window.innerWidth || 800) - 20, 620);
    if (!force && avail === tbLastAvail && tb.firstChild) return;
    tbLastAvail = avail;
    while (tb.firstChild) tb.removeChild(tb.firstChild);
    tbMoreItems = [];
    var spec = RTB.toolbar, BTN = 28, SEP = 5, MORE = 30, total = 0;
    for (var t = 0; t < spec.length; t++) total += spec[t] === null ? SEP : BTN;
    var reserve = total > avail ? MORE : 0, acc = 0, cut = spec.length;
    if (reserve) { for (var i = 0; i < spec.length; i++) { var w = spec[i] === null ? SEP : BTN; if (acc + w + reserve > avail) { cut = i; break; } acc += w; } }
    for (var j = 0; j < spec.length; j++) {
      var it = spec[j];
      if (j >= cut) { if (it !== null) tbMoreItems.push(it); continue; }
      if (it === null) { var sep = document.createElement('span'); sep.className = 'sw-tb-sep'; sep.setAttribute('aria-hidden', 'true'); tb.appendChild(sep); }
      else tb.appendChild(tbButton(it));
    }
    if (tbMoreItems.length) tb.appendChild(tbMore);
  }
  function positionToolbar() {
    if (!editing) { hideToolbar(); return; }
    var rich = currentRich();
    var sel = window.getSelection && window.getSelection();
    if (!rich || !sel || sel.rangeCount === 0) { hideToolbar(); return; }
    var rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0 && rect.top === 0)) { rect = rich.getBoundingClientRect(); }
    var tb = ensureToolbar();
    tb.style.display = 'flex';
    tbReflow();
    var h = tb.offsetHeight, w = tb.offsetWidth, GAP = 10;
    // ABOVE the selection with a clear gap → the bar never overlaps the text being edited. Only when there's
    // no room above (selection near the viewport top) does it flip BELOW. Single row → fixed small height.
    var top = rect.top - h - GAP; if (top < 6) top = rect.bottom + GAP;
    var maxTop = window.innerHeight - h - 6; if (top > maxTop) top = maxTop; if (top < 6) top = 6;
    var left = rect.left; if (left < 6) left = 6;
    var maxLeft = window.innerWidth - w - 6; if (left > maxLeft) left = maxLeft > 6 ? maxLeft : 6;
    tb.style.top = top + 'px'; tb.style.left = left + 'px';
  }
  function hideToolbar() { if (toolbar) toolbar.style.display = 'none'; tbClosePop(); }
  function onSelChange() { if (editing) positionToolbar(); }

  // --- Link URL(+text) popover ([data-sw-href] anchors) ---
  var pop = null, popAnchor = null;
  function ensurePop() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'sw-pop';
    pop.innerHTML =
      '<label>Link URL<input type="text" class="sw-url" placeholder="https://\\u2026 or /path"></label>' +
      '<label class="sw-text-row">Text<input type="text" class="sw-text"></label>' +
      '<div class="sw-pop-actions"><button type="button" class="sw-cancel">Cancel</button><button type="button" class="sw-ok">Apply</button></div>';
    document.body.appendChild(pop);
    pop.querySelector('.sw-cancel').addEventListener('click', closePop);
    pop.querySelector('.sw-ok').addEventListener('click', applyPop);
    pop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); applyPop(); }
      else if (e.key === 'Escape') { e.preventDefault(); closePop(); }
    });
    return pop;
  }
  function openPop(anchor) {
    popAnchor = anchor;
    var p = ensurePop();
    var hrefKey = anchor.getAttribute('data-sw-href');
    var textKey = anchor.getAttribute('data-sw-text');
    p.querySelector('.sw-url').value = anchor.getAttribute('href') || '';
    var textRow = p.querySelector('.sw-text-row');
    textRow.style.display = textKey ? 'flex' : 'none';
    if (textKey) p.querySelector('.sw-text').value = anchor.textContent || '';
    p.style.display = 'flex';
    var rect = rectOf(anchor);
    var top = rect.bottom + 6; var left = rect.left;
    var maxLeft = window.innerWidth - p.offsetWidth - 6; if (left > maxLeft) left = maxLeft > 6 ? maxLeft : 6; if (left < 6) left = 6;
    if (top + p.offsetHeight > window.innerHeight - 6) top = rect.top - p.offsetHeight - 6;
    p.style.top = top + 'px'; p.style.left = left + 'px';
    p.querySelector('.sw-url').focus();
    document.addEventListener('mousedown', onDocDown, true); // click-outside dismiss
  }
  function onDocDown(e) {
    if (!pop || pop.style.display === 'none') return;
    if (pop.contains(e.target) || (popAnchor && popAnchor.contains(e.target))) return;
    closePop();
  }
  function applyPop() {
    if (!popAnchor) return closePop();
    var hrefKey = popAnchor.getAttribute('data-sw-href');
    var textKey = popAnchor.getAttribute('data-sw-text');
    var msg = { type: 'link-edit', hrefKey: hrefKey, href: pop.querySelector('.sw-url').value };
    if (textKey) { msg.textKey = textKey; msg.text = pop.querySelector('.sw-text').value; }
    post(msg);
    closePop();
  }
  function closePop() { if (pop) pop.style.display = 'none'; popAnchor = null; document.removeEventListener('mousedown', onDocDown, true); }
  function onLinkClick(e) { e.preventDefault(); e.stopPropagation(); openPop(e.currentTarget); }

  // --- Image / background replacement ([data-sw-src] / [data-sw-bg]) → ask the editor to pick. ---
  function pickImage(el) {
    post({ type: 'pick-image', key: el.getAttribute('data-sw-src') || el.getAttribute('data-sw-bg') || '', kind: el.hasAttribute('data-sw-src') ? 'image' : 'bg' });
  }
  function onImgClick(e) { e.preventDefault(); e.stopPropagation(); pickImage(e.currentTarget); }

  // --- Editor-only CONTROL chips ([data-sw-control]) → a popover (text/textarea/select) or, for
  //     as="image", the editor's file picker — to set the chip's target (page/page.data value). ---
  var cpop = null, cpopEl = null;
  function ensureControlPop() {
    if (cpop) return cpop;
    cpop = document.createElement('div');
    cpop.className = 'sw-pop';
    cpop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); applyControlPop(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeControlPop(); }
    });
    document.body.appendChild(cpop);
    return cpop;
  }
  function openControlPop(el) {
    var as = el.getAttribute('data-sw-control-as') || 'text';
    // Image AND arbitrary-file controls hand off to the editor file picker (no in-page popover); the
    // posted "as" selects the picker accept filter (image assets vs uploaded files).
    if (as === 'image' || as === 'file') { post({ type: 'control-pick-image', target: el.getAttribute('data-sw-control'), as: as }); return; }
    cpopEl = el;
    var value = el.getAttribute('data-sw-control-value') || '';
    var p = ensureControlPop();
    while (p.firstChild) p.removeChild(p.firstChild);
    var lab = document.createElement('label');
    lab.appendChild(document.createTextNode(el.getAttribute('data-sw-control-label') || 'Value'));
    var field;
    if (as === 'folder' || as === 'dataset' || as === 'dataset-item' || as === 'select') {
      // folder/dataset/dataset-item options come from the page (media folders / dataset names / a
      // dataset's entry ids); select options are the author's options="…" list — all arrive
      // pre-rendered in data-sw-control-options.
      field = document.createElement('select');
      var blank = document.createElement('option'); blank.value = ''; blank.textContent = '\\u2014 none \\u2014'; field.appendChild(blank);
      var opts = [];
      try { opts = JSON.parse(el.getAttribute('data-sw-control-options') || '[]'); } catch (err) {}
      for (var i = 0; i < opts.length; i++) {
        var o = document.createElement('option'); o.value = String(opts[i]); o.textContent = String(opts[i]);
        if (o.value === value) o.selected = true; field.appendChild(o);
      }
    } else if (as === 'textarea') {
      field = document.createElement('textarea'); field.rows = 3; field.maxLength = 8000; field.value = value;
    } else if (as === 'number' || as === 'color' || as === 'date') {
      // Native typed inputs (the browser constrains/validates the value); color falls back to #000000
      // when unset. The chosen value is posted as a string via control-edit, like every other control.
      field = document.createElement('input'); field.type = as; field.value = value;
    } else {
      field = document.createElement('input'); field.type = 'text'; field.maxLength = 2048; field.value = value;
    }
    field.className = 'sw-cval';
    lab.appendChild(field);
    var actions = document.createElement('div'); actions.className = 'sw-pop-actions';
    var cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'sw-cancel'; cancel.textContent = 'Cancel';
    var ok = document.createElement('button'); ok.type = 'button'; ok.className = 'sw-ok'; ok.textContent = 'Apply';
    cancel.addEventListener('click', closeControlPop);
    ok.addEventListener('click', applyControlPop);
    actions.appendChild(cancel); actions.appendChild(ok);
    p.appendChild(lab); p.appendChild(actions);
    p.style.display = 'flex';
    var rect = rectOf(el);
    var top = rect.bottom + 6, left = rect.left;
    var maxLeft = window.innerWidth - p.offsetWidth - 6; if (left > maxLeft) left = maxLeft > 6 ? maxLeft : 6; if (left < 6) left = 6;
    if (top + p.offsetHeight > window.innerHeight - 6) top = rect.top - p.offsetHeight - 6;
    p.style.top = top + 'px'; p.style.left = left + 'px';
    field.focus();
    document.addEventListener('mousedown', onControlDocDown, true);
  }
  function onControlDocDown(e) {
    if (!cpop || cpop.style.display === 'none') return;
    if (cpop.contains(e.target) || (cpopEl && cpopEl.contains(e.target))) return;
    closeControlPop();
  }
  function applyControlPop() {
    if (!cpopEl) return closeControlPop();
    var field = cpop.querySelector('.sw-cval');
    post({ type: 'control-edit', target: cpopEl.getAttribute('data-sw-control'), as: cpopEl.getAttribute('data-sw-control-as'), value: field ? field.value : '' });
    closeControlPop();
  }
  function closeControlPop() { if (cpop) cpop.style.display = 'none'; cpopEl = null; document.removeEventListener('mousedown', onControlDocDown, true); }
  function onControlClick(e) { if (!editing) return; e.preventDefault(); e.stopPropagation(); openControlPop(e.currentTarget); }

  // --- Dataset rows ([data-sw-entry]): a click ANYWHERE in the row opens that entry's item editor (the
  //     structured form edits every field). In-place editing is DISABLED for fields inside a loop (see
  //     setEditing) — a fully data-sw-* editable card would otherwise swallow the click into a field and
  //     the item editor would be unreachable. Capture phase + stopPropagation so this beats a field's own
  //     bubble handler (img picker / link popover) AND a component's click (e.g. carousel advance). ---
  function onEntryClick(e) {
    if (!editing) return;
    var el = closestAttr(e.target, 'data-sw-entry');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    post({ type: 'open-entry', dataset: el.getAttribute('data-sw-dataset') || '', id: el.getAttribute('data-sw-entry') || '' });
  }

  function eachEl(sel, fn) { var els = document.querySelectorAll(sel); for (var j = 0; j < els.length; j++) fn(els[j]); }

  // ---- Editable-regions manifest + locate/edit (drives the editor's Regions side-panel) ------------
  // The panel is the RELIABLE way to reach any editable thing — including content the page occludes,
  // hides (display:none), or repeats (dataset entries / slides). On entering content mode the bridge
  // tags every editable element with a data-sw-rid and posts a manifest (kind + label + entry title) to
  // the editor; an inbound edit-region scrolls to + flashes the target (when on-screen) and triggers the
  // SAME edit a click would (entry → open-entry modal, image → file picker, control/link → popover,
  // rich → focus or source modal, plain text → focus or a centred popover when off-screen).
  var REGION_SEL = '[data-sw-text],[data-sw-translate],[data-sw-html],[data-sw-href],[data-sw-src],[data-sw-bg],[data-sw-control],[data-sw-entry]';
  // A box for a popover anchor — the element's own, or viewport-centred when it has no layout box (hidden).
  function rectOf(el) {
    if (el.getClientRects().length) return el.getBoundingClientRect();
    var w = 240, x = window.innerWidth / 2 - w / 2, y = window.innerHeight / 2 - 30;
    return { left: x, top: y, bottom: y + 20, right: x + w, width: w, height: 20 };
  }
  function regionInfo(el) {
    if (el.hasAttribute('data-sw-entry')) {
      var t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      return { kind: 'entry', dataset: el.getAttribute('data-sw-dataset') || '', id: el.getAttribute('data-sw-entry') || '', label: t ? t.slice(0, 80) : (el.getAttribute('data-sw-entry') || 'entry') };
    }
    if (el.hasAttribute('data-sw-control')) return { kind: 'control', label: el.getAttribute('data-sw-control-label') || el.getAttribute('data-sw-control') || 'control' };
    if (el.hasAttribute('data-sw-translate')) return { kind: 'translate', label: el.getAttribute('data-sw-translate') || 'translation' };
    if (el.hasAttribute('data-sw-html')) return { kind: 'html', label: el.getAttribute('data-sw-html') || 'rich text' };
    if (el.hasAttribute('data-sw-href')) return { kind: 'href', label: el.getAttribute('data-sw-href') || 'link' };
    if (el.hasAttribute('data-sw-src')) return { kind: 'image', label: el.getAttribute('data-sw-src') || 'image' };
    if (el.hasAttribute('data-sw-bg')) return { kind: 'bg', label: el.getAttribute('data-sw-bg') || 'background' };
    return { kind: 'text', label: el.getAttribute('data-sw-text') || 'text' };
  }
  function postRegions() {
    var items = [], rid = 0;
    eachEl(REGION_SEL, function (el) {
      // A field INSIDE a dataset row isn't a standalone region — the whole row is one "entry" region that
      // opens the item editor (its fields are edited there), so list the row, not its inner leaves.
      if (!el.hasAttribute('data-sw-entry') && el.closest && el.closest('[data-sw-entry]')) return;
      el.setAttribute('data-sw-rid', String(rid));
      var info = regionInfo(el); info.rid = rid;
      items.push(info); rid++;
    });
    post({ type: 'regions', items: items });
  }
  function flashEl(el) { el.classList.add('sw-flash'); setTimeout(function () { el.classList.remove('sw-flash'); }, 1200); }
  // A small centred textarea popover for a plain-text leaf with no on-screen box (hidden content).
  var tpop = null, tpopEl = null;
  function openTextPop(el) {
    tpopEl = el;
    if (!tpop) {
      tpop = document.createElement('div'); tpop.className = 'sw-pop';
      tpop.innerHTML = '<label>Text<textarea class="sw-tval" rows="3" maxlength="8000"></textarea></label>' +
        '<div class="sw-pop-actions"><button type="button" class="sw-cancel">Cancel</button><button type="button" class="sw-ok">Apply</button></div>';
      document.body.appendChild(tpop);
      tpop.querySelector('.sw-cancel').addEventListener('click', closeTextPop);
      tpop.querySelector('.sw-ok').addEventListener('click', applyTextPop);
      tpop.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); closeTextPop(); } });
    }
    tpop.querySelector('.sw-tval').value = el.textContent || '';
    tpop.style.display = 'flex';
    // Centre AFTER layout — offsetWidth/Height are 0 in the same frame the element is shown.
    requestAnimationFrame(function () {
      tpop.style.top = Math.max(8, (window.innerHeight - tpop.offsetHeight) / 2) + 'px';
      tpop.style.left = Math.max(8, (window.innerWidth - tpop.offsetWidth) / 2) + 'px';
    });
    tpop.querySelector('.sw-tval').focus();
    document.addEventListener('mousedown', onTextDocDown, true);
  }
  function applyTextPop() {
    if (tpopEl) {
      var v = tpop.querySelector('.sw-tval').value;
      try { tpopEl.textContent = v; } catch (e) {}
      // A translate region writes the shared catalog; a plain-text region writes page.data.
      if (tpopEl.hasAttribute('data-sw-translate')) post({ type: 'translate-edit', key: tpopEl.getAttribute('data-sw-translate') || '', value: v });
      else post({ type: 'edit', key: tpopEl.getAttribute('data-sw-text') || '', value: v });
    }
    closeTextPop();
  }
  function closeTextPop() { if (tpop) tpop.style.display = 'none'; tpopEl = null; document.removeEventListener('mousedown', onTextDocDown, true); }
  function onTextDocDown(e) { if (!tpop || tpop.style.display === 'none') return; if (tpop.contains(e.target)) return; closeTextPop(); }
  // Open the editor for a SPECIFIC directive on el — reused by both an overlay badge click and editRegion.
  function editDirective(el, kind) {
    closePop(); closeControlPop(); closeTextPop(); // never stack popovers
    // A FIELD inside a dataset row (incl. a tile whose ROOT carries data-sw-bg/src, so the whole card is an
    // image leaf) is edited via the row's item editor — redirect a field badge / region click to open it.
    if (kind !== 'entry') {
      var row = el.closest && el.closest('[data-sw-entry]');
      if (row) { post({ type: 'open-entry', dataset: row.getAttribute('data-sw-dataset') || '', id: row.getAttribute('data-sw-entry') || '' }); return; }
    }
    var onScreen = el.getClientRects().length;
    if (kind === 'entry') { post({ type: 'open-entry', dataset: el.getAttribute('data-sw-dataset') || '', id: el.getAttribute('data-sw-entry') || '' }); return; }
    if (kind === 'control') { openControlPop(el); return; }
    if (kind === 'image' || kind === 'bg') { pickImage(el); return; }
    if (kind === 'href') { openPop(el); return; }
    if (kind === 'html') { if (onScreen) { try { el.focus(); } catch (e) {} } else { post({ type: 'edit-html-source', key: el.getAttribute('data-sw-html'), html: el.innerHTML }); } return; }
    // text on a LINK has no standalone editable box — its text rides in the link popover (the Text row).
    if (kind === 'text' && el.hasAttribute('data-sw-href')) { openPop(el); return; }
    // plain text + translations: focus in place, or a centred popover when off-screen.
    if (onScreen) { try { el.focus(); var r = document.createRange(); r.selectNodeContents(el); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) {} } else { openTextPop(el); }
  }
  // The directive an in-place CLICK / the Regions panel resolves to (priority order = the old ladder).
  function primaryKind(el) {
    if (el.hasAttribute('data-sw-entry')) return 'entry';
    if (el.hasAttribute('data-sw-control')) return 'control';
    if (el.hasAttribute('data-sw-src')) return 'image';
    if (el.hasAttribute('data-sw-bg')) return 'bg';
    if (el.hasAttribute('data-sw-href') && !el.hasAttribute('data-sw-html')) return 'href';
    if (el.hasAttribute('data-sw-html')) return 'html';
    if (el.hasAttribute('data-sw-translate')) return 'translate';
    return 'text';
  }
  // Locate + edit a region by rid (from the panel): scroll to + flash it (when on-screen), then open its
  // primary editor exactly as an in-place click would.
  function editRegion(rid) {
    var el = document.querySelector('[data-sw-rid="' + rid + '"]');
    if (!el) return;
    var onScreen = el.getClientRects().length;
    if (onScreen) { try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {} flashEl(el); }
    editDirective(el, primaryKind(el));
  }
  // ---- Editable-region OVERLAY HUD: a body-level, fixed, max-z layer holding the ACTIVE element's
  //      outline + a cluster of CLICKABLE, uniform, per-directive badges (white monochrome SVG icons +
  //      a monospace field name). Never clipped/covered (top-level), immune to host CSS (own layer).
  //      Shown for the element(s) under the pointer/focus, including the editable STACK there. ----
  var ICONS = {
    text: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
    html: '<path d="M13 4v16M17 4v16M19 4h-6.5a4.5 4.5 0 0 0 0 9H13"/>',
    href: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    translate: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"/>',
    control: '<line x1="4" x2="20" y1="8" y2="8"/><line x1="4" x2="20" y1="16" y2="16"/><circle cx="9" cy="8" r="2.6" fill="#fff" stroke="none"/><circle cx="15" cy="16" r="2.6" fill="#fff" stroke="none"/>',
    entry: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>'
  };
  ICONS.bg = ICONS.image;
  function isEditable(el) {
    return !!(el && el.hasAttribute && (el.hasAttribute('data-sw-text') || el.hasAttribute('data-sw-html') || el.hasAttribute('data-sw-href') || el.hasAttribute('data-sw-src') || el.hasAttribute('data-sw-bg') || el.hasAttribute('data-sw-translate') || el.hasAttribute('data-sw-control') || el.hasAttribute('data-sw-entry')));
  }
  function dirLabel(el, kind) {
    if (kind === 'entry') return el.getAttribute('data-sw-dataset') || el.getAttribute('data-sw-entry') || 'entry';
    if (kind === 'control') return el.getAttribute('data-sw-control-label') || el.getAttribute('data-sw-control') || 'control';
    if (kind === 'image') return el.getAttribute('data-sw-src') || 'image';
    if (kind === 'bg') return el.getAttribute('data-sw-bg') || 'background';
    return el.getAttribute('data-sw-' + kind) || kind;
  }
  // ---- Badge TOOLTIP text: a human TYPE name + the FULL path of the field to edit, per directive. The
  //      type/path mirror the server's resolution exactly (see directives.ts / control.ts): text/html/
  //      href/src/bg read the page.data store (a bare key = top-level page.data, a page.data.x key is
  //      nested); src/bg may instead carry an already-resolved URL (a dataset loop image value);
  //      translate reads website.translations; a control targets a page field / page.data / website.data.
  // A direct URL/path value (vs a page.data KEY) — matches directives.ts DIRECT_URL without a regex slash
  // (a literal regex inside this template string would need double-escaping; plain checks sidestep that).
  function isDirectUrl(v) { v = '' + v; return v.charAt(0) === '/' || v.indexOf('./') === 0 || v.indexOf('../') === 0 || /^https?:/i.test(v) || v.indexOf('data:') === 0; }
  function tipTrunc(s) { s = '' + s; return s.length > 80 ? s.slice(0, 79) + '…' : s; }
  function pageVarPath(key) { key = key || ''; if (key === '') return 'page.data'; return key.indexOf('page.data.') === 0 ? key : 'page.data.' + key; }
  function controlTip(el) {
    var target = el.getAttribute('data-sw-control') || '', as = el.getAttribute('data-sw-control-as') || 'text';
    var label = el.getAttribute('data-sw-control-label') || '';
    var lead = label ? label + ' — ' : '', suffix = as && as !== 'text' ? ' (' + as + ')' : '';
    if (target === 'page.title') return lead + 'Page Title: page.title';
    if (target === 'page.description') return lead + 'SEO Description: page.description';
    if (target === 'page.image') return lead + 'Social Image: page.image';
    if (target.indexOf('website.data.') === 0) return lead + 'Website Variable' + suffix + ': ' + tipTrunc(target);
    if (target.indexOf('page.data.') === 0) return lead + 'Page Variable' + suffix + ': ' + tipTrunc(target);
    if (target.indexOf('.') === -1) return lead + 'Page Variable' + suffix + ': page.data.' + tipTrunc(target); // bare key → top-level page.data
    return lead + 'Control' + suffix + ': ' + tipTrunc(target); // any other dotted target (server may reject) — show verbatim, don't mislabel
  }
  function tipText(el, kind) {
    if (kind === 'translate') return 'Translation: website.translations.' + tipTrunc(el.getAttribute('data-sw-translate') || '');
    if (kind === 'entry') {
      var ds = el.getAttribute('data-sw-dataset') || '', id = el.getAttribute('data-sw-entry') || '';
      return 'Dataset: ' + (ds ? ds + (id ? '/' + tipTrunc(id) : '') : tipTrunc(id || 'entry'));
    }
    if (kind === 'control') return controlTip(el);
    if (kind === 'html') return 'Page Variable (rich text): ' + tipTrunc(pageVarPath(el.getAttribute('data-sw-html')));
    if (kind === 'href') return 'Link URL: ' + tipTrunc(pageVarPath(el.getAttribute('data-sw-href')));
    if (kind === 'image' || kind === 'bg') {
      var attr = kind === 'image' ? 'data-sw-src' : 'data-sw-bg', v = el.getAttribute(attr) || '', name = kind === 'image' ? 'Image' : 'Background Image';
      return isDirectUrl(v) ? name + ' (current value): ' + tipTrunc(v) : name + ': ' + tipTrunc(pageVarPath(v));
    }
    return 'Page Variable: ' + tipTrunc(pageVarPath(el.getAttribute('data-sw-text'))); // text
  }
  // Every editable directive present on ONE element (content-first order) → one badge each.
  function directivesOf(el) {
    var ks = [];
    if (el.hasAttribute('data-sw-text')) ks.push('text');
    if (el.hasAttribute('data-sw-translate')) ks.push('translate');
    if (el.hasAttribute('data-sw-html')) ks.push('html');
    if (el.hasAttribute('data-sw-href')) ks.push('href');
    if (el.hasAttribute('data-sw-src')) ks.push('image');
    if (el.hasAttribute('data-sw-bg')) ks.push('bg');
    if (el.hasAttribute('data-sw-control')) ks.push('control');
    if (el.hasAttribute('data-sw-entry')) ks.push('entry');
    return ks;
  }
  // The editable elements under a point: each hit + its editable ancestors, topmost-first, deduped — so a
  // dataset card inside a link yields BOTH (the inner card and the outer link), each reachable via a badge.
  function editableStack(x, y) {
    var list = [], els = document.elementsFromPoint(x, y) || [];
    for (var i = 0; i < els.length; i++) {
      var node = els[i];
      while (node && node !== document) {
        if (node.nodeType === 1 && isEditable(node) && list.indexOf(node) < 0) list.push(node);
        node = node.parentNode;
      }
    }
    return list;
  }
  var ov = null, ovBox = null, ovRow = null, ovActive = null, ovTimer = null, ovTick = false;
  function ensureOverlay() {
    if (ov) return;
    ov = document.createElement('div'); ov.className = 'sw-ov';
    ovBox = document.createElement('div'); ovBox.className = 'sw-ov-box'; ovBox.style.display = 'none';
    ovRow = document.createElement('div'); ovRow.className = 'sw-ov-row'; ovRow.style.display = 'none';
    ovRow.addEventListener('mouseenter', function () { if (ovTimer) { clearTimeout(ovTimer); ovTimer = null; } });
    ovRow.addEventListener('mouseleave', scheduleHide);
    ov.appendChild(ovBox); ov.appendChild(ovRow);
    document.body.appendChild(ov);
  }
  function badgeKlass(kind) { return kind === 'translate' ? 'sw-b-tr' : kind === 'entry' ? 'sw-b-entry' : ''; }
  function buildBadge(el, kind) {
    var b = document.createElement('button'); b.type = 'button';
    var k = badgeKlass(kind); b.className = 'sw-ov-badge' + (k ? ' ' + k : '');
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[kind] || ICONS.text) + '</svg>'; // fixed icon markup only
    b.appendChild(document.createTextNode(dirLabel(el, kind))); // the variable name as TEXT (no injection)
    var tip = tipText(el, kind);
    b.setAttribute('data-tip', tip); // the styled detail tooltip (CSS ::after, content:attr(data-tip))
    b.setAttribute('aria-label', tip); // a11y: the full typed description is the badge's accessible name
    b.addEventListener('mousedown', function (e) { e.preventDefault(); }); // don't blur a contenteditable mid-edit
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); editDirective(el, kind); });
    b.addEventListener('mouseenter', function () { outlineFor(el, kind); }); // highlight THIS badge's target, in its colour
    return b;
  }
  function outlineFor(el, kind) {
    if (!el.getClientRects().length) { ovBox.style.display = 'none'; return; }
    var r = el.getBoundingClientRect(), k = badgeKlass(kind);
    ovBox.className = 'sw-ov-box' + (k ? ' ' + k : '');
    ovBox.style.left = r.left + 'px'; ovBox.style.top = r.top + 'px';
    ovBox.style.width = r.width + 'px'; ovBox.style.height = r.height + 'px';
    ovBox.style.display = 'block';
  }
  function positionRow(el) {
    if (!el.getClientRects().length) { ovRow.style.display = 'none'; return; }
    var r = el.getBoundingClientRect();
    ovRow.style.display = 'flex';
    var left = r.left; if (left < 2) left = 2;
    var maxLeft = window.innerWidth - ovRow.offsetWidth - 2; if (left > maxLeft) left = maxLeft > 2 ? maxLeft : 2;
    // Sit the badge tab RIGHT ON the element's top edge — OVERLAP it by 2px (no gap) so moving the cursor
    // from the element up onto a badge never crosses a pointer-events:none dead zone that hides the HUD.
    var top = r.top - ovRow.offsetHeight + 2; if (top < 2) top = r.top + 2; // flush to viewport top → just inside
    ovRow.style.left = left + 'px'; ovRow.style.top = top + 'px';
  }
  function showHud(stack) {
    if (ovTimer) { clearTimeout(ovTimer); ovTimer = null; }
    ovActive = stack;
    while (ovRow.firstChild) ovRow.removeChild(ovRow.firstChild);
    var count = 0;
    for (var i = 0; i < stack.length && count < 8; i++) {
      var ks = directivesOf(stack[i]);
      for (var j = 0; j < ks.length && count < 8; j++) { ovRow.appendChild(buildBadge(stack[i], ks[j])); count++; }
    }
    ovRow.style.display = 'flex';
    outlineFor(stack[0], primaryKind(stack[0]));
    // Position AFTER layout — the just-appended badges have no measured size in this same tick.
    var first = stack[0];
    requestAnimationFrame(function () { positionRow(first); });
  }
  function hideHud() { ovTimer = null; ovActive = null; if (ovBox) ovBox.style.display = 'none'; if (ovRow) ovRow.style.display = 'none'; }
  function scheduleHide() { if (ovTimer) return; ovTimer = setTimeout(hideHud, 180); }
  function repositionHud() {
    if (editing && ovActive && ovActive.length) { outlineFor(ovActive[0], primaryKind(ovActive[0])); positionRow(ovActive[0]); }
    // Keep the floating rich-text toolbar glued to its selection as the page scrolls / the viewport resizes
    // (a resize can also change how many buttons fit → re-flow the overflow set).
    if (editing && toolbar && toolbar.style.display !== 'none') positionToolbar();
    if (editing && rzImg) rzPosition(); // keep the image-resize handles on the image
  }
  function onOvMove(e) {
    if (!editing) return;
    if (ov && e.target && ov.contains(e.target)) return; // over the HUD itself → keep it
    if (ovTick) return; ovTick = true;
    var x = e.clientX, y = e.clientY;
    requestAnimationFrame(function () {
      ovTick = false;
      var stack = editableStack(x, y);
      if (stack.length) showHud(stack); else scheduleHide();
    });
  }
  function onOvLeave(e) { if (!e.relatedTarget && !e.toElement) scheduleHide(); } // pointer left the iframe

  function setEditing(on) {
    if (on === editing) return;
    editing = on;
    if (on) ensureStyle();
    // A FIELD inside a dataset loop row is edited via the row's item editor (a click opens it — onEntryClick),
    // NOT in-place: a fully-editable card would otherwise capture every click into a field, leaving the item
    // editor unreachable. So skip in-place wiring for any leaf inside a [data-sw-entry].
    var inEntry = function (el) { return !!(el.closest && el.closest('[data-sw-entry]')); };
    // Plain text — skip anchors that are link-editable (their text rides in the popover).
    eachEl('[data-sw-text]', function (el) {
      if (el.hasAttribute('data-sw-href') || inEntry(el)) return;
      if (on) { el.setAttribute('contenteditable', 'plaintext-only'); el.classList.add('sw-edit-on'); el.addEventListener('input', onPlainInput); }
      else { el.removeAttribute('contenteditable'); el.classList.remove('sw-edit-on'); el.removeEventListener('input', onPlainInput); }
    });
    // Project translations — plaintext editing like data-sw-text, but the edit writes website.translations.
    eachEl('[data-sw-translate]', function (el) {
      if (on) { el.setAttribute('contenteditable', 'plaintext-only'); el.classList.add('sw-tr-on'); el.addEventListener('input', onTranslateInput); }
      else { el.removeAttribute('contenteditable'); el.classList.remove('sw-tr-on'); el.removeEventListener('input', onTranslateInput); }
    });
    // Rich
    eachEl('[data-sw-html]', function (el) {
      if (inEntry(el)) return;
      if (on) { el.setAttribute('contenteditable', 'true'); el.classList.add('sw-edit-on'); el.addEventListener('input', onRichInput); }
      else { el.removeAttribute('contenteditable'); el.classList.remove('sw-edit-on'); el.removeEventListener('input', onRichInput); }
    });
    // Links — skip an element that is ALSO a rich region (its click belongs to rich editing).
    eachEl('[data-sw-href]', function (el) {
      if (el.hasAttribute('data-sw-html') || inEntry(el)) return;
      if (on) { el.classList.add('sw-link-on'); el.addEventListener('click', onLinkClick); }
      else { el.classList.remove('sw-link-on'); el.removeEventListener('click', onLinkClick); }
    });
    // Images + backgrounds — click to replace via the editor's file picker.
    eachEl('[data-sw-src],[data-sw-bg]', function (el) {
      if (inEntry(el)) return;
      if (on) { el.classList.add('sw-img-on'); el.addEventListener('click', onImgClick); }
      else { el.classList.remove('sw-img-on'); el.removeEventListener('click', onImgClick); }
    });
    // Dataset rows — a hover affordance; the click is handled by one delegated document listener.
    eachEl('[data-sw-entry]', function (el) {
      if (on) el.classList.add('sw-entry-on');
      else el.classList.remove('sw-entry-on');
    });
    // Editor-only control chips — shown + clickable only in content mode.
    eachEl('[data-sw-control]', function (el) {
      if (on) { el.classList.add('sw-control-on'); el.addEventListener('click', onControlClick); }
      else { el.classList.remove('sw-control-on'); el.removeEventListener('click', onControlClick); }
    });
    if (on) {
      document.addEventListener('selectionchange', onSelChange);
      // CAPTURE phase: a click on a data-sw-entry must open the entry editor BEFORE a component's own
      // bubble-phase handler (e.g. the carousel's data-click-next "advance on slide click") fires —
      // onEntryClick stopPropagation()s when it handles one, so editing wins over navigation in-editor.
      document.addEventListener('click', onEntryClick, true);
      document.addEventListener('click', rzClick, true); // image-resize handle select / dismiss
      // The overlay HUD: track the editable element(s) under the pointer (capture so it sees every move).
      ensureOverlay();
      document.addEventListener('mousemove', onOvMove, true);
      document.addEventListener('mouseleave', onOvLeave, true);
      window.addEventListener('resize', repositionHud);
      postRegions(); // publish the editable-regions manifest to the editor's Regions panel
    } else {
      document.removeEventListener('selectionchange', onSelChange);
      document.removeEventListener('click', onEntryClick, true);
      document.removeEventListener('click', rzClick, true);
      document.removeEventListener('mousemove', rzMove, true); // clear any in-flight drag listeners
      document.removeEventListener('mouseup', rzEnd, true);
      document.removeEventListener('mousemove', onOvMove, true);
      document.removeEventListener('mouseleave', onOvLeave, true);
      window.removeEventListener('resize', repositionHud);
      rzHide();
      hideHud();
      hideToolbar();
      closePop();
      closeControlPop();
      closeTextPop();
      eachEl('[data-sw-rid]', function (el) { el.removeAttribute('data-sw-rid'); }); // don't leave stale ids
      post({ type: 'regions', items: [] }); // clear the panel when leaving content mode
    }
  }

  // Inbound (editor → preview): validated.
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.source !== PARENT) return;
    if (d.type === 'scrollTo' && typeof d.y === 'number') { try { window.scrollTo(0, d.y); } catch (err) {} }
    else if (d.type === 'setMode') setEditing(d.mode === 'content');
    else if (d.type === 'edit-region' && typeof d.rid === 'number') editRegion(d.rid);
    else if (d.type === 'ci-palette') {
      // The project's CI palette (brand colours + font slots) for the rich-text toolbar. Accept only the
      // {label,cls,value} shape; the applied cls is later sanitized structurally (it becomes a class token
      // on authored content, re-sanitized at render like every other rich value).
      ciColors = Array.isArray(d.colors) ? d.colors.filter(function (c) { return c && typeof c.cls === 'string'; }) : [];
      ciFonts = Array.isArray(d.fonts) ? d.fonts.filter(function (c) { return c && typeof c.cls === 'string'; }) : [];
    }
    else if (d.type === 'insert-media' && typeof d.url === 'string') tbInsertImage(d.url, d.alt, d.width, d.height); // media dialog → <img> at the saved caret
  });
  restore();
  window.addEventListener('load', restore); // re-apply once images/fonts settle the layout height
  post({ type: 'ready' });
})();`;
