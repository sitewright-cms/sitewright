// --- Banner ------------------------------------------------------------------
// A free-content, dismissible banner/announcement (marketing banners, promos, "see our
// latest product"). NOT the cookie/consent banner — that's the auto-injected Consent
// Manager (`data-sw-consent`). Here the AUTHOR writes the content and the action buttons;
// the runtime only handles reveal + remembered dismissal.
//
// PE-safe: rendered with the `hidden` attribute, so with no JS there is no banner (and
// nothing to dismiss). All Web-Storage access is try/catch-guarded (sandboxed preview /
// disabled storage). Styling keys on `data-sw-component="banner"` (the marker every banner
// already carries for the JS + asset scan) — no parallel `data-sw-block` needed.
//
// Multiple banners coexist: each one tracks its dismissal under its OWN
// `sw-banner:<data-sw-banner-id>` localStorage key, so giving each a unique id keeps them
// independent. Drop a banner site-wide (a chrome slot) OR in a single page body (per-page).

// Backgrounds read the `--sw-color-*` tokens so the surface flips in dark mode (the
// dark-readiness lint guards this). Positioned via the `data-position` attribute switch.
export const BANNER_CSS = [
  '[data-sw-component="banner"][hidden]{display:none}',
  // Shell (EVERY banner): placement context, layout, surface. The opacity/transform reveal is split out
  // below so an author's `data-aos` can own the entrance instead of fighting it.
  '[data-sw-component="banner"]{position:fixed;z-index:9997;right:1rem;bottom:1rem;max-width:min(28rem,calc(100vw - 2rem));display:flex;flex-wrap:wrap;align-items:center;gap:.75rem 1rem;padding:1rem 1.25rem;background:var(--sw-color-base-100,#fff);color:var(--sw-color-base-content,#1a1a23);border:1px solid color-mix(in oklab,var(--sw-color-base-content,#000) 12%,transparent);border-radius:.6rem;box-shadow:0 8px 28px rgba(0,0,0,.18)}',
  // Built-in fade+rise reveal — applied ONLY when the author did NOT supply a data-aos effect (then the
  // shared AOS runtime drives the entrance, and these would conflict).
  '[data-sw-component="banner"]:not([data-aos]){opacity:0;transform:translateY(10px);transition:opacity .28s ease,transform .28s ease}',
  '[data-sw-component="banner"]:not([data-aos])[data-sw-banner-shown]{opacity:1;transform:none}',
  '[data-sw-component="banner"] p{margin:0;flex:1;min-width:12rem;font-size:.9rem;line-height:1.5}',
  // Placement variants. Each resets the offsets the others set, so switching is total.
  '[data-sw-component="banner"][data-position="bottom"]{left:1rem;right:1rem;bottom:1rem;top:auto;max-width:none}',
  '[data-sw-component="banner"][data-position="top"]{left:1rem;right:1rem;top:1rem;bottom:auto;max-width:none}',
  '[data-sw-component="banner"][data-position="bottom-right"]{right:1rem;bottom:1rem;left:auto;top:auto}',
  '[data-sw-component="banner"][data-position="bottom-left"]{left:1rem;bottom:1rem;right:auto;top:auto}',
  '[data-sw-component="banner"][data-position="top-right"]{right:1rem;top:1rem;left:auto;bottom:auto}',
  '[data-sw-component="banner"][data-position="top-left"]{left:1rem;top:1rem;right:auto;bottom:auto}',
  // Center: transform-FREE centering (inset:0 + margin:auto + fit-content), so the built-in rise AND any
  // data-aos transform effect are free to animate the entrance without fighting the centering offset.
  '[data-sw-component="banner"][data-position="center"]{inset:0;margin:auto;width:-moz-fit-content;width:fit-content;height:-moz-fit-content;height:fit-content;max-width:min(32rem,calc(100vw - 2rem))}',
  // Inline: sits in the page flow; the built-in reveal is fade-ONLY (no rise) so it does not nudge the layout.
  '[data-sw-component="banner"][data-position="inline"]{position:static;max-width:none}',
  '[data-sw-component="banner"][data-position="inline"]:not([data-aos]){transform:none}',
  '@media (prefers-reduced-motion:reduce){[data-sw-component="banner"]{transition:none}}',
].join('');

// ES5-style (var / function) — served raw, never transpiled, like the other component bundles.
//
// Dismissal is remembered in localStorage under `sw-banner:<id>` as a small record:
//   {d:<dismissedAt ms>, sid?:<session id>, p?:1 (permanent), r?:<remind days>}
// `data-frequency` decides when a PLAIN dismiss expires:
//   once (default) → permanent · session → until the browser session ends · days:N →
//   reappears after N days · always → never persisted (shows on every load until dismissed).
// The parts: dismiss (the configured frequency), dismiss-forever ("don't show again",
// always permanent), remind (snooze for data-remind-days, default 1). `data-delay` shows
// after N ms or on the first `scroll`. Multiple banners each use their own id-keyed record.
//
// ENTRANCE: by default a banner fades+rises in. Add a `data-aos` effect (fade-up / zoom-in /
// flip-left / …, plus data-aos-delay/-duration/-easing) and the banner yields the entrance to the
// shared AOS runtime instead — the dismiss reverses whichever entrance was used.
export const BANNER_JS = `(function(){
  var DAY=864e5;
  var SID=(function(){try{var k='sw-banner-sid';var v=sessionStorage.getItem(k);if(!v){v=String(+new Date())+'.'+Math.random();sessionStorage.setItem(k,v);}return v;}catch(e){return '';}})();
  function read(key){try{var raw=localStorage.getItem(key);if(!raw)return null;var o=JSON.parse(raw);return (o&&typeof o==='object'&&!(o instanceof Array))?o:null;}catch(e){return null;}}
  function write(key,rec){try{localStorage.setItem(key,JSON.stringify(rec));}catch(e){}}
  // data-aos timing applied to the banner itself (the AOS runtime skips banners). Mirrors AOS: delay +
  // duration parseInt-clamped to [0,5000]ms; easing resolved through a fixed allowlist (a null-proto map,
  // so a hostile key can't reach an Object.prototype member) — values can never inject style.
  var EASE=(function(){var m=Object.create(null);m['linear']='linear';m['ease']='ease';m['ease-in']='ease-in';m['ease-out']='ease-out';m['ease-in-out']='ease-in-out';return m;})();
  function clampMs(v){var n=parseInt(v||'',10);return isNaN(n)?0:Math.max(0,Math.min(n,5000));}
  function applyAos(root){
    var d=clampMs(root.getAttribute('data-aos-delay'));if(d)root.style.transitionDelay=d+'ms';
    var u=clampMs(root.getAttribute('data-aos-duration'));if(u)root.style.transitionDuration=u+'ms';
    var e=EASE[root.getAttribute('data-aos-easing')||''];if(e)root.style.transitionTimingFunction=e;
  }
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
    var aos=root.getAttribute('data-aos');
    var raf=window.requestAnimationFrame||function(cb){setTimeout(cb,16);};
    var run=function(){
      // A data-aos banner uses the AOS effect classes for its ENTRANCE: apply 'aos-init' (the hidden
      // state) BEFORE un-hiding so there is no flash, then drive 'aos-animate' on the next frame. The reveal
      // (not a scroll) is the trigger, so the banner owns these classes + the data-aos-* timing itself. A
      // plain banner uses the built-in fade via [data-sw-banner-shown].
      if(aos){applyAos(root);root.classList.add('aos-init');}
      root.removeAttribute('hidden');
      // Double-rAF for the AOS path (matching the AOS library) so the aos-init state is guaranteed painted
      // before aos-animate, so the transition always runs; the plain path keeps its single-rAF reveal.
      if(aos)raf(function(){raf(function(){root.classList.add('aos-animate');});});
      else raf(function(){root.setAttribute('data-sw-banner-shown','');});
    };
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
    // EXIT mirrors the entrance: a data-aos banner reverses its effect (drop 'aos-animate' → back to the
    // 'aos-init' transform/opacity); a plain banner drops the shown flag (fade/rise out). Hide once the
    // transition completes (the AOS duration, default 600ms, vs the built-in .28s).
    var aos=root.getAttribute('data-aos');
    var hideIn=300;
    if(aos){
      root.style.transitionDelay='0ms'; // clear the entrance stagger (sticky inline style) so the exit reversal starts NOW, not after data-aos-delay
      root.classList.remove('aos-animate');
      var d=clampMs(root.getAttribute('data-aos-duration'));
      hideIn=Math.min((d>0?d:600)+60,5100);
    }else{
      root.removeAttribute('data-sw-banner-shown');
    }
    setTimeout(function(){root.setAttribute('hidden','');},hideIn);
  }
  function enhance(root){
    if(root.getAttribute('data-sw-enhanced')==='true')return;root.setAttribute('data-sw-enhanced','true');
    if(!root.getAttribute('data-position'))root.setAttribute('data-position','bottom-right');
    if(root.getAttribute('data-aos')==='')root.removeAttribute('data-aos'); // empty effect → plain reveal (CSS :not([data-aos]) must match)
    var key='sw-banner:'+(root.getAttribute('data-sw-banner-id')||'default');
    function wire(sel,mode){Array.prototype.forEach.call(root.querySelectorAll(sel),function(b){b.addEventListener('click',function(e){if(b.tagName==='A'&&!b.getAttribute('href'))e.preventDefault();dismiss(root,key,mode);});});}
    wire('[data-sw-part="dismiss"]','');
    wire('[data-sw-part="dismiss-forever"]','forever');
    wire('[data-sw-part="remind"]','remind');
    if(shouldShow(root,key))reveal(root);
  }
  function init(){Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="banner"]'),enhance);}
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;
