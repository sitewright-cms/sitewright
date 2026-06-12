// Platform-authored, dependency-free behavior + styling for INTERACTIVE component
// blocks (the "Components" palette: Carousel, and future Modal/Lightbox/etc.).
//
// These are NOT tenant code — they are first-party, audited, static assets shipped
// only when the matching block is used (the same "only-used-ships" discipline as
// icons.ts / brand-icons.ts / the Tailwind sheet). The tenant supplies only DATA
// (slides, captions) through typed block props; never JavaScript. This keeps the
// "no per-tenant code execution" invariant intact: the JS below is bundled to a
// `components.js` served from the site's own origin (CSP `default-src 'self'`),
// and runs on the published/exported site. The editor's sandboxed live-preview
// shows the progressive-enhancement fallback (no script) — components degrade to
// usable semantic HTML (a scroll-snap carousel still swipes/scrolls) without JS.
/** A component's static styling + behavior (either may be empty). */
export interface ComponentAsset {
  css: string;
  js: string;
}

// --- Carousel -------------------------------------------------------------
// PE-first: the track is a CSS scroll-snap row (swipeable with no JS). Arrows +
// dots are hidden until JS marks the root `data-sw-enhanced`, so the no-JS
// fallback never shows inert controls. Respects prefers-reduced-motion.
const CAROUSEL_CSS = [
  '[data-sw-block="Carousel"]{position:relative}',
  // `scrollbar-width:none` hides it in Firefox (the base layer otherwise gives every
  // element `scrollbar-width:thin`); the ::-webkit rule hides it in Chrome/Safari.
  '[data-sw-block="Carousel"] [data-sw-part="track"]{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;-webkit-overflow-scrolling:touch;scrollbar-width:none}',
  '[data-sw-block="Carousel"] [data-sw-part="track"]::-webkit-scrollbar{display:none}',
  '[data-sw-block="Carousel"] [data-sw-part="slide"]{flex:0 0 100%;scroll-snap-align:start;min-width:0}',
  '[data-sw-block="Carousel"] [data-sw-part="slide"] img{display:block;width:100%;height:auto}',
  '[data-sw-block="Carousel"] [data-sw-part="prev"],[data-sw-block="Carousel"] [data-sw-part="next"],[data-sw-block="Carousel"] [data-sw-part="dots"]{display:none}',
  '[data-sw-block="Carousel"][data-sw-enhanced="true"] [data-sw-part="prev"],[data-sw-block="Carousel"][data-sw-enhanced="true"] [data-sw-part="next"]{display:flex;align-items:center;justify-content:center;position:absolute;top:50%;transform:translateY(-50%);width:2.5rem;height:2.5rem;border:0;border-radius:9999px;background:rgba(0,0,0,.5);color:#fff;cursor:pointer;font-size:1.25rem;line-height:1}',
  '[data-sw-block="Carousel"][data-sw-enhanced="true"] [data-sw-part="prev"]{left:.5rem}',
  '[data-sw-block="Carousel"][data-sw-enhanced="true"] [data-sw-part="next"]{right:.5rem}',
  '[data-sw-block="Carousel"][data-sw-enhanced="true"] [data-sw-part="dots"]{display:flex;justify-content:center;gap:.5rem;padding:.75rem 0}',
  '[data-sw-block="Carousel"] [data-sw-part="dots"] button{width:.6rem;height:.6rem;border-radius:9999px;border:0;background:currentColor;opacity:.35;cursor:pointer;padding:0}',
  '[data-sw-block="Carousel"] [data-sw-part="dots"] button[aria-current="true"]{opacity:1}',
  '@media (prefers-reduced-motion: reduce){[data-sw-block="Carousel"] [data-sw-part="track"]{scroll-behavior:auto}}',
].join('');

// Dependency-free enhancement. Finds every carousel, wires arrows/dots/keyboard/
// autoplay, keeps the active dot in sync with manual scroll, and pauses autoplay
// on hover/focus and under reduced-motion.
const CAROUSEL_JS = `(function(){
  function enhance(root){
    var track=root.querySelector('[data-sw-part="track"]');
    if(!track)return;
    var slides=Array.prototype.slice.call(track.querySelectorAll('[data-sw-part="slide"]'));
    if(slides.length<2)return;
    var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var loop=root.getAttribute('data-loop')==='true';
    var index=0;
    function clamp(i){return loop?(i+slides.length)%slides.length:Math.max(0,Math.min(slides.length-1,i));}
    function go(i){var n=clamp(i);if(n===index&&!loop){return;}index=n;slides[index].scrollIntoView({behavior:reduce?'auto':'smooth',inline:'start',block:'nearest'});sync();}
    var dotsWrap=root.querySelector('[data-sw-part="dots"]');
    var dots=[];
    if(dotsWrap){dotsWrap.removeAttribute('aria-hidden');slides.forEach(function(_,i){var b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Go to slide '+(i+1));b.addEventListener('click',function(){go(i);});dotsWrap.appendChild(b);dots.push(b);});}
    function sync(){for(var i=0;i<dots.length;i++){dots[i].setAttribute('aria-current',i===index?'true':'false');}}
    var prev=root.querySelector('[data-sw-part="prev"]');
    var next=root.querySelector('[data-sw-part="next"]');
    if(prev)prev.addEventListener('click',function(){go(index-1);});
    if(next)next.addEventListener('click',function(){go(index+1);});
    root.addEventListener('keydown',function(e){if(e.key==='ArrowLeft'){go(index-1);}else if(e.key==='ArrowRight'){go(index+1);}});
    var st;
    track.addEventListener('scroll',function(){clearTimeout(st);st=setTimeout(function(){var min=Infinity,mi=0,tl=track.getBoundingClientRect().left;slides.forEach(function(s,i){var d=Math.abs(s.getBoundingClientRect().left-tl);if(d<min){min=d;mi=i;}});index=mi;sync();},100);},{passive:true});
    var auto=root.getAttribute('data-autoplay')==='true';
    var interval=parseInt(root.getAttribute('data-interval'),10)||5000;
    var timer=null;
    function play(){stop();if(auto&&!reduce){timer=setInterval(function(){go(index+1);},interval);}}
    function stop(){if(timer){clearInterval(timer);timer=null;}}
    root.addEventListener('mouseenter',stop);root.addEventListener('mouseleave',play);
    root.addEventListener('focusin',function(e){if(!root.contains(e.relatedTarget)){stop();}});
    root.addEventListener('focusout',function(e){if(!root.contains(e.relatedTarget)){play();}});
    root.setAttribute('data-sw-enhanced','true');
    sync();play();
  }
  function init(){Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="carousel"]'),enhance);}
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;

// --- Accordion --------------------------------------------------------------
// ZERO JavaScript: built on native <details>/<summary>, so it is fully
// interactive everywhere — including the editor's sandboxed (script-free)
// preview. The registry entry contributes styling only.
const ACCORDION_CSS = [
  '[data-sw-block="Accordion"]{display:block}',
  '[data-sw-block="AccordionItem"]{border:1px solid rgba(0,0,0,.12);border-radius:.375rem;margin-bottom:.5rem;overflow:hidden}',
  '[data-sw-block="AccordionItem"]>summary{cursor:pointer;padding:.75rem 1rem;font-weight:600;list-style:none;display:flex;justify-content:space-between;align-items:center}',
  '[data-sw-block="AccordionItem"]>summary::-webkit-details-marker{display:none}',
  '[data-sw-block="AccordionItem"]>summary::after{content:"+";font-weight:400;margin-left:1rem}',
  '[data-sw-block="AccordionItem"][open]>summary::after{content:"\\2013"}',
  '[data-sw-block="AccordionItem"] [data-sw-part="content"]{padding:0 1rem 1rem}',
].join('');

// --- Lightbox ----------------------------------------------------------------
// A thumbnail grid that opens a full-screen overlay. PE-first: each item is an
// anchor to the full image, so with no JS clicking simply opens the image. The
// overlay is hidden until JS marks the root enhanced.
const LIGHTBOX_CSS = [
  '[data-sw-block="Lightbox"]{display:block}',
  '[data-sw-block="Lightbox"] [data-sw-part="grid"]{display:grid;grid-template-columns:repeat(auto-fill,minmax(8rem,1fr));gap:.5rem}',
  '[data-sw-block="Lightbox"] [data-sw-part="item"]{display:block}',
  '[data-sw-block="Lightbox"] [data-sw-part="item"] img{display:block;width:100%;height:100%;object-fit:cover;aspect-ratio:1}',
  '[data-sw-block="Lightbox"] [data-sw-part="overlay"]{display:none}',
  '[data-sw-block="Lightbox"][data-sw-enhanced="true"] [data-sw-part="overlay"][data-open="true"]{display:flex;position:fixed;inset:0;z-index:9999;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.92)}',
  '[data-sw-block="Lightbox"] [data-sw-part="overlay"] img{max-width:90vw;max-height:80vh;object-fit:contain}',
  '[data-sw-block="Lightbox"] [data-sw-part="overlay"] figcaption{color:#fff;padding:.5rem 1rem;text-align:center}',
  '[data-sw-block="Lightbox"] [data-sw-part="overlay"] button{position:absolute;background:none;border:0;color:#fff;font-size:2.5rem;line-height:1;cursor:pointer;padding:.5rem}',
  '[data-sw-block="Lightbox"] [data-sw-part="overlay"] [data-sw-part="close"]{top:.5rem;right:1rem}',
  '[data-sw-block="Lightbox"] [data-sw-part="overlay"] [data-sw-part="lb-prev"]{left:.5rem;top:50%;transform:translateY(-50%)}',
  '[data-sw-block="Lightbox"] [data-sw-part="overlay"] [data-sw-part="lb-next"]{right:.5rem;top:50%;transform:translateY(-50%)}',
].join('');

// Dependency-free. Builds the overlay via the DOM (no innerHTML beyond a one-time
// clear) and shows the full image from each item's own href + data-caption.
// Focus moves into the overlay on open and returns to the trigger on close;
// Escape / arrow keys are handled while open.
const LIGHTBOX_JS = `(function(){
  function enhance(root){
    var items=Array.prototype.slice.call(root.querySelectorAll('[data-sw-part="item"]'));
    var overlay=root.querySelector('[data-sw-part="overlay"]');
    if(!items.length||!overlay)return;
    var idx=0,lastFocus=null;
    function mkBtn(part,label,txt){var b=document.createElement('button');b.type='button';b.setAttribute('data-sw-part',part);b.setAttribute('aria-label',label);b.textContent=txt;return b;}
    overlay.innerHTML='';
    overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Image viewer');
    var btnClose=mkBtn('close','Close','\\u00d7'),btnPrev=mkBtn('lb-prev','Previous','\\u2039'),btnNext=mkBtn('lb-next','Next','\\u203a');
    var img=document.createElement('img'),cap=document.createElement('figcaption');
    overlay.appendChild(btnClose);overlay.appendChild(btnPrev);overlay.appendChild(img);overlay.appendChild(cap);overlay.appendChild(btnNext);
    if(items.length<2){btnPrev.style.display='none';btnNext.style.display='none';}
    function show(i){
      idx=(i+items.length)%items.length;var a=items[idx],thumb=a.querySelector('img');
      img.setAttribute('src',a.getAttribute('href'));img.setAttribute('alt',thumb?thumb.getAttribute('alt')||'':'');
      var c=a.getAttribute('data-caption')||'';cap.textContent=c;cap.style.display=c?'block':'none';
      overlay.setAttribute('data-open','true');overlay.removeAttribute('aria-hidden');btnClose.focus();
    }
    function close(){overlay.removeAttribute('data-open');overlay.setAttribute('aria-hidden','true');if(lastFocus){lastFocus.focus();}}
    items.forEach(function(a,i){a.addEventListener('click',function(e){e.preventDefault();lastFocus=a;show(i);});});
    btnClose.addEventListener('click',close);
    btnPrev.addEventListener('click',function(){show(idx-1);});
    btnNext.addEventListener('click',function(){show(idx+1);});
    overlay.addEventListener('click',function(e){if(e.target===overlay){close();}});
    document.addEventListener('keydown',function(e){if(overlay.getAttribute('data-open')!=='true')return;if(e.key==='Escape'){close();}else if(e.key==='ArrowLeft'){show(idx-1);}else if(e.key==='ArrowRight'){show(idx+1);}else if(e.key==='Tab'){var f=[btnClose,btnPrev,btnNext].filter(function(b){return b.style.display!=='none';}),first=f[0],last=f[f.length-1];if(e.shiftKey){if(document.activeElement===first){e.preventDefault();last.focus();}}else if(document.activeElement===last){e.preventDefault();first.focus();}}});
    root.setAttribute('data-sw-enhanced','true');
  }
  function init(){Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="lightbox"]'),enhance);}
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;

// --- Modal -------------------------------------------------------------------
// A trigger button that opens a native <dialog> (which provides focus trap,
// Escape, ::backdrop, and background inerting for free). JS only wires open/close.
const MODAL_CSS = [
  '[data-sw-block="Modal"]{display:inline-block}',
  '[data-sw-block="Modal"] dialog{position:relative;border:0;border-radius:.5rem;padding:1.5rem;max-width:min(90vw,32rem);box-shadow:0 10px 40px rgba(0,0,0,.2)}',
  '[data-sw-block="Modal"] dialog::backdrop{background:rgba(0,0,0,.5)}',
  '[data-sw-block="Modal"] [data-sw-part="close"]{position:absolute;top:.5rem;right:.75rem;border:0;background:none;font-size:1.5rem;line-height:1;cursor:pointer}',
].join('');

const MODAL_JS = `(function(){
  function enhance(root){
    var dialog=root.querySelector('[data-sw-part="dialog"]'),openBtn=root.querySelector('[data-sw-part="open"]');
    if(!dialog||!openBtn||typeof dialog.showModal!=='function')return;
    var closeBtn=root.querySelector('[data-sw-part="close"]');
    openBtn.addEventListener('click',function(){dialog.showModal();});
    if(closeBtn)closeBtn.addEventListener('click',function(){dialog.close();});
    dialog.addEventListener('click',function(e){if(e.target===dialog){dialog.close();}});
  }
  function init(){Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="modal"]'),enhance);}
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;

// --- CookieConsent -----------------------------------------------------------
// A dismissable banner, hidden until JS confirms consent isn't yet stored. PE-safe:
// rendered with the `hidden` attribute, so with no JS there is no banner (and no
// JS means nothing to consent to). localStorage access is guarded (sandboxed
// preview / disabled storage).
const COOKIE_CONSENT_CSS = [
  '[data-sw-block="CookieConsent"][hidden]{display:none}',
  '[data-sw-block="CookieConsent"]{position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:9998;display:flex;flex-wrap:wrap;align-items:center;gap:1rem;padding:1rem 1.25rem;background:#fff;border:1px solid rgba(0,0,0,.12);border-radius:.5rem;box-shadow:0 6px 24px rgba(0,0,0,.15)}',
  '[data-sw-block="CookieConsent"] p{margin:0;flex:1;min-width:12rem;font-size:.875rem}',
  '[data-sw-block="CookieConsent"] [data-sw-part="accept"]{border:0;border-radius:.375rem;padding:.5rem 1rem;background:var(--sw-color-primary,#0a7a5a);color:#fff;cursor:pointer}',
].join('');

// State is carried by the \`hidden\` attribute (already in the server HTML and
// toggled here) rather than a \`data-sw-enhanced\` marker — no separate flag needed.
const COOKIE_CONSENT_JS = `(function(){
  var KEY='sw-cookie-consent';
  function enhance(root){
    try{if(localStorage.getItem(KEY)==='1'){return;}}catch(e){}
    root.removeAttribute('hidden');
    var accept=root.querySelector('[data-sw-part="accept"]');
    if(accept)accept.addEventListener('click',function(){try{localStorage.setItem(KEY,'1');}catch(e){}root.setAttribute('hidden','');});
  }
  function init(){Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="cookie-consent"]'),enhance);}
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;

// --- Tabs --------------------------------------------------------------------
// A tablist + panels (APG Tabs pattern). The JS builds the tablist from each
// panel's title, wires roving-tabindex + arrow-key navigation + aria, and shows
// one panel at a time. PE-first: with no JS the tablist stays hidden and ALL
// panels render stacked (fully readable content).
const TABS_CSS = [
  '[data-sw-block="Tabs"] [data-sw-part="tablist"]{display:none}',
  '[data-sw-block="Tabs"][data-sw-enhanced="true"] [data-sw-part="tablist"]{display:flex;flex-wrap:wrap;gap:.25rem;border-bottom:1px solid rgba(0,0,0,.12);margin-bottom:1rem}',
  '[data-sw-block="Tabs"] [data-sw-part="tab"]{border:0;background:none;padding:.5rem 1rem;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}',
  '[data-sw-block="Tabs"] [data-sw-part="tab"][aria-selected="true"]{border-bottom-color:var(--sw-color-primary,#0a7a5a);font-weight:600}',
  '[data-sw-block="Tabs"][data-sw-enhanced="true"] [data-sw-part="panel"]:not([data-active]){display:none}',
].join('');

const TABS_JS = `(function(){
  var uid=0;
  function enhance(root){
    var panels=Array.prototype.slice.call(root.querySelectorAll('[data-sw-part="panel"]'));
    var tablist=root.querySelector('[data-sw-part="tablist"]');
    if(!tablist||panels.length<2)return;
    var gid='sw-tabs-'+(uid++),tabs=[];
    function select(i){
      for(var j=0;j<panels.length;j++){
        var on=j===i;
        if(on){panels[j].setAttribute('data-active','');}else{panels[j].removeAttribute('data-active');}
        tabs[j].setAttribute('aria-selected',on?'true':'false');tabs[j].tabIndex=on?0:-1;
      }
    }
    panels.forEach(function(panel,i){
      var pid=gid+'-p'+i,tid=gid+'-t'+i;
      panel.id=pid;panel.setAttribute('aria-labelledby',tid);
      var btn=document.createElement('button');
      btn.type='button';btn.id=tid;btn.setAttribute('role','tab');btn.setAttribute('data-sw-part','tab');btn.setAttribute('aria-controls',pid);
      btn.textContent=panel.getAttribute('data-sw-title')||('Tab '+(i+1));
      btn.addEventListener('click',function(){select(i);tabs[i].focus();});
      btn.addEventListener('keydown',function(e){var n=-1;if(e.key==='ArrowRight'){n=(i+1)%tabs.length;}else if(e.key==='ArrowLeft'){n=(i-1+tabs.length)%tabs.length;}else if(e.key==='Home'){n=0;}else if(e.key==='End'){n=tabs.length-1;}if(n>=0){e.preventDefault();select(n);tabs[n].focus();}});
      tablist.appendChild(btn);tabs.push(btn);
    });
    root.setAttribute('data-sw-enhanced','true');
    select(0);
  }
  function init(){Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="tabs"]'),enhance);}
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;

// --- Form --------------------------------------------------------------------
// A web form with NO `action=` attribute — submission is JS-only. The handler
// posts the fields as JSON to `data-sw-endpoint` (the Sitewright platform), adds
// a time-trap (`_elapsed` ms since load) the server uses to reject instant bot
// posts, then shows the inline success/error message or follows `data-sw-redirect`.
// PE note: with no JS the form simply cannot submit (no action), by design.
const FORM_CSS = [
  '[data-sw-block="Form"] [data-sw-part="field"]{display:block;margin-bottom:1rem}',
  '[data-sw-block="Form"] [data-sw-part="label"]{display:block;margin-bottom:.25rem;font-size:.875rem}',
  '[data-sw-block="Form"] input,[data-sw-block="Form"] textarea,[data-sw-block="Form"] select{width:100%;padding:.5rem .625rem;border:1px solid rgba(0,0,0,.2);border-radius:.375rem;font:inherit}',
  '[data-sw-block="Form"] [data-sw-part="submit"]{border:0;border-radius:.375rem;padding:.5rem 1.25rem;background:var(--sw-color-primary,#0a7a5a);color:#fff;cursor:pointer}',
  '[data-sw-block="Form"] [data-sw-part="submit"][disabled]{opacity:.6;cursor:progress}',
  // Honeypot: take it out of the layout + the a11y tree, off-screen (not display:none,
  // which some bots skip). Real users never see or tab to it.
  '[data-sw-block="Form"] [data-sw-part="hp"]{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}',
  '[data-sw-block="Form"] [data-sw-part="success"]{color:#0a7a5a;margin-top:.75rem}',
  '[data-sw-block="Form"] [data-sw-part="error"]{color:#b00020;margin-top:.75rem}',
].join('');

const FORM_JS = `(function(){
  function ensureHcaptcha(){
    if(!document.querySelector('.h-captcha'))return;
    if(window.hcaptcha)return;
    if(document.querySelector('script[data-sw-hcaptcha]'))return;
    var s=document.createElement('script');
    s.src='https://js.hcaptcha.com/1/api.js';s.async=true;s.defer=true;
    s.setAttribute('data-sw-hcaptcha','');
    document.head.appendChild(s);
  }
  function enhance(form){
    var endpoint=form.getAttribute('data-sw-endpoint');
    if(!endpoint)return;
    var started=Date.now();
    var success=form.querySelector('[data-sw-part="success"]');
    var error=form.querySelector('[data-sw-part="error"]');
    var submit=form.querySelector('[data-sw-part="submit"]');
    form.addEventListener('submit',function(e){
      e.preventDefault();
      if(error)error.hidden=true;
      // If this form has an hCaptcha that hasn't been solved yet, prompt instead of
      // posting a token-less submission that the server would reject (fail-closed).
      if(form.querySelector('.h-captcha')){
        var token=(window.hcaptcha&&window.hcaptcha.getResponse)?window.hcaptcha.getResponse():'';
        if(!token){if(error){error.textContent='Please complete the captcha.';error.hidden=false;}return;}
      }
      var data={};
      Array.prototype.forEach.call(form.querySelectorAll('input,textarea,select'),function(el){
        if(!el.name||el.type==='submit'||el.type==='button')return;
        data[el.name]=el.value;
      });
      data['_elapsed']=String(Date.now()-started);
      if(submit)submit.disabled=true;
      fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}).then(function(res){
        if(!res.ok)throw new Error('bad status');
        var redirect=form.getAttribute('data-sw-redirect');
        if(redirect){window.location.assign(redirect);return;}
        form.reset();
        if(success)success.hidden=false;
        form.setAttribute('data-sw-submitted','true');
      }).catch(function(){
        if(error)error.hidden=false;
      }).then(function(){
        if(submit)submit.disabled=false;
      });
    });
  }
  function init(){ensureHcaptcha();Array.prototype.forEach.call(document.querySelectorAll('form[data-sw-component="form"]'),enhance);}
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;

// Registry keyed by block `type`. Only blocks with behavior/styling belong here
// (child blocks like Slide/AccordionItem/LightboxItem/Tab are styled by their
// parent's entry — no entry of their own). Insertion order = bundle order.
const COMPONENTS = new Map<string, ComponentAsset>([
  ['Carousel', { css: CAROUSEL_CSS, js: CAROUSEL_JS }],
  ['Accordion', { css: ACCORDION_CSS, js: '' }],
  ['Lightbox', { css: LIGHTBOX_CSS, js: LIGHTBOX_JS }],
  ['Modal', { css: MODAL_CSS, js: MODAL_JS }],
  ['CookieConsent', { css: COOKIE_CONSENT_CSS, js: COOKIE_CONSENT_JS }],
  ['Tabs', { css: TABS_CSS, js: TABS_JS }],
  ['Form', { css: FORM_CSS, js: FORM_JS }],
]);

/** Block types that are interactive components (have bundled CSS/JS). */
export const COMPONENT_TYPES: ReadonlySet<string> = new Set(COMPONENTS.keys());

/**
 * `data-sw-component` attribute NAME → component block `type`. MUST stay in sync with the names
 * `render.ts` emits (`data-sw-component="modal"` etc.). (`Accordion` is native `<details>`-only — no
 * `data-sw-component` marker, no JS — so it is intentionally absent.)
 */
const COMPONENT_NAME_TO_TYPE: ReadonlyMap<string, string> = new Map([
  ['carousel', 'Carousel'],
  ['lightbox', 'Lightbox'],
  ['modal', 'Modal'],
  ['cookie-consent', 'CookieConsent'],
  ['tabs', 'Tabs'],
  ['form', 'Form'],
]);

const COMPONENT_MARKER_RE = /data-sw-component="([a-z-]+)"/g;

/**
 * The distinct component block types referenced by `data-sw-component="…"` markers in a rendered /
 * CODE-FIRST Handlebars source string. Pages render from `source`, so this string scan ships the
 * component's CSS/JS the same way animations/lazyload/ripple are detected (a literal-marker scan over
 * page sources, skeleton slots, and snippets). Empty for component-free source.
 */
export function componentTypesInSource(html: string | null | undefined): string[] {
  if (typeof html !== 'string' || html.length === 0) return [];
  const seen = new Set<string>();
  for (const match of html.matchAll(COMPONENT_MARKER_RE)) {
    const name = match[1];
    if (!name) continue;
    const type = COMPONENT_NAME_TO_TYPE.get(name);
    if (type) seen.add(type);
  }
  // A form embedded by REFERENCE — `{{sw-form "id"}}` or an authored `data-sw-form="id"` — only
  // gains its `data-sw-component="form"` marker at render (the form-embed pass), so the source
  // scan must catch the reference itself. Anchored to the two real spellings (helper call /
  // attribute), so prose or a future `sw-format` helper doesn't over-ship the Form assets.
  if (/(?:\{\{\s*|data-)sw-form\b/.test(html)) seen.add('Form');
  return [...seen];
}

/**
 * Bundles the CSS + JS for the given component types into single strings (deduped,
 * in stable registry order). Unknown types are ignored. Empty when none are used,
 * so callers ship nothing for sites that use no components.
 */
export function componentAssets(types: Iterable<string>): { css: string; js: string } {
  const want = new Set(types);
  const css: string[] = [];
  const js: string[] = [];
  for (const [type, asset] of COMPONENTS) {
    if (!want.has(type)) continue;
    if (asset.css) css.push(asset.css);
    if (asset.js) js.push(asset.js);
  }
  return { css: css.join('\n'), js: js.join('\n') };
}
