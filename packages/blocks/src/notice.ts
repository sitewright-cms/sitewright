// --- Notice ------------------------------------------------------------------
// A free-content, dismissible banner/announcement (marketing notices, promos, "see our
// latest product"). The generic sibling of CookieConsent: the AUTHOR writes the content
// and the action buttons; the runtime only handles reveal + remembered dismissal.
//
// PE-safe: rendered with the `hidden` attribute, so with no JS there is no banner (and
// nothing to dismiss). All Web-Storage access is try/catch-guarded (sandboxed preview /
// disabled storage). Styling keys on `data-sw-component="notice"` (the marker every notice
// already carries for the JS + asset scan) — no parallel `data-sw-block` needed.
//
// Multiple notices coexist: each one tracks its dismissal under its OWN
// `sw-notice:<data-sw-notice-id>` localStorage key, so giving each a unique id keeps them
// independent. Drop a notice site-wide (a chrome slot) OR in a single page body (per-page).

// Backgrounds read the `--sw-color-*` tokens so the surface flips in dark mode (the
// dark-readiness lint guards this). Positioned via the `data-position` attribute switch.
export const NOTICE_CSS = [
  '[data-sw-component="notice"][hidden]{display:none}',
  '[data-sw-component="notice"]{position:fixed;z-index:9997;right:1rem;bottom:1rem;max-width:min(28rem,calc(100vw - 2rem));display:flex;flex-wrap:wrap;align-items:center;gap:.75rem 1rem;padding:1rem 1.25rem;background:var(--sw-color-base-100,#fff);color:var(--sw-color-base-content,#1a1a23);border:1px solid color-mix(in oklab,var(--sw-color-base-content,#000) 12%,transparent);border-radius:.6rem;box-shadow:0 8px 28px rgba(0,0,0,.18);opacity:0;transform:translateY(10px);transition:opacity .28s ease,transform .28s ease}',
  '[data-sw-component="notice"][data-sw-notice-shown]{opacity:1;transform:none}',
  '[data-sw-component="notice"] p{margin:0;flex:1;min-width:12rem;font-size:.9rem;line-height:1.5}',
  // Placement variants. Each resets the offsets the others set, so switching is total.
  '[data-sw-component="notice"][data-position="bottom"]{left:1rem;right:1rem;bottom:1rem;top:auto;max-width:none}',
  '[data-sw-component="notice"][data-position="top"]{left:1rem;right:1rem;top:1rem;bottom:auto;max-width:none}',
  '[data-sw-component="notice"][data-position="bottom-right"]{right:1rem;bottom:1rem;left:auto;top:auto}',
  '[data-sw-component="notice"][data-position="bottom-left"]{left:1rem;bottom:1rem;right:auto;top:auto}',
  '[data-sw-component="notice"][data-position="top-right"]{right:1rem;top:1rem;left:auto;bottom:auto}',
  '[data-sw-component="notice"][data-position="top-left"]{left:1rem;top:1rem;right:auto;bottom:auto}',
  '[data-sw-component="notice"][data-position="center"]{left:50%;top:50%;right:auto;bottom:auto;max-width:min(32rem,calc(100vw - 2rem));transform:translate(-50%,-50%) translateY(10px)}',
  '[data-sw-component="notice"][data-position="center"][data-sw-notice-shown]{transform:translate(-50%,-50%)}',
  '[data-sw-component="notice"][data-position="inline"]{position:static;max-width:none;opacity:1;transform:none}',
  '@media (prefers-reduced-motion:reduce){[data-sw-component="notice"]{transition:none}}',
].join('');

// ES5-style (var / function) — served raw, never transpiled, like the other component bundles.
//
// Dismissal is remembered in localStorage under `sw-notice:<id>` as a small record:
//   {d:<dismissedAt ms>, sid?:<session id>, p?:1 (permanent), r?:<remind days>}
// `data-frequency` decides when a PLAIN dismiss expires:
//   once (default) → permanent · session → until the browser session ends · days:N →
//   reappears after N days · always → never persisted (shows on every load until dismissed).
// The parts: dismiss (the configured frequency), dismiss-forever ("don't show again",
// always permanent), remind (snooze for data-remind-days, default 1). `data-delay` shows
// after N ms or on the first `scroll`. Multiple notices each use their own id-keyed record.
export const NOTICE_JS = `(function(){
  var DAY=864e5;
  var SID=(function(){try{var k='sw-notice-sid';var v=sessionStorage.getItem(k);if(!v){v=String(+new Date())+'.'+Math.random();sessionStorage.setItem(k,v);}return v;}catch(e){return '';}})();
  function read(key){try{var raw=localStorage.getItem(key);if(!raw)return null;var o=JSON.parse(raw);return (o&&typeof o==='object'&&!(o instanceof Array))?o:null;}catch(e){return null;}}
  function write(key,rec){try{localStorage.setItem(key,JSON.stringify(rec));}catch(e){}}
  function freqOf(root){return (root.getAttribute('data-frequency')||'once').toLowerCase();}
  function shouldShow(root,key){
    var rec=read(key);
    if(rec&&rec.p)return false;             // "don't show again" wins regardless of frequency
    var f=freqOf(root);
    if(f==='always')return true;            // no memory: show on every load until dismissed
    if(!rec)return true;
    var now=+new Date();
    if(rec.r)return (now-(rec.d||0))>=rec.r*DAY;
    if(f.indexOf('days:')===0){var dn=parseInt(f.slice(5),10);var n=(isFinite(dn)&&dn>0)?dn:1;return (now-(rec.d||0))>=n*DAY;}
    if(f==='session')return rec.sid!==SID;
    return false;
  }
  function reveal(root){
    var run=function(){root.removeAttribute('hidden');(window.requestAnimationFrame||function(cb){setTimeout(cb,16);})(function(){root.setAttribute('data-sw-notice-shown','');});};
    var delay=root.getAttribute('data-delay');
    if(delay==='scroll'){var onScroll=function(){window.removeEventListener('scroll',onScroll);run();};window.addEventListener('scroll',onScroll);}
    else if(delay&&/^[0-9]+$/.test(delay)){setTimeout(run,Math.min(parseInt(delay,10),30000));}
    else{run();}
  }
  function dismiss(root,key,mode){
    var now=+new Date();
    // forever + remind are EXPLICIT suppressions → always remembered; a plain dismiss follows the
    // frequency (and 'always' keeps no memory of a plain dismiss, so it returns next load).
    if(mode==='forever'){write(key,{d:now,p:1});}
    else if(mode==='remind'){var rd=parseInt(root.getAttribute('data-remind-days'),10);write(key,{d:now,r:(rd>0?rd:1)});}
    else if(freqOf(root)!=='always'){write(key,{d:now,sid:SID});}
    root.removeAttribute('data-sw-notice-shown');
    setTimeout(function(){root.setAttribute('hidden','');},300); // > the .28s fade so it completes before display:none

  }
  function enhance(root){
    if(root.getAttribute('data-sw-enhanced')==='true')return;root.setAttribute('data-sw-enhanced','true');
    if(!root.getAttribute('data-position'))root.setAttribute('data-position','bottom-right');
    var key='sw-notice:'+(root.getAttribute('data-sw-notice-id')||'default');
    function wire(sel,mode){Array.prototype.forEach.call(root.querySelectorAll(sel),function(b){b.addEventListener('click',function(e){if(b.tagName==='A'&&!b.getAttribute('href'))e.preventDefault();dismiss(root,key,mode);});});}
    wire('[data-sw-part="dismiss"]','');
    wire('[data-sw-part="dismiss-forever"]','forever');
    wire('[data-sw-part="remind"]','remind');
    if(shouldShow(root,key))reveal(root);
  }
  function init(){Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="notice"]'),enhance);}
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;
