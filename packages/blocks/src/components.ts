// Platform-authored behavior + styling for INTERACTIVE component blocks (Carousel,
// Lightbox, Modal, Tabs, CookieConsent, Form).
//
// These are NOT tenant code — they are first-party, audited, static assets shipped
// only when the matching block is used (the same "only-used-ships" discipline as
// icons.ts / brand-icons.ts / the Tailwind sheet). The tenant supplies only DATA
// (slides, captions) through declarative markup; never JavaScript. This keeps the
// "no per-tenant code execution" invariant intact: the JS below is bundled to a
// `components.js` served from the site's own origin (CSP `default-src 'self'`),
// and runs on the published/exported site. Components degrade to usable semantic
// HTML without JS (a carousel stays a swipeable scroll-snap row; a lightbox item
// stays a working link to the full image).
//
// Carousel and Lightbox are powered by VENDORED MIT libraries (Embla Carousel /
// GLightbox) bundled together with their first-party wiring by scripts/gen-vendor.mjs
// into the checked-in src/vendor/*-runtime.ts modules (CI guards drift via
// gen:vendor:check). The libraries stay an implementation detail: agents author only
// the declarative data-sw-component / data-sw-part / data-* contract documented in
// COMPONENT_CATALOG — never library API calls.
import { CAROUSEL_RUNTIME_JS } from './vendor/carousel-runtime.js';
import { LIGHTBOX_RUNTIME_JS, LIGHTBOX_VENDOR_CSS } from './vendor/lightbox-runtime.js';

/** A component's static styling + behavior (either may be empty). */
export interface ComponentAsset {
  css: string;
  js: string;
}

// --- Carousel -------------------------------------------------------------
// Embla-powered slider. PE-first: the authored track is a CSS scroll-snap row
// (swipeable with no JS); the runtime moves the slides into a generated
// [data-sw-part="container"] and flips the track into Embla's clipping viewport
// via data-sw-enhanced. `--sw-items` is the slides-per-view knob (set it with
// Tailwind arbitrary properties, e.g. class="[--sw-items:1.15] md:[--sw-items:3]";
// fractional values = peek mode) — it drives BOTH the no-JS row and the engine.
// Arrow/dot POSITIONING defaults live in zero-specificity :where() rules so any
// authored utility class repositions them; their visibility gates stay strong so
// inert controls never show before enhancement.
const CAROUSEL_CSS = [
  '[data-sw-block="Carousel"]{position:relative}',
  // `scrollbar-width:none` hides it in Firefox (the base layer otherwise gives every
  // element `scrollbar-width:thin`); the ::-webkit rule hides it in Chrome/Safari.
  '[data-sw-block="Carousel"] [data-sw-part="track"]{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;-webkit-overflow-scrolling:touch;scrollbar-width:none}',
  '[data-sw-block="Carousel"] [data-sw-part="track"]::-webkit-scrollbar{display:none}',
  '[data-sw-block="Carousel"] [data-sw-part="container"]{display:flex;width:100%}',
  // margin:0 — the rendered-site baseline is modern-normalize (NOT preflight), so UA defaults
  // like figure/blockquote `margin: 1em 40px` survive into slides and break Embla: snaps land
  // 40px apart per slide, fade repositioning drifts, and AutoHeight sizes the container to the
  // border box so overflow:hidden clips the bottom margin. Slides are layout cells; author
  // spacing as padding INSIDE the slide (Embla's documented gap pattern).
  '[data-sw-block="Carousel"] [data-sw-part="slide"]{flex:0 0 calc(100%/var(--sw-items,1));scroll-snap-align:start;min-width:0;margin:0}',
  '[data-sw-block="Carousel"] [data-sw-part="slide"] img{display:block;width:100%;height:auto}',
  // Enhanced: the track stops being the scroller (Embla translates the container inside it).
  '[data-sw-block="Carousel"][data-sw-enhanced="true"] [data-sw-part="track"]{display:block;overflow:hidden;scroll-snap-type:none}',
  // AutoHeight (data-autoheight="true"): the engine sets the container height to the
  // in-view slide; top-align the slides (plugin requirement) and animate the change.
  // NOT gated on data-sw-enhanced: the plugin caches slide heights when Embla inits,
  // BEFORE the runtime marks the root enhanced — a late gate would measure every slide
  // stretched to the tallest. The container only exists once the runtime creates it.
  '[data-sw-block="Carousel"][data-autoheight="true"] [data-sw-part="container"]{align-items:flex-start;transition:height .25s ease}',
  // Press-ripple containment ("waves"): the runtime adds .sw-waves to arrows/dots (and
  // slides in click-to-slide mode). MUST come BEFORE the default control placement below —
  // all these rules are zero-specificity :where(), so source order decides, and the arrows'
  // default position:absolute has to win over this relative fallback.
  ':where([data-sw-block="Carousel"] .sw-waves){position:relative;overflow:hidden}',
  // Controls stay hidden until the runtime enhances — the no-JS fallback never shows
  // inert UI. (These gates are deliberately strong; to drop a control, omit its part.)
  '[data-sw-block="Carousel"] [data-sw-part="prev"],[data-sw-block="Carousel"] [data-sw-part="next"],[data-sw-block="Carousel"] [data-sw-part="dots"]{display:none}',
  '[data-sw-block="Carousel"][data-sw-enhanced="true"] [data-sw-part="prev"],[data-sw-block="Carousel"][data-sw-enhanced="true"] [data-sw-part="next"]{display:flex;align-items:center;justify-content:center}',
  '[data-sw-block="Carousel"][data-sw-enhanced="true"] [data-sw-part="dots"]{display:flex}',
  // DEFAULT placement (zero specificity — any authored utility class wins): arrows
  // overlaid mid-left/right, dots overlaid centered at the bottom of the slides.
  ':where([data-sw-block="Carousel"]) :where([data-sw-part="prev"],[data-sw-part="next"]){position:absolute;top:50%;transform:translateY(-50%);width:2.75rem;height:2.75rem;border:0;border-radius:9999px;background:rgb(0 0 0/.45);color:#fff;cursor:pointer;z-index:1}',
  ':where([data-sw-block="Carousel"]) :where([data-sw-part="prev"]){left:.75rem}',
  ':where([data-sw-block="Carousel"]) :where([data-sw-part="next"]){right:.75rem}',
  ':where([data-sw-block="Carousel"]) :where([data-sw-part="dots"]){position:absolute;bottom:.75rem;left:50%;transform:translateX(-50%);gap:.4rem;z-index:1}',
  '[data-sw-block="Carousel"] [data-sw-part="prev"][disabled],[data-sw-block="Carousel"] [data-sw-part="next"][disabled]{opacity:.35;cursor:default}',
  '[data-sw-block="Carousel"] [data-sw-part="prev"] svg,[data-sw-block="Carousel"] [data-sw-part="next"] svg{margin:auto}',
  // Dots are runtime-generated buttons holding the Lucide `circle` glyph; the active
  // one fills via aria-current.
  '[data-sw-block="Carousel"] [data-sw-part="dots"] button{display:block;width:.7rem;height:.7rem;padding:0;border:0;background:none;color:#fff;opacity:.65;cursor:pointer}',
  '[data-sw-block="Carousel"] [data-sw-part="dots"] button svg{display:block;width:100%;height:100%}',
  '[data-sw-block="Carousel"] [data-sw-part="dots"] button[aria-current="true"]{opacity:1}',
  '[data-sw-block="Carousel"] [data-sw-part="dots"] button[aria-current="true"] svg circle{fill:currentColor}',
  '[data-sw-block="Carousel"] .sw-ripple{position:absolute;border-radius:9999px;pointer-events:none;background:rgb(0 0 0/.35);transform:scale(0);animation:sw-ripple .65s ease-out forwards}',
  '@keyframes sw-ripple{to{transform:scale(1);opacity:0}}',
  // Click-to-slide (data-click-next="true"): the whole slide is the affordance.
  '[data-sw-block="Carousel"][data-click-next="true"][data-sw-enhanced="true"] [data-sw-part="slide"]{cursor:pointer}',
  '@media (prefers-reduced-motion: reduce){[data-sw-block="Carousel"] [data-sw-part="track"]{scroll-behavior:auto}[data-sw-block="Carousel"] [data-sw-part="container"]{transition:none}}',
].join('');

// The Embla-powered runtime (vendored library + first-party wiring; see
// vendor-src/carousel.entry.js for the readable source). Wires arrows/dots/keyboard,
// fade or slide effects, autoplay/auto-scroll (paused on hover/focus, skipped under
// reduced motion), wheel gestures, and auto height — all from data-* attributes.
const CAROUSEL_JS = CAROUSEL_RUNTIME_JS;

// --- Lightbox ----------------------------------------------------------------
// GLightbox-powered gallery viewer. PE-first: each item is an anchor to the full
// image, so with no JS clicking simply opens the image. With JS each component
// root becomes its own gallery (swipe / pinch-zoom / keyboard / animated slide
// changes); the viewer DOM is built by the runtime — there is no authored overlay.
// The vendored GLightbox stylesheet has no url() refs (CSP-safe); the trailing
// overrides restore stroke rendering for the Lucide icons the wiring passes in
// (the "clean" skin fills paths by default) and round the buttons.
const LIGHTBOX_CSS = [
  '[data-sw-block="Lightbox"]{display:block}',
  '[data-sw-block="Lightbox"] [data-sw-part="grid"]{display:grid;grid-template-columns:repeat(auto-fill,minmax(8rem,1fr));gap:.5rem}',
  '[data-sw-block="Lightbox"] [data-sw-part="item"]{display:block}',
  '[data-sw-block="Lightbox"] [data-sw-part="item"] img{display:block;width:100%;height:100%;object-fit:cover;aspect-ratio:1}',
  LIGHTBOX_VENDOR_CSS,
  '.glightbox-clean .gprev,.glightbox-clean .gnext,.glightbox-clean .gclose{background-color:rgb(0 0 0/.45);border-radius:9999px}',
  '.glightbox-clean .gprev path,.glightbox-clean .gnext path,.glightbox-clean .gclose path{fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
  '.glightbox-clean .gprev svg,.glightbox-clean .gnext svg,.glightbox-clean .gclose svg{width:1.5rem;height:1.5rem}',
].join('');

// The GLightbox-powered runtime (vendored library + first-party wiring; see
// vendor-src/lightbox.entry.js for the readable source). Per-root galleries from the
// authored anchors, Lucide icons, and an a11y shim (dialog semantics, focus restore)
// on top of GLightbox's own keyboard/touch handling.
const LIGHTBOX_JS = LIGHTBOX_RUNTIME_JS;

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
  // Same UA-margin exposure as carousel slides (modern-normalize keeps figure/dl margins):
  // a <figure> panel would inset its content by the UA's 40px side margins.
  '[data-sw-block="Tabs"] [data-sw-part="panel"]{margin:0}',
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
// (child blocks like Slide/LightboxItem/Tab are styled by their
// parent's entry — no entry of their own). Insertion order = bundle order.
const COMPONENTS = new Map<string, ComponentAsset>([
  ['Carousel', { css: CAROUSEL_CSS, js: CAROUSEL_JS }],
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
 * the components above expect on their root marker.
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
