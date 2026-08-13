/**
 * The OAuth consent surface's client script.
 *
 * Served as an EXTERNAL same-origin file (`/oauth/consent.js`), never inline: the app's default CSP is
 * `default-src 'self'` with no `script-src 'unsafe-inline'`, so an inline block would simply be
 * blocked — and adding a `'sha256-…'` hash would mean recomputing it by hand on every edit (the
 * editor's FOUC script already carries that maintenance cost; one is enough).
 *
 * Everything here is PROGRESSIVE. Without JS the consent form still submits, the project radios still
 * work, and the issued code is still visible and selectable — the script only adds filtering, the
 * Enter shortcut, and copy-to-clipboard.
 */
export const CONSENT_SCRIPT = `(function(){
  'use strict';

  // ---- toast -------------------------------------------------------------
  var toastEl = document.getElementById('sw-toast');
  var toastTimer = 0;
  function toast(message){
    if(!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove('show'); }, 2200);
  }

  // ---- project search ----------------------------------------------------
  // Filters the radio CARDS in place. The selection is preserved while it stays visible; when a filter
  // hides the checked project the first visible one is selected instead, so the form can never submit
  // a project the user can no longer see.
  var search = document.getElementById('sw-project-search');
  var list = document.getElementById('sw-projects');
  if(search && list){
    var cards = [].slice.call(list.querySelectorAll('.project'));
    var empty = document.getElementById('sw-no-match');
    var apply = function(){
      var q = search.value.trim().toLowerCase();
      var shown = 0;
      var checkedVisible = false;
      for(var i=0;i<cards.length;i++){
        var card = cards[i];
        var name = (card.getAttribute('data-name') || '').toLowerCase();
        var hit = !q || name.indexOf(q) >= 0;
        card.hidden = !hit;
        if(hit){
          shown++;
          if(card.querySelector('input').checked) checkedVisible = true;
        }
      }
      if(!checkedVisible && shown > 0){
        for(var j=0;j<cards.length;j++){
          if(!cards[j].hidden){ cards[j].querySelector('input').checked = true; break; }
        }
      }
      if(empty) empty.hidden = shown !== 0;
    };
    search.addEventListener('input', apply);
    // Enter in the search box APPROVES with whatever is selected — the whole point of the shortcut is
    // "type three letters, hit Enter". Suppressed while nothing matches, so Enter can't approve a
    // stale selection the user can't see.
    search.addEventListener('keydown', function(e){
      if(e.key !== 'Enter') return;
      e.preventDefault();
      var visible = cards.some(function(c){ return !c.hidden; });
      if(!visible) return;
      var approve = document.getElementById('sw-approve');
      if(approve) approve.click();
    });
    apply();
    // Focus the filter on load so the keyboard path needs no click at all.
    try { search.focus(); } catch(_){}
  }

  // ---- copy buttons ------------------------------------------------------
  // Any [data-copy] button copies the text of the element it names and toasts its data-copied
  // label. Generic because the approval screen offers TWO values: the callback URL (what Claude Code
  // asks for) and the bare code (what some other clients ask for).
  // NOTE: no backticks anywhere in this file's template literal — they close the string.
  var copyButtons = document.querySelectorAll('[data-copy]');
  for(var b=0;b<copyButtons.length;b++){
    (function(btn){
      btn.addEventListener('click', function(){
        var el = document.getElementById(btn.getAttribute('data-copy') || '');
        var value = el ? (el.textContent || '').trim() : '';
        if(!value) return;
        var label = btn.getAttribute('data-copied') || 'Copied';
        var ok = function(){ toast(label + ' to clipboard'); };
        // navigator.clipboard needs a SECURE CONTEXT; an instance reached over plain HTTP on a LAN
        // has none, so fall back to a hidden textarea + execCommand rather than silently doing nothing.
        var fallback = function(){
          try{
            var ta = document.createElement('textarea');
            ta.value = value;
            ta.setAttribute('readonly','');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            var done = document.execCommand('copy');
            document.body.removeChild(ta);
            if(done) ok(); else toast('Press Ctrl/Cmd+C to copy');
          }catch(_){ toast('Press Ctrl/Cmd+C to copy'); }
        };
        if(navigator.clipboard && navigator.clipboard.writeText){
          navigator.clipboard.writeText(value).then(ok, fallback);
        } else {
          fallback();
        }
      });
    })(copyButtons[b]);
  }

  // ---- Enter copies the callback URL -------------------------------------
  // The button is autofocused in the markup, so Enter already activates it natively on arrival — this
  // covers AFTER focus has moved: selecting the URL text to read it, opening the "just the code"
  // disclosure, tabbing past. On a screen whose only purpose is "copy this and go back to your
  // terminal", Enter should mean copy wherever you happen to be standing.
  //
  // It fires only when Enter would otherwise do NOTHING: if the target is a control that has its own
  // Enter behaviour (a button, a link, the disclosure summary, a field), that behaviour wins — so
  // Enter on "Open it in this browser" still opens, and Enter on the focused Copy URL button copies
  // once, not twice.
  var primaryCopy = document.getElementById('sw-copy-url');
  if(primaryCopy){
    document.addEventListener('keydown', function(e){
      if(e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      if(t && t !== document && t !== document.body && t.closest &&
         t.closest('button, a, summary, input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      primaryCopy.click();
    });
  }
})();`;
