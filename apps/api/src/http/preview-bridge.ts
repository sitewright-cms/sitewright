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
 *                     { source:'sitewright-preview', type:'control-edit', target, as, value }       (sw-control set)
 *                     { source:'sitewright-preview', type:'control-pick-image', target, as }        (sw-control image/file)
 *                     { source:'sitewright-preview', type:'regions', items:[{rid,kind,label,dataset?,id?}] } (Regions rail manifest)
 *   editor → preview: { source:'sitewright-editor', type:'scrollTo', y }
 *                     { source:'sitewright-editor', type:'setMode', mode }
 *                     { source:'sitewright-editor', type:'edit-region', rid }   (Regions rail: locate + edit a region)
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

  // --- Project translations ([data-sw-translate]): plain-text editing that writes the SHARED catalog. ---
  function onTranslateInput(e) { var el = e.currentTarget; post({ type: 'translate-edit', key: el.getAttribute('data-sw-translate') || '', value: el.textContent || '' }); }

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

  // --- Dataset rows ([data-sw-entry]): click opens that entry's editor (unless the click is on an
  //     editable leaf, which wins). data-sw-href/src/bg already stopPropagation in their handlers. ---
  function onEntryClick(e) {
    if (!editing) return;
    // Capture phase: let a click on an editable LEAF inside the entry reach that leaf's own handler
    // (text/html inline edit, href/src/bg/control popovers + pickers — which stopPropagation in bubble);
    // only a click on the entry's NON-editable chrome (e.g. the hero slide body) opens the entry.
    if (e.target && e.target.closest && e.target.closest('[data-sw-text],[data-sw-html],[data-sw-href],[data-sw-src],[data-sw-bg],[data-sw-control]')) return;
    var el = closestAttr(e.target, 'data-sw-entry');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation(); // win over a component's own click handler (e.g. carousel data-click-next)
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
  function repositionHud() { if (editing && ovActive && ovActive.length) { outlineFor(ovActive[0], primaryKind(ovActive[0])); positionRow(ovActive[0]); } }
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
    // Plain text — skip anchors that are link-editable (their text rides in the popover).
    eachEl('[data-sw-text]', function (el) {
      if (el.hasAttribute('data-sw-href')) return;
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
      if (on) { el.setAttribute('contenteditable', 'true'); el.classList.add('sw-edit-on'); el.addEventListener('input', onRichInput); }
      else { el.removeAttribute('contenteditable'); el.classList.remove('sw-edit-on'); el.removeEventListener('input', onRichInput); }
    });
    // Links — skip an element that is ALSO a rich region (its click belongs to rich editing).
    eachEl('[data-sw-href]', function (el) {
      if (el.hasAttribute('data-sw-html')) return;
      if (on) { el.classList.add('sw-link-on'); el.addEventListener('click', onLinkClick); }
      else { el.classList.remove('sw-link-on'); el.removeEventListener('click', onLinkClick); }
    });
    // Images + backgrounds — click to replace via the editor's file picker.
    eachEl('[data-sw-src],[data-sw-bg]', function (el) {
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
      // The overlay HUD: track the editable element(s) under the pointer (capture so it sees every move).
      ensureOverlay();
      document.addEventListener('mousemove', onOvMove, true);
      document.addEventListener('mouseleave', onOvLeave, true);
      window.addEventListener('resize', repositionHud);
      postRegions(); // publish the editable-regions manifest to the editor's Regions panel
    } else {
      document.removeEventListener('selectionchange', onSelChange);
      document.removeEventListener('click', onEntryClick, true);
      document.removeEventListener('mousemove', onOvMove, true);
      document.removeEventListener('mouseleave', onOvLeave, true);
      window.removeEventListener('resize', repositionHud);
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
  });
  restore();
  window.addEventListener('load', restore); // re-apply once images/fonts settle the layout height
  post({ type: 'ready' });
})();`;
