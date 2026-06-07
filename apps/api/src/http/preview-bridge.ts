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
 *                     { source:'sitewright-preview', type:'edit', key, value }   (PR2)
 *   editor → preview: { source:'sitewright-editor', type:'scrollTo', y }
 *                     { source:'sitewright-editor', type:'setMode', mode }        (PR2)
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
    });
  }, { passive: true });
  // --- Inline content editing (content mode): make [data-sw-edit] regions click-to-edit. ---
  var editing = false, styled = false;
  function ensureStyle() {
    if (styled) return; styled = true;
    var s = document.createElement('style');
    s.textContent =
      '[data-sw-edit]{outline:1px dashed transparent;outline-offset:2px;border-radius:2px;transition:outline-color .12s,background-color .12s}' +
      '[data-sw-edit].sw-edit-on{cursor:text}' +
      '[data-sw-edit].sw-edit-on:hover{outline-color:#6366f1;background:rgba(99,102,241,.07)}' +
      '[data-sw-edit].sw-edit-on:hover::after{content:"\\270e";margin-left:.35em;font-size:.8em;opacity:.55}' +
      '[data-sw-edit].sw-edit-on:focus{outline:2px solid #6366f1;background:rgba(99,102,241,.10)}';
    (document.head || document.documentElement).appendChild(s);
  }
  function onInput(e) {
    var el = e.currentTarget;
    post({ type: 'edit', key: el.getAttribute('data-sw-edit'), value: el.textContent || '' });
  }
  function setEditing(on) {
    if (on === editing) return;
    editing = on;
    if (on) ensureStyle();
    var els = document.querySelectorAll('[data-sw-edit]');
    for (var j = 0; j < els.length; j++) {
      var el = els[j];
      if (on) {
        el.setAttribute('contenteditable', 'plaintext-only');
        el.classList.add('sw-edit-on');
        el.addEventListener('input', onInput);
      } else {
        el.removeAttribute('contenteditable');
        el.classList.remove('sw-edit-on');
        el.removeEventListener('input', onInput);
      }
    }
  }
  // Inbound (editor → preview): validated.
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.source !== PARENT) return;
    if (d.type === 'scrollTo' && typeof d.y === 'number') { try { window.scrollTo(0, d.y); } catch (err) {} }
    else if (d.type === 'setMode') setEditing(d.mode === 'content');
  });
  restore();
  window.addEventListener('load', restore); // re-apply once images/fonts settle the layout height
  post({ type: 'ready' });
})();`;
