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

  // ---- copy the authorization code --------------------------------------
  var copyBtn = document.getElementById('sw-copy');
  if(copyBtn){
    copyBtn.addEventListener('click', function(){
      var el = document.getElementById('sw-code');
      var value = el ? (el.textContent || '') : '';
      if(!value) return;
      var ok = function(){ toast('Code copied to clipboard'); };
      // navigator.clipboard needs a secure context; an instance reached over plain HTTP on a LAN has
      // none, so fall back to a hidden textarea + execCommand rather than silently doing nothing.
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
  }
})();`;
