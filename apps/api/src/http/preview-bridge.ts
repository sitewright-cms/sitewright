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
 *                     { source:'sitewright-preview', type:'rich-edit', key, html }       (data-sw-html)
 *                     { source:'sitewright-preview', type:'link-edit', hrefKey, href, textKey, text } (data-sw-href)
 *                     { source:'sitewright-preview', type:'pick-image', key, kind:'image'|'bg' }   (data-sw-src/bg)
 *                     { source:'sitewright-preview', type:'open-entry', dataset, id }              (data-sw-entry)
 *                     { source:'sitewright-preview', type:'edit-html-source', key, html }          (data-sw-html → source modal)
 *                     { source:'sitewright-preview', type:'control-edit', target, as, value }       (sw-control set)
 *                     { source:'sitewright-preview', type:'control-pick-image', target, as }        (sw-control image/file)
 *   editor → preview: { source:'sitewright-editor', type:'scrollTo', y }
 *                     { source:'sitewright-editor', type:'setMode', mode }
 *
 * Editing surfaces (content mode): [data-sw-text] → plaintext contenteditable;
 * [data-sw-html] → rich contenteditable with a floating formatting toolbar; [data-sw-href] anchor →
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
    });
  }, { passive: true });

  var editing = false, styled = false;
  function ensureStyle() {
    if (styled) return; styled = true;
    var s = document.createElement('style');
    s.textContent =
      // Base affordance for EVERY editable leaf: a THICK, INSET, dashed outline (transparent here —
      // each on-state rule below supplies only the outline-COLOR). In content mode the on-state
      // classes light this up so every editable element is clearly marked AT REST, no hover needed.
      '[data-sw-text],[data-sw-html],[data-sw-href],[data-sw-src],[data-sw-bg]{outline:2px dashed transparent;outline-offset:-2px;border-radius:2px;transition:outline-color .12s,background-color .12s}' +
      // Text/rich: dashed indigo at rest; a faint bg tint on hover; the outline goes SOLID while editing (focus).
      '.sw-edit-on{cursor:text;outline-color:#6366f1}' +
      '.sw-edit-on:hover{background:rgba(99,102,241,.08)}' +
      '.sw-edit-on:focus{outline-style:solid;background:rgba(99,102,241,.12)}' +
      // Links: dashed indigo at rest; a bg tint on hover (a click opens the link editor).
      '[data-sw-href].sw-link-on{cursor:pointer;outline-color:#6366f1}' +
      '[data-sw-href].sw-link-on:hover{background:rgba(99,102,241,.10)}' +
      // Images/bg: dashed indigo at rest; an inset tint overlay on hover (a click opens the picker).
      '[data-sw-src].sw-img-on,[data-sw-bg].sw-img-on{cursor:pointer;outline-color:#6366f1}' +
      '[data-sw-src].sw-img-on:hover,[data-sw-bg].sw-img-on:hover{box-shadow:inset 0 0 0 9999px rgba(99,102,241,.12)}' +
      // Dataset rows: same always-on marker, in teal to distinguish a structured entry from inline content.
      '[data-sw-entry].sw-entry-on{cursor:pointer;outline:2px dashed #14b8a6;outline-offset:-2px;border-radius:3px;transition:outline-color .12s,background-color .12s}' +
      '[data-sw-entry].sw-entry-on:hover{background:rgba(20,184,166,.08)}' +
      // Field-name BADGES (hover/focus): a floating pill naming the bound key/dataset, anchored to the
      // element (setEditing promotes a STATIC host to relative so the absolute ::before anchors here),
      // with a near-max z-index so it is never covered. content:attr(...) shows the field name; the
      // emoji type-glyphs are safe — this CSS only runs in the Chromium preview, never in published HTML.
      // display:none at rest (NOT opacity:0): an opacity:0 pseudo stays in the hit-test tree and can
      // block clicks on an element flush with the iframe top even with pointer-events:none; display:none
      // removes it entirely and it still reveals cleanly on hover.
      '[data-sw-text].sw-edit-on::before,[data-sw-html].sw-edit-on::before,[data-sw-href].sw-link-on::before,[data-sw-src].sw-img-on::before,[data-sw-bg].sw-img-on::before,[data-sw-entry].sw-entry-on::before{display:none;position:absolute;top:0;left:0;transform:translateY(-100%);z-index:2147483640;padding:1px 5px;border-radius:5px 5px 5px 0;font:600 10px/1.5 system-ui,sans-serif;color:#fff;background:#6366f1;white-space:nowrap;pointer-events:none}' +
      // Glyphs use JS unicode escapes so the LITERAL char lands in the CSS string; a raw CSS hex
      // escape would be eaten by the inner JS string octal-escape parsing when this script runs.
      '[data-sw-text].sw-edit-on::before{content:"\\u270E " attr(data-sw-text)}' +
      '[data-sw-html].sw-edit-on::before{content:"\\u00B6 " attr(data-sw-html)}' +
      '[data-sw-href].sw-link-on::before{content:"\\u{1F517} " attr(data-sw-href)}' +
      '[data-sw-src].sw-img-on::before{content:"\\u{1F5BC} " attr(data-sw-src)}' +
      '[data-sw-bg].sw-img-on::before{content:"\\u{1F5BC} " attr(data-sw-bg)}' +
      '[data-sw-entry].sw-entry-on::before{content:"\\u{1F5C2} " attr(data-sw-dataset);background:#14b8a6}' +
      '[data-sw-text].sw-edit-on:hover::before,[data-sw-text].sw-edit-on:focus::before,[data-sw-html].sw-edit-on:hover::before,[data-sw-html].sw-edit-on:focus::before,[data-sw-href].sw-link-on:hover::before,[data-sw-href].sw-link-on:focus::before,[data-sw-src].sw-img-on:hover::before,[data-sw-bg].sw-img-on:hover::before,[data-sw-entry].sw-entry-on:hover::before{display:block}' +
      // Positioning host for the absolute badge — applied as a CLASS (added only to elements computed
      // static, so positioned elements are untouched) so it never mutates the inline style attribute.
      '.sw-rel{position:relative}' +
      // Overlay HANDLES: an always-on-top click target for any editable leaf the page would OCCLUDE
      // (an overlay on top), HIDE (a display:none ancestor — e.g. a Tailwind hidden "settings chips"
      // wrapper), or PARK off-screen (a non-active carousel slide). The host is a fixed viewport layer
      // at a near-max z-index (above any normal author overlay / cookie bar / lightbox); each handle is
      // a small pill positioned by the leaf's (or a visible ancestor's) geometry. Edit popovers (.sw-pop,
      // z+1 below) therefore always sit ABOVE the handles. Group handles (sky) front a chooser list.
      '.sw-handles{position:fixed;inset:0;z-index:2147483646;pointer-events:none}' +
      '.sw-handle{position:absolute;pointer-events:auto;display:flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;border-radius:9999px;border:1.5px solid #fff;background:#6366f1;color:#fff;cursor:pointer;font:700 11px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);transition:transform .1s,background .1s}' +
      '.sw-handle:hover{background:#4f46e5;transform:scale(1.12)}' +
      '.sw-handle.sw-handle-group{background:#0ea5e9}.sw-handle.sw-handle-group:hover{background:#0284c7}' +
      '.sw-pop .sw-grouprow{all:unset;display:block;cursor:pointer;padding:5px 8px;border-radius:6px;font:13px system-ui,sans-serif;color:#1e293b}' +
      '.sw-pop .sw-grouprow:hover{background:#eef2ff}' +
      '.sw-tb{position:fixed;z-index:2147483647;display:none;gap:2px;padding:3px;border-radius:8px;background:#0f172a;box-shadow:0 6px 20px rgba(0,0,0,.35);font:600 12px system-ui,sans-serif}' +
      '.sw-tb button{all:unset;color:#e2e8f0;cursor:pointer;padding:3px 7px;border-radius:5px;min-width:18px;text-align:center}' +
      '.sw-tb button:hover{background:#334155;color:#fff}' +
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
      '.sw-control-on:hover{background:#e0e7ff}';
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

  // --- Rich ([data-sw-html]) + floating toolbar ---
  var toolbar = null;
  var TB_CMDS = [
    ['B', 'bold'], ['I', 'italic'], ['U', 'underline'], ['S', 'strikeThrough'],
    ['x\\u00b2', 'superscript'], ['x\\u2082', 'subscript'],
    ['H2', 'formatBlock:h2'], ['H3', 'formatBlock:h3'], ['\\u275d', 'formatBlock:blockquote'],
    ['\\u2022', 'insertUnorderedList'], ['1.', 'insertOrderedList'], ['\\u00b6', 'formatBlock:p'],
    ['\\u2500', 'insertHorizontalRule'], ['\\u2327', 'removeFormat'],
    ['</>', 'html-source']
  ];
  function ensureToolbar() {
    if (toolbar) return toolbar;
    toolbar = document.createElement('div');
    toolbar.className = 'sw-tb';
    for (var i = 0; i < TB_CMDS.length; i++) {
      (function (spec) {
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = spec[0];
        b.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep the selection
        b.addEventListener('click', function (e) { e.preventDefault(); runCmd(spec[1]); });
        toolbar.appendChild(b);
      })(TB_CMDS[i]);
    }
    document.body.appendChild(toolbar);
    return toolbar;
  }
  function currentRich() {
    var sel = window.getSelection && window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    return closestAttr(sel.anchorNode, 'data-sw-html');
  }
  function runCmd(cmd) {
    var rich = currentRich();
    if (!rich) return;
    // The HTML-source button hands off to the editor (opens a CodeMirror modal) — not an execCommand.
    // Include the region's live innerHTML so the editor can seed the modal with the CURRENT content
    // (the authored default when page.data has no override yet).
    if (cmd === 'html-source') { post({ type: 'edit-html-source', key: rich.getAttribute('data-sw-html'), html: rich.innerHTML }); hideToolbar(); return; }
    var parts = cmd.split(':');
    try { document.execCommand(parts[0], false, parts[1]); } catch (e) {}
    post({ type: 'rich-edit', key: rich.getAttribute('data-sw-html'), html: rich.innerHTML });
    positionToolbar();
  }
  function onRichInput(e) { var el = e.currentTarget; post({ type: 'rich-edit', key: el.getAttribute('data-sw-html'), html: el.innerHTML }); }
  function positionToolbar() {
    if (!editing) { hideToolbar(); return; }
    var rich = currentRich();
    var sel = window.getSelection && window.getSelection();
    if (!rich || !sel || sel.rangeCount === 0) { hideToolbar(); return; }
    var rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0 && rect.top === 0)) { rect = rich.getBoundingClientRect(); }
    var tb = ensureToolbar();
    tb.style.display = 'flex';
    var top = rect.top - tb.offsetHeight - 8; if (top < 4) top = rect.bottom + 8;
    var left = rect.left; if (left < 4) left = 4;
    var maxLeft = window.innerWidth - tb.offsetWidth - 4; if (left > maxLeft) left = maxLeft > 4 ? maxLeft : 4;
    tb.style.top = top + 'px'; tb.style.left = left + 'px';
  }
  function hideToolbar() { if (toolbar) toolbar.style.display = 'none'; }
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
    var rect = rectFor(anchor);
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
    var rect = rectFor(el);
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

  // --- Dataset rows ([data-sw-entry]): click opens that entry's editor (unless the click is on an
  //     editable leaf, which wins). data-sw-href/src/bg already stopPropagation in their handlers. ---
  function onEntryClick(e) {
    if (!editing) return;
    if (closestAttr(e.target, 'data-sw-text') || closestAttr(e.target, 'data-sw-html')) return;
    var el = closestAttr(e.target, 'data-sw-entry');
    if (!el) return;
    e.preventDefault();
    post({ type: 'open-entry', dataset: el.getAttribute('data-sw-dataset') || '', id: el.getAttribute('data-sw-entry') || '' });
  }

  function eachEl(sel, fn) { var els = document.querySelectorAll(sel); for (var j = 0; j < els.length; j++) fn(els[j]); }
  // The field-name badge ::before is position:absolute, so its host needs a positioned box. Promote a
  // STATIC host with the .sw-rel class (NOT inline style — that would reserialize the element's style
  // attribute, e.g. collapse a data-sw-bg background-image); an already-positioned element is untouched.
  function relPos(el, on) {
    if (on) { if (getComputedStyle(el).position === 'static') el.classList.add('sw-rel'); }
    else el.classList.remove('sw-rel');
  }
  // ---- Overlay HANDLES ----------------------------------------------------------------------------
  // In-place affordances fail when the page OCCLUDES an editable leaf (an absolute overlay painted on
  // top), HIDES it (a display:none ancestor — e.g. a Tailwind hidden "settings chips" wrapper), or
  // PARKS it off-screen (a non-active carousel slide). For those leaves we attach a click target in a
  // fixed top-most layer, positioned by geometry, so nothing in the page can cover it and the leaf's
  // own visibility no longer gates reachability. Edits route through the SAME popover/picker/postMessage
  // sinks the in-place path uses; directly-reachable leaves keep the lighter in-place editing.
  var HANDLE_SEL = '[data-sw-text],[data-sw-html],[data-sw-href],[data-sw-src],[data-sw-bg],[data-sw-control],[data-sw-entry]';
  var handleHost = null, handleList = [], handleScrollRaf = 0, handleRefreshTimer = 0, swAnchorRect = null, groupPop = null;

  function ensureHandleHost() {
    if (handleHost) return handleHost;
    handleHost = document.createElement('div'); handleHost.className = 'sw-handles';
    document.body.appendChild(handleHost);
    return handleHost;
  }
  // A leaf's geometry for popover placement — its own rect, or (when hidden) the rect of the handle
  // that opened it (swAnchorRect), or a safe corner default.
  function rectFor(el) {
    if (el && el.getClientRects && el.getClientRects().length) return el.getBoundingClientRect();
    return swAnchorRect || { left: 16, top: 16, bottom: 36, right: 120, width: 104, height: 20 };
  }
  function leafLabel(el) {
    return el.getAttribute('data-sw-control-label') || el.getAttribute('data-sw-text') || el.getAttribute('data-sw-html')
      || el.getAttribute('data-sw-href') || el.getAttribute('data-sw-src') || el.getAttribute('data-sw-bg')
      || el.getAttribute('data-sw-dataset') || 'field';
  }
  function leafGlyph(el) {
    if (el.hasAttribute('data-sw-control')) return '\\u2699';
    if (el.hasAttribute('data-sw-src') || el.hasAttribute('data-sw-bg')) return '\\u{1F5BC}';
    if (el.hasAttribute('data-sw-href')) return '\\u{1F517}';
    if (el.hasAttribute('data-sw-entry')) return '\\u{1F5C2}';
    if (el.hasAttribute('data-sw-html')) return '\\u00B6';
    return '\\u270E';
  }
  // Route a leaf to its existing edit flow — none of these need the leaf to be visible (every sink is a
  // popover/picker/postMessage), except plain inline text, which falls back to a textarea popover.
  function editLeaf(el) {
    if (el.hasAttribute('data-sw-control')) return openControlPop(el);
    if (el.hasAttribute('data-sw-src') || el.hasAttribute('data-sw-bg')) return pickImage(el);
    if (el.hasAttribute('data-sw-href') && !el.hasAttribute('data-sw-html')) return openPop(el);
    if (el.hasAttribute('data-sw-html')) return editText(el, true);
    if (el.hasAttribute('data-sw-text')) return editText(el, false);
    if (el.hasAttribute('data-sw-entry')) return post({ type: 'open-entry', dataset: el.getAttribute('data-sw-dataset') || '', id: el.getAttribute('data-sw-entry') || '' });
  }
  // Reachable inline text → focus + select for in-place editing; otherwise edit via a popover (rich →
  // the editor HTML-source modal; plain → a textarea writing the same page.data leaf the inline path does).
  function editText(el, rich) {
    if (el.getClientRects().length && reachOf(el) === 'ok') {
      try { el.focus(); var rng = document.createRange(); rng.selectNodeContents(el); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng); } catch (e) {}
      if (rich) positionToolbar();
      return;
    }
    if (rich) { post({ type: 'edit-html-source', key: el.getAttribute('data-sw-html'), html: el.innerHTML }); return; }
    openTextPop(el);
  }
  // Minimal textarea popover for a plain-text leaf that is not reachable in place.
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
    placeNear(tpop, rectFor(el));
    tpop.querySelector('.sw-tval').focus();
    document.addEventListener('mousedown', onTextDocDown, true);
  }
  function applyTextPop() {
    if (tpopEl) {
      // Mirror the inline path: write the leaf's textContent too, so the editor's 'edit' handler (which
      // SUPPRESSES the reload, assuming the contenteditable already shows the change) is correct — without
      // this the occluded/hidden element would keep its stale text until an unrelated reload.
      var v = tpop.querySelector('.sw-tval').value;
      try { tpopEl.textContent = v; } catch (e) {}
      post({ type: 'edit', key: tpopEl.getAttribute('data-sw-text') || '', value: v });
    }
    closeTextPop();
  }
  function closeTextPop() { if (tpop) tpop.style.display = 'none'; tpopEl = null; document.removeEventListener('mousedown', onTextDocDown, true); }
  function onTextDocDown(e) { if (!tpop || tpop.style.display === 'none') return; if (tpop.contains(e.target)) return; closeTextPop(); }

  // Classify how reachable a leaf is RIGHT NOW (depends on scroll position + occluders on top of it).
  function reachOf(el) {
    if (!el.getClientRects().length) return 'hidden';
    var r = el.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    if (r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw) {
      var cx = Math.min(Math.max(r.left + r.width / 2, 1), vw - 1);
      var cy = Math.min(Math.max(r.top + r.height / 2, 1), vh - 1);
      var hit = document.elementFromPoint(cx, cy);
      return (hit && (hit === el || el.contains(hit))) ? 'ok' : 'occluded';
    }
    var de = document.documentElement, aT = r.top + window.scrollY, aL = r.left + window.scrollX;
    return (aT >= -4 && aT <= de.scrollHeight + 4 && aL >= -4 && aL <= de.scrollWidth + 4) ? 'offscreen' : 'parked';
  }
  // Nearest on-screen ancestor with layout — the anchor a proxy handle pins to for a hidden/parked
  // leaf. Falls back to document.body (always present) so a handle is ALWAYS attachable.
  function nearestAnchor(el) {
    var n = el.parentElement, guard = 0;
    while (n && n !== document.body && guard++ < 60) {
      if (n.getClientRects().length) {
        var r = n.getBoundingClientRect();
        if (r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth) return n;
      }
      n = n.parentElement;
    }
    return document.body;
  }
  function clearHandles() {
    for (var i = 0; i < handleList.length; i++) handleList[i].btn.remove();
    handleList = []; closeGroupPop();
  }
  function makeHandle(anchor, leaves) {
    var btn = document.createElement('button'); btn.type = 'button';
    var grouped = leaves.length > 1 || anchor !== leaves[0];
    btn.className = grouped ? 'sw-handle sw-handle-group' : 'sw-handle';
    btn.textContent = leaves.length > 1 ? String(leaves.length) : leafGlyph(leaves[0]);
    btn.title = leaves.length > 1 ? (leaves.length + ' editable fields here') : ('Edit ' + leafLabel(leaves[0]));
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      swAnchorRect = btn.getBoundingClientRect();
      if (leaves.length > 1) openGroupPop(leaves, swAnchorRect);
      else editLeaf(leaves[0]);
    });
    ensureHandleHost().appendChild(btn);
    handleList.push({ btn: btn, anchor: anchor });
  }
  function refreshHandles() {
    if (!editing) return;
    clearHandles();
    var groups = [];
    function groupFor(anchor) {
      for (var i = 0; i < groups.length; i++) if (groups[i].anchor === anchor) return groups[i];
      var g = { anchor: anchor, leaves: [] }; groups.push(g); return g;
    }
    eachEl(HANDLE_SEL, function (el) {
      var reach = reachOf(el);
      // 'offscreen' = within the scrollable canvas but below/above the fold → reachable by scrolling, so
      // no handle (scroll brings it into view, where it reclassifies to ok/occluded). KNOWN GAP: a leaf
      // positioned (absolute/translate, not clipped to 0 rects) outside the viewport yet inside scrollHeight
      // but UNreachable by scroll is misread as offscreen. Real carousels clip via overflow:hidden →
      // 0 rects → the 'hidden' branch, so this only bites a hand-rolled absolute layout.
      if (reach === 'ok' || reach === 'offscreen') return;
      if (reach === 'occluded') { makeHandle(el, [el]); return; } // direct handle over the occluder
      groupFor(nearestAnchor(el)).leaves.push(el);                // hidden/parked → proxy + group
    });
    for (var g = 0; g < groups.length; g++) makeHandle(groups[g].anchor, groups[g].leaves);
    positionHandles();
  }
  function positionHandles() {
    for (var i = 0; i < handleList.length; i++) {
      var h = handleList[i], a = h.anchor;
      if (!a.getClientRects().length) { h.btn.style.display = 'none'; continue; }
      h.btn.style.display = 'flex';
      // The document.body fallback (a hidden leaf with no on-screen ancestor) docks in the bottom-left
      // corner so the catch-all handle never covers the hero / nav at the top.
      if (a === document.body) { h.btn.style.left = '10px'; h.btn.style.top = (window.innerHeight - 32) + 'px'; continue; }
      var r = a.getBoundingClientRect();
      h.btn.style.left = Math.min(Math.max(r.left, 2), window.innerWidth - 26) + 'px';
      h.btn.style.top = Math.min(Math.max(r.top, 2), window.innerHeight - 26) + 'px';
    }
  }
  function placeNear(p, rect) {
    var top = rect.bottom + 6, left = rect.left;
    var maxLeft = window.innerWidth - p.offsetWidth - 6; if (left > maxLeft) left = maxLeft > 6 ? maxLeft : 6; if (left < 6) left = 6;
    if (top + p.offsetHeight > window.innerHeight - 6) top = rect.top - p.offsetHeight - 6;
    if (top < 6) top = 6;
    p.style.top = top + 'px'; p.style.left = left + 'px';
  }
  function ensureGroupPop() {
    if (groupPop) return groupPop;
    groupPop = document.createElement('div'); groupPop.className = 'sw-pop';
    document.body.appendChild(groupPop);
    return groupPop;
  }
  function openGroupPop(leaves, rect) {
    var p = ensureGroupPop();
    while (p.firstChild) p.removeChild(p.firstChild);
    for (var i = 0; i < leaves.length; i++) {
      (function (leaf) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'sw-grouprow';
        b.textContent = leafGlyph(leaf) + ' ' + leafLabel(leaf);
        b.addEventListener('click', function (e) { e.preventDefault(); closeGroupPop(); swAnchorRect = rect; editLeaf(leaf); });
        p.appendChild(b);
      })(leaves[i]);
    }
    p.style.display = 'flex';
    placeNear(p, rect);
    document.addEventListener('mousedown', onGroupDocDown, true);
  }
  function onGroupDocDown(e) { if (!groupPop || groupPop.style.display === 'none') return; if (groupPop.contains(e.target)) return; closeGroupPop(); }
  function closeGroupPop() { if (groupPop) groupPop.style.display = 'none'; document.removeEventListener('mousedown', onGroupDocDown, true); }
  function onHandleScroll() {
    if (!editing) return;
    if (!handleScrollRaf) handleScrollRaf = requestAnimationFrame(function () { handleScrollRaf = 0; positionHandles(); });
    if (handleRefreshTimer) clearTimeout(handleRefreshTimer);
    handleRefreshTimer = setTimeout(function () { handleRefreshTimer = 0; refreshHandles(); }, 150);
  }
  function setEditing(on) {
    if (on === editing) return;
    editing = on;
    if (on) ensureStyle();
    // Plain text — skip anchors that are link-editable (their text rides in the popover).
    eachEl('[data-sw-text]', function (el) {
      if (el.hasAttribute('data-sw-href')) return;
      if (on) { el.setAttribute('contenteditable', 'plaintext-only'); el.classList.add('sw-edit-on'); el.addEventListener('input', onPlainInput); }
      else { el.removeAttribute('contenteditable'); el.classList.remove('sw-edit-on'); el.removeEventListener('input', onPlainInput); }
      relPos(el, on);
    });
    // Rich
    eachEl('[data-sw-html]', function (el) {
      if (on) { el.setAttribute('contenteditable', 'true'); el.classList.add('sw-edit-on'); el.addEventListener('input', onRichInput); }
      else { el.removeAttribute('contenteditable'); el.classList.remove('sw-edit-on'); el.removeEventListener('input', onRichInput); }
      relPos(el, on);
    });
    // Links — skip an element that is ALSO a rich region (its click belongs to rich editing).
    eachEl('[data-sw-href]', function (el) {
      if (el.hasAttribute('data-sw-html')) return;
      if (on) { el.classList.add('sw-link-on'); el.addEventListener('click', onLinkClick); }
      else { el.classList.remove('sw-link-on'); el.removeEventListener('click', onLinkClick); }
      relPos(el, on);
    });
    // Images + backgrounds — click to replace via the editor's file picker.
    eachEl('[data-sw-src],[data-sw-bg]', function (el) {
      if (on) { el.classList.add('sw-img-on'); el.addEventListener('click', onImgClick); }
      else { el.classList.remove('sw-img-on'); el.removeEventListener('click', onImgClick); }
      relPos(el, on);
    });
    // Dataset rows — a hover affordance; the click is handled by one delegated document listener.
    eachEl('[data-sw-entry]', function (el) {
      if (on) el.classList.add('sw-entry-on');
      else el.classList.remove('sw-entry-on');
      relPos(el, on);
    });
    // Editor-only control chips — shown + clickable only in content mode.
    eachEl('[data-sw-control]', function (el) {
      if (on) { el.classList.add('sw-control-on'); el.addEventListener('click', onControlClick); }
      else { el.classList.remove('sw-control-on'); el.removeEventListener('click', onControlClick); }
    });
    // Attach overlay handles for any leaf the page occludes / hides / parks off-screen (the rest keep
    // in-place editing); keep them positioned on scroll / resize. Runs AFTER the per-leaf wiring above
    // so a hidden chip's own .sw-control-on display is already set when its handle routes to it.
    if (on) {
      refreshHandles();
      window.addEventListener('scroll', onHandleScroll, { passive: true });
      window.addEventListener('resize', onHandleScroll);
      document.addEventListener('selectionchange', onSelChange);
      document.addEventListener('click', onEntryClick);
    } else {
      window.removeEventListener('scroll', onHandleScroll);
      window.removeEventListener('resize', onHandleScroll);
      if (handleScrollRaf) { cancelAnimationFrame(handleScrollRaf); handleScrollRaf = 0; }
      if (handleRefreshTimer) { clearTimeout(handleRefreshTimer); handleRefreshTimer = 0; }
      clearHandles();
      closeTextPop();
      document.removeEventListener('selectionchange', onSelChange);
      document.removeEventListener('click', onEntryClick);
      hideToolbar();
      closePop();
      closeControlPop();
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
