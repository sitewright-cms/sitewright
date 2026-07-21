// MINI SHOP — a first-party, dependency-free shopping-cart runtime for PUBLISHED
// static sites.
//
// The cart is FRONT-END only: it lives in `localStorage`, and on checkout it hands its
// contents to a submission CHANNEL — a WhatsApp / mailto deep link, or a payment link.
// There is NO server-side cart and NO payment capture; the submitted cart is an order
// INQUIRY and the prices are NON-AUTHORITATIVE (client-tamperable). The merchant confirms
// price + availability and collects payment out-of-band. (PR-2 adds a Form channel.)
//
// Same "only-used-ships" discipline as components.ts / animations.ts / lazyload.ts: this
// module ships its CSS + a `cart.js` file ONLY when a page actually uses the cart (the
// `data-sw-cart` marker, emitted by the {{sw-cart}} / {{sw-add-to-cart}} helpers). It is
// first-party, audited, static code — tenants supply only DATA (product fields, currency,
// channel config) through escaped attributes; never JavaScript.
//
// Invariants (the security contract a reviewer should check):
// - Cart DATA reaches the DOM only via `textContent` / `setAttribute` — NEVER `innerHTML`
//   (the structure is built with `createElement`), so a product name can't inject markup.
// - Deep-link payloads are `encodeURIComponent`-escaped; a `payment` channel URL is
//   re-checked to be `https://` immediately before `window.open` (defence-in-depth on top
//   of the schema's https-only validation). All external opens use `noopener`.
// - `localStorage` access is wrapped in try/catch (sandboxed preview / disabled storage)
//   and the stored cart is re-validated on read: qty is a bounded integer, price a finite
//   non-negative number, with caps on distinct lines and per-line quantity.
// - The storage key is namespaced per SITE (derived from this script's own URL), so two
//   published sites sharing an origin (e.g. `/sites/<a>/` and `/sites/<b>/`) never share a
//   cart, while every page of one site does.
// - PE note: the cart needs JS to function (a static order form has no client state), so
//   with no JS there is simply no cart UI — by design, like the Form block's JS-only submit.
// Only-used-ships detection. The rendered marker is `data-sw-cart` / `data-sw-cart-add`, but a
// code-first SOURCE (or a skeleton slot) contains the HELPER call `{{sw-cart}}` / `{{sw-add-to-cart}}`
// — the attribute only appears AFTER Handlebars runs (cf. animations.ts: a marker written via a helper
// isn't detected). So we match two substrings that cover every form: `sw-cart` (covers `{{sw-cart}}`,
// `data-sw-cart`, and `data-sw-cart-add`) and `sw-add-to-cart` (covers `{{sw-add-to-cart}}`). A stray
// prose match only over-ships a few KB — benign, like the other runtimes.
function hasCartMarker(s: string): boolean {
  return s.includes('sw-cart') || s.includes('sw-add-to-cart');
}

/**
 * Cart stylesheet. The floating toggle + drawer are hidden until the runtime adds
 * `data-sw-enhanced` (PE-first: no inert UI before JS). Brand-themed via the same
 * `--sw-color-primary` custom property as the other components.
 *
 * Dark-mode aware: every surface/text/divider reads a `--sw-color-*` token whose FALLBACK is the
 * original light value, so light mode is byte-for-byte unchanged (base-200/base-300 are normally
 * unset → fallback wins) while dark mode flips with the palette. Labels on the brand fill use the
 * derived `--sw-color-primary-content` token, and `color-scheme` is inherited (not forced) so native
 * form controls in the drawer follow the active scheme. Semantic reds (count/remove/error) and the
 * shadow/backdrop/ripple alphas are intentionally scheme-independent.
 */
export const CART_CSS = [
  '[data-sw-cart]{display:none}',
  '[data-sw-cart][data-sw-enhanced="true"]{display:block}',
  // SIDEBAR-STYLE toggle TAB on the right edge (icon + "Shopping Cart"), mirroring the editor's
  // SidePanel tab — DETACHED from .btn. The button is a TRANSPARENT WRAPPER (overflow:visible) that
  // carries the count badge + the escaping pulse halo; the inner .sw-cart-tab is the SOLID primary
  // visual and is overflow:hidden so the click ripple clips to the tab shape. The label rides a
  // vertical writing-mode so it reads down the edge. position is !important so no stray site rule unpins it.
  '[data-sw-cart] [data-sw-part="toggle"]{position:fixed !important;overflow:visible !important;right:0;top:50%;translate:0 -50%;z-index:9997;display:block;border:0;background:none;padding:0;cursor:pointer}',
  '[data-sw-cart] [data-sw-part="toggle"] .sw-cart-tab{position:relative;overflow:hidden;display:flex;align-items:center;gap:.5rem;writing-mode:vertical-rl;padding:1.1rem .55rem;border-radius:.9rem 0 0 .9rem;background:var(--sw-color-primary,#0a7a5a);color:var(--sw-color-primary-content,#fff);font:inherit;font-weight:700;font-size:.74rem;text-transform:uppercase;letter-spacing:.07em;box-shadow:-4px 6px 22px rgba(0,0,0,.28)}',
  '[data-sw-cart] [data-sw-part="toggle"] svg{width:1.3rem;height:1.3rem}',
  // hover: GROW the tab inward by widening its edge-side padding (NOT translateX — that would leave a
  // gap at the right edge). The tab stays flush to the edge; its left side extends toward the page.
  '@media (prefers-reduced-motion:no-preference){[data-sw-cart] [data-sw-part="toggle"] .sw-cart-tab{transition:padding-right .2s cubic-bezier(.16,1,.3,1),box-shadow .2s ease}}',
  '[data-sw-cart] [data-sw-part="toggle"]:hover .sw-cart-tab{padding-right:1.15rem;box-shadow:-9px 9px 30px rgba(0,0,0,.36)}',
  '[data-sw-cart] [data-sw-part="count"]{position:absolute;top:-.4rem;left:-.4rem;z-index:1;min-width:1.3rem;height:1.3rem;padding:0 .3rem;border-radius:9999px;background:#b00020;color:#fff;font-size:.72rem;font-weight:700;line-height:1.3rem;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.3)}',
  '[data-sw-cart] [data-sw-part="count"][hidden]{display:none}',
  // Right-side drawer (native <dialog> → focus trap + Esc + ::backdrop). It SLIDES in/out (transform)
  // and the backdrop FADES + BLURS, on both open and close — @starting-style + transition-behavior:
  // allow-discrete keep the <dialog> animating across its display toggle. Older engines fall back to an
  // instant open/close (progressive enhancement). Reduced motion → instant.
  // `inset:0 0 0 auto` (top/right/bottom:0, left:auto) overrides the <dialog> UA `inset:0` so it pins to
  // the RIGHT edge, full height (not centered/left). We MUST override BOTH UA size clamps: the UA sheet
  // sets `max-width:calc(100% - 6px - 2em)` AND `max-height:calc(100% - 6px - 2em)` (~38px at a 16px font),
  // so without `max-height` the drawer renders ~38px short of the viewport bottom despite `height:100vh`.
  // dvh (with a vh fallback) makes "full height" track the *visible* viewport on mobile browser chrome.
  // Solid surface from the base tokens: the background + text flip with the scheme (light fallbacks keep
  // light mode identical), and `color-scheme` is INHERITED from the document (the platform sets
  // `color-scheme:dark` on :root in dark mode) so native form controls in the drawer follow suit. Chrome
  // surfaces stay SOLID (the base-100/200/300 tokens are opaque); only shadows/backdrop/ripple use alpha.
  // HEIGHT lives on the BASE rule (a closed <dialog> is display:none, so a full height is harmless) so it
  // PERSISTS through the close transition — otherwise it would collapse to content height (the drawer
  // "shrinks" as it slides out, since `display:flex` is still held by `transition: display allow-discrete`).
  // HEIGHT + flex-direction live on the BASE rule (a closed <dialog> is display:none, so they're inert)
  // so they PERSIST through the close transition. `display:flex` is the only layout prop on [open] (held
  // by `transition: display allow-discrete`); if flex-direction were on [open] too it would revert to row
  // mid-close while display:flex is still held → the items list collapses + the footer buttons jump up.
  '[data-sw-cart] dialog{position:fixed;inset:0 0 0 auto;margin:0;width:min(92vw,24rem);height:100vh;height:100dvh;max-width:100vw;max-height:100vh;max-height:100dvh;flex-direction:column;border:0;padding:0;background:var(--sw-color-base-100,#fff);color:var(--sw-color-base-content,#1f2937);box-shadow:-8px 0 32px rgba(0,0,0,.25);transform:translateX(100%);transition:transform .3s cubic-bezier(.4,0,.2,1),overlay .3s allow-discrete,display .3s allow-discrete}',
  // transform/display live on [open] ONLY — a closed <dialog> must keep its UA display:none (else it
  // renders off-screen but counts as visible).
  '[data-sw-cart] dialog[open]{transform:translateX(0);display:flex}',
  '@starting-style{[data-sw-cart] dialog[open]{transform:translateX(100%)}}',
  '[data-sw-cart] dialog::backdrop{background:rgba(0,0,0,.35);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);opacity:0;transition:opacity .3s ease,overlay .3s allow-discrete,display .3s allow-discrete}',
  '[data-sw-cart] dialog[open]::backdrop{opacity:1}',
  '@starting-style{[data-sw-cart] dialog[open]::backdrop{opacity:0}}',
  '@media (prefers-reduced-motion:reduce){[data-sw-cart] dialog,[data-sw-cart] dialog::backdrop{transition:none}}',
  '[data-sw-cart] [data-sw-part="head"]{flex:none;display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid var(--sw-color-base-300,#e5e7eb)}',
  '[data-sw-cart] [data-sw-part="head"] h2{margin:0;font-size:1.125rem}',
  // Flex-centered SQUARE so the (symmetric) icon sits at the box center → the hover rotate() pivots dead-centre
  // (a baseline-positioned text glyph sits off-centre and appears to hinge around an edge when rotated).
  '[data-sw-cart] [data-sw-part="close"]{display:flex;align-items:center;justify-content:center;width:2rem;height:2rem;border:0;background:none;cursor:pointer}',
  '[data-sw-cart] [data-sw-part="close"] svg{width:1.25rem;height:1.25rem}',
  // The items list FILLS the space between the fixed head and foot (flex:1) and scrolls when it overflows.
  // min-height:0 lets a flex item shrink below its content height so overflow-y actually scrolls (the
  // default min-height:auto would otherwise blow the drawer past 100vh on a long cart). This replaces a
  // fragile `max-height:calc(100% - 16rem)` magic constant that left a dead gap on a short cart.
  '[data-sw-cart] [data-sw-part="items"]{list-style:none;margin:0;padding:.5rem 1.25rem;flex:1 1 auto;min-height:0;overflow-y:auto}',
  // A cart line: an optional thumbnail beside a body that stacks the name over ONE controls row
  // (base price · qty stepper · remove · line subtotal). Solid neutral divider.
  '[data-sw-cart] [data-sw-part="line"]{display:flex;gap:.75rem;align-items:flex-start;padding:.75rem 0;border-bottom:1px solid var(--sw-color-base-300,#f0f0f0)}',
  // Product thumbnail: a solid neutral tile (small padding, slightly-rounded border) framing the image.
  '[data-sw-cart] [data-sw-part="thumb"]{flex:none;width:3.5rem;height:3.5rem;padding:.25rem;border:1px solid var(--sw-color-base-300,#e5e7eb);border-radius:.5rem;background:var(--sw-color-base-200,#f3f4f6);display:flex;align-items:center;justify-content:center}',
  '[data-sw-cart] [data-sw-part="thumb"] img{width:100%;height:100%;object-fit:cover;border-radius:.25rem;display:block}',
  '[data-sw-cart] [data-sw-part="line-body"]{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:.4rem}',
  '[data-sw-cart] [data-sw-part="line-name"]{font-weight:600;line-height:1.3}',
  // The controls row; the line subtotal is pushed to the right edge via margin-left:auto.
  '[data-sw-cart] [data-sw-part="line-controls"]{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}',
  '[data-sw-cart] [data-sw-part="line-price"]{color:color-mix(in oklab,var(--sw-color-base-content,#1f2937) 58%,transparent);font-size:.875rem}',
  '[data-sw-cart] [data-sw-part="line-subtotal"]{margin-left:auto;font-weight:600;font-size:.9375rem}',
  // Quantity = a COMPACT connected button group [- n +]: a PILL outer border (border-radius:2rem) + the
  // buttons borderless with inline Lucide minus/plus icons, the value flanked by dividers (its left/right
  // borders). margin-left leaves a slightly bigger gap to the base price (on top of the row gap).
  '[data-sw-cart] [data-sw-part="qty"]{display:inline-flex;align-items:stretch;margin-left:.35rem;border:1px solid var(--sw-color-base-300,#d1d5db);border-radius:2rem;overflow:hidden}',
  '[data-sw-cart] [data-sw-part="qty"] button{display:flex;align-items:center;justify-content:center;width:1.5rem;height:1.5rem;border:0;background:var(--sw-color-base-100,#fff);color:var(--sw-color-base-content,#1f2937);cursor:pointer}',
  '[data-sw-cart] [data-sw-part="qty"] button svg{width:.875rem;height:.875rem}',
  '[data-sw-cart] [data-sw-part="qty"]>span{display:flex;align-items:center;justify-content:center;min-width:1.5rem;padding:0 .25rem;border-left:1px solid var(--sw-color-base-300,#d1d5db);border-right:1px solid var(--sw-color-base-300,#d1d5db);background:var(--sw-color-base-100,#fff);font-variant-numeric:tabular-nums}',
  // Remove = a red trash icon button (square hit area; light-red hover wash).
  '[data-sw-cart] [data-sw-part="remove"]{display:inline-flex;align-items:center;justify-content:center;width:1.75rem;height:1.75rem;padding:0;border:0;border-radius:.375rem;background:none;color:#dc2626;cursor:pointer;transition:background .15s ease}',
  '[data-sw-cart] [data-sw-part="remove"] svg{width:1.125rem;height:1.125rem}',
  '[data-sw-cart] [data-sw-part="empty"]{padding:2rem 1.25rem;color:color-mix(in oklab,var(--sw-color-base-content,#1f2937) 58%,transparent);text-align:center}',
  // The foot is a fixed-size flex item; the list (flex:1) above it consumes the free space, so the foot
  // pins to the bottom without needing `margin-top:auto`. flex:none → it never shrinks the checkout area.
  '[data-sw-cart] [data-sw-part="foot"]{flex:none;padding:1rem 1.25rem;border-top:1px solid var(--sw-color-base-300,#e5e7eb)}',
  '[data-sw-cart] [data-sw-part="total"]{display:flex;justify-content:space-between;font-weight:700;margin-bottom:.25rem}',
  '[data-sw-cart] [data-sw-part="note"]{font-size:.75rem;color:color-mix(in oklab,var(--sw-color-base-content,#1f2937) 58%,transparent);margin:.25rem 0 .75rem}',
  // checkout / channel buttons use the vendored `.btn.btn-primary.btn-block`; only their stacking gap is kept.
  '[data-sw-cart] [data-sw-part="channel"]{margin-top:.5rem}',
  '[data-sw-cart] [data-sw-part="clear"]{display:block;width:100%;border:0;background:none;color:color-mix(in oklab,var(--sw-color-base-content,#1f2937) 58%,transparent);cursor:pointer;margin-top:.5rem;font-size:.875rem}',
  // Inline order form (the `form` channel).
  '[data-sw-cart] [data-sw-part="order"]{margin-top:.75rem}',
  '[data-sw-cart] [data-sw-part="order-field"]{display:block;margin-bottom:.5rem;font-size:.8125rem}',
  '[data-sw-cart] [data-sw-part="order-field"]>span{display:block;margin-bottom:.15rem}',
  '[data-sw-cart] [data-sw-part="order-field"] input,[data-sw-cart] [data-sw-part="order-field"] textarea{width:100%;padding:.4rem .5rem;border:1px solid var(--sw-color-base-300,#d1d5db);border-radius:.375rem;font:inherit}',
  // order-submit / channel-submit are checkout CTAs — they render as .btn.btn-primary.btn-block; only
  // their stacking gap + the submitting cursor are kept (the face/hover come from .btn).
  '[data-sw-cart] [data-sw-part="order-submit"]{margin-top:.25rem}',
  '[data-sw-cart] [data-sw-part="order-submit"][disabled]{cursor:progress}',
  '[data-sw-cart] [data-sw-part="order-status"]{margin:.5rem 0 0;font-size:.8125rem}',
  // Collapsible per-channel input form (whatsapp/mailto with custom fields). Reuses the order-field
  // input styling above; hidden until the channel button toggles it open.
  '[data-sw-cart] [data-sw-part="channel-form"]{margin:.25rem 0;padding:.625rem .75rem;border:1px solid var(--sw-color-base-300,#e5e7eb);border-radius:.375rem;background:var(--sw-color-base-200,#f9fafb)}',
  '[data-sw-cart] [data-sw-part="channel-form"][hidden]{display:none}',
  '[data-sw-cart] [data-sw-part="channel-submit"]{margin-top:.25rem}',
  '[data-sw-cart] [data-sw-part="channel-status"]{margin:.4rem 0 0;font-size:.8125rem;color:#b00020}',
  '[data-sw-cart] [data-sw-part="sent-msg"]{padding:1.5rem 1.25rem;text-align:center;color:var(--sw-color-primary,#0a7a5a);font-weight:600}',
  // The "added" pulse on an add-to-cart button (runtime toggles data-sw-added briefly).
  '[data-sw-cart-add][data-sw-added="true"]{opacity:.7}',
  // A brief "bump" on the cart tab when an item is added — the non-interrupting add feedback. It animates
  // `scale` ONLY (the tab's translate centring + any hover slide stay independent, so neither clobbers it).
  '@keyframes sw-cart-bump{0%,100%{scale:1}30%{scale:1.1}}',
  '[data-sw-cart] [data-sw-part="toggle"][data-sw-bump]{animation:sw-cart-bump .4s ease}',
  // A PULSE halo that expands out from the tab on every add (a brand-coloured ring behind it; the tab's
  // overflow:visible lets it escape). Matches the tab's rounded-left shape. Reduced motion → bump only.
  // Bigger pulse, biased HORIZONTAL (toward the page): scaleX grows far more than scaleY, and the origin
  // is the RIGHT edge so the halo expands LEFTward into the page (its right side stays at the viewport edge).
  '@keyframes sw-cart-pulse{from{transform:scale(1);opacity:.5}to{transform:scale(3.6,2);opacity:0}}',
  '@media (prefers-reduced-motion:no-preference){[data-sw-cart] [data-sw-part="toggle"][data-sw-pulse]::after{content:"";position:absolute;inset:0;z-index:-1;transform-origin:right center;border-radius:.9rem 0 0 .9rem;background:var(--sw-color-primary,#0a7a5a);animation:sw-cart-pulse .7s ease-out;pointer-events:none}}',
  // Hover affordances on the icon controls (the toggle + checkout buttons get their hover from .btn).
  '[data-sw-cart] [data-sw-part="close"]{transition:color .15s ease,transform .15s ease}',
  '[data-sw-cart] [data-sw-part="close"]:hover{color:#b00020;transform:rotate(90deg)}',
  '[data-sw-cart] [data-sw-part="qty"] button{transition:background .15s ease}',
  '[data-sw-cart] [data-sw-part="qty"] button:hover{background:var(--sw-color-base-200,#f3f4f6)}',
  '[data-sw-cart] [data-sw-part="clear"]:hover{color:var(--sw-color-base-content,#374151);text-decoration:underline}',
  '[data-sw-cart] [data-sw-part="remove"]:hover{background:color-mix(in oklab,#dc2626 16%,transparent)}',
  // Self-contained "waves" ripple (the platform ripple runtime only enhances elements present at load,
  // so the runtime-built cart wires its own — scoped to the cart so it never double-binds page buttons).
  '[data-sw-cart] .waves-effect{position:relative;overflow:hidden;-webkit-tap-highlight-color:transparent}',
  '[data-sw-cart] .waves-ripple{position:absolute;border-radius:50%;pointer-events:none;background:color-mix(in oklab,var(--sw-color-base-content,#000) 18%,transparent);transform:scale(0);opacity:.5;will-change:transform,opacity}',
  '[data-sw-cart] .waves-light .waves-ripple{background:color-mix(in srgb,var(--sw-color-primary-content,#fff) 50%,transparent)}',
  '@media (prefers-reduced-motion:no-preference){[data-sw-cart] .waves-rippling{animation:sw-cart-waves .6s ease-out forwards}}',
  '@keyframes sw-cart-waves{to{transform:scale(1);opacity:0}}',
].join('');

// The runtime. ES5-style (var / function) — served raw, never transpiled, like the other
// component bundles. Built with createElement + textContent; no innerHTML of cart data.
export const CART_JS = `(function(){
  'use strict';
  var MAX_LINES=50, MAX_QTY=99;
  function q(sel,root){return Array.prototype.slice.call((root||document).querySelectorAll(sel));}
  function mk(tag,cls,txt){var n=document.createElement(tag);if(cls){n.className=cls;}if(txt!=null){n.textContent=txt;}return n;}
  function part(tag,name,txt){var n=mk(tag,null,txt);n.setAttribute('data-sw-part',name);return n;}
  // A self-contained "waves" ripple on a control (pointerdown → an expanding circle from the click
  // point). The cart wires this itself because the platform ripple runtime only binds elements present
  // at load. A "light" ripple tints it white for dark/colored buttons. Reduced motion → no ripple.
  function ripple(el,light){
    el.classList.add('waves-effect');if(light){el.classList.add('waves-light');}
    el.addEventListener('pointerdown',function(e){
      if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches){return;}
      var r=el.getBoundingClientRect();var size=Math.max(r.width,r.height)*2;
      var s=document.createElement('span');s.className='waves-ripple waves-rippling';
      s.style.width=s.style.height=size+'px';
      s.style.left=((e.clientX!=null?e.clientX:r.left+r.width/2)-r.left-size/2)+'px';
      s.style.top=((e.clientY!=null?e.clientY:r.top+r.height/2)-r.top-size/2)+'px';
      el.appendChild(s);
      var rm=function(){if(s.parentNode){s.parentNode.removeChild(s);}};
      s.addEventListener('animationend',rm,{once:true});setTimeout(rm,800);
    });
  }
  // ---- per-site storage key: this script's own directory (unique per /sites/<slug>/, stable across
  // a site's pages). Falls back to the page directory only if the script element can't be located. ----
  function siteKey(mount){
    var s=document.currentScript;
    if(!s){var all=q('script[src]');for(var i=0;i<all.length;i++){if(/\\/cart\\.js(\\?|$)/.test(all[i].getAttribute('src')||'')){s=all[i];break;}}}
    try{if(s&&s.src){return new URL('.',s.src).href;}}catch(e){}
    return (mount&&mount.getAttribute('data-cart-key'))||(location.host+location.pathname.replace(/[^\\/]*$/,''));
  }
  // ---- config from the mount's escaped data-* attributes ----
  function readConfig(mount){
    var d=parseInt(mount.getAttribute('data-currency-decimals'),10);
    if(isNaN(d)||d<0||d>4){d=2;}
    var channels=[];
    try{var raw=mount.getAttribute('data-channels');if(raw){var p=JSON.parse(raw);if(Object.prototype.toString.call(p)==='[object Array]'){channels=p;}}}catch(e){channels=[];}
    // NOTE: the {{sw-cart}} helper now ALWAYS emits the drawer-string data-* attrs (its floor is
    // RESERVED_TRANSLATION_DEFAULTS in @sitewright/schema, the single source of truth), so the English
    // fallbacks below are only a safety net for a hand-authored data-sw-cart element with the attribute
    // missing. Change the shipped defaults in the schema registry, not here.
    return {
      symbol:mount.getAttribute('data-currency-symbol')||'',
      code:mount.getAttribute('data-currency-code')||'',
      pos:mount.getAttribute('data-currency-pos')==='after'?'after':'before',
      decimals:d,
      title:mount.getAttribute('data-cart-title')||'Your cart',
      toggleLabel:mount.getAttribute('data-toggle-label')||'Shopping Cart',
      addedLabel:mount.getAttribute('data-added-label')||'Added',
      note:mount.getAttribute('data-note')||'Prices are indicative. This sends an order request \\u2014 the seller confirms availability and final price.',
      emptyLabel:mount.getAttribute('data-empty-label')||'Your cart is empty.',
      totalLabel:mount.getAttribute('data-total-label')||'Total',
      clearLabel:mount.getAttribute('data-clear-label')||'Clear cart',
      sentLabel:mount.getAttribute('data-sent-label')||'Order sent \\u2014 we will be in touch.',
      orderLead:mount.getAttribute('data-order-lead')||'I\\u2019d like to order:', // localized order-summary lead-in
      brand:mount.getAttribute('data-brand')||'', // merchant brand/business name (for the email greeting)
      channels:channels
    };
  }
  function money(amount,cfg){
    var n=(isFinite(amount)?amount:0).toFixed(cfg.decimals);
    return cfg.pos==='after'?(n+(cfg.symbol?(' '+cfg.symbol):'')):((cfg.symbol||'')+n);
  }
  // ---- storage (guarded; re-validates on read) ----
  function load(key){
    try{
      var raw=localStorage.getItem(key);if(!raw){return [];}
      var arr=JSON.parse(raw);if(Object.prototype.toString.call(arr)!=='[object Array]'){return [];}
      var out=[];
      for(var i=0;i<arr.length&&out.length<MAX_LINES;i++){
        var it=arr[i];if(!it||typeof it.sku!=='string'){continue;}
        var price=Number(it.price);if(!isFinite(price)||price<0){continue;}
        var qty=parseInt(it.qty,10);if(isNaN(qty)||qty<1){qty=1;}if(qty>MAX_QTY){qty=MAX_QTY;}
        out.push({sku:String(it.sku).slice(0,200),name:String(it.name||it.sku).slice(0,300),price:price,image:typeof it.image==='string'?it.image.slice(0,2048):'',qty:qty});
      }
      return out;
    }catch(e){return [];}
  }
  function save(key,items){try{localStorage.setItem(key,JSON.stringify(items));}catch(e){}}
  function totalOf(items,cfg){var f=Math.pow(10,cfg.decimals),c=0;for(var i=0;i<items.length;i++){c+=Math.round(items[i].price*f)*items[i].qty;}return c/f;}
  function lineTotal(it,cfg){var f=Math.pow(10,cfg.decimals);return Math.round(it.price*f)*it.qty/f;}
  function countOf(items){var n=0;for(var i=0;i<items.length;i++){n+=items[i].qty;}return n;}
  // ---- order summary (plain text, used by the deep-link channels) ----
  function orderText(items,cfg){
    var lines=[];
    for(var i=0;i<items.length;i++){var it=items[i];lines.push(it.qty+' x '+clip(it.name,80)+' ('+money(it.price,cfg)+') = '+money(lineTotal(it,cfg),cfg));}
    lines.push('Total: '+money(totalOf(items,cfg),cfg));
    return lines.join('\\n');
  }
  function itemsSummary(items){var p=[];for(var i=0;i<items.length;i++){p.push(items[i].qty+'x '+items[i].name);}return p.join(', ');}
  // Collected buyer-input fields → "Label: value" lines (blank values dropped). '' when there are none.
  function fieldLines(values){
    if(!values||!values.length){return '';}
    var lines=[];for(var i=0;i<values.length;i++){var v=values[i];if(v&&v.value){lines.push(v.label+': '+v.value);}}
    return lines.join('\\n');
  }
  // The full order MESSAGE for a deep-link channel: a lead (the email greeting "Hi <brand> \\u2014 I'd
  // like to order:" for mailto, else the optional whatsapp intro), the order summary, then the collected
  // input fields as "Label: value" lines BELOW the order. Blocks are blank-line separated.
  function orderMessage(ch,items,cfg,values){
    var blocks=[];
    if(ch.kind==='mailto'){
      var greet=cfg.brand?('Hi '+cfg.brand+' \\u2014 '+cfg.orderLead):cfg.orderLead;
      blocks.push(greet+'\\n'+orderText(items,cfg));
    }else{
      if(ch.intro){blocks.push(ch.intro);}
      blocks.push(orderText(items,cfg));
    }
    var fl=fieldLines(values);if(fl){blocks.push(fl);}
    return blocks.join('\\n\\n');
  }
  // ---- channel execution. "values" (optional) are the collected buyer-input fields. ----
  function runChannel(ch,items,cfg,values){
    if(!items.length){return;}
    if(ch.kind==='whatsapp'){
      var num=String(ch.number||'').replace(/[^0-9]/g,'');if(!num){return;}
      window.open('https://wa.me/'+num+'?text='+encodeURIComponent(orderMessage(ch,items,cfg,values)),'_blank','noopener');
    }else if(ch.kind==='mailto'){
      if(!ch.email){return;}
      var subj=encodeURIComponent(ch.subject||'Order');
      window.location.href='mailto:'+ch.email+'?subject='+subj+'&body='+encodeURIComponent(orderMessage(ch,items,cfg,values));
    }else if(ch.kind==='payment'){
      var tpl=String(ch.urlTemplate||'');if(!tpl){return;}
      var url=tpl.split('{total}').join(encodeURIComponent(totalOf(items,cfg).toFixed(cfg.decimals)))
                 .split('{currency}').join(encodeURIComponent(cfg.code))
                 .split('{items}').join(encodeURIComponent(itemsSummary(items)));
      if(!/^https:\\/\\//i.test(url)){return;}
      window.open(url,'_blank','noopener');
    }
  }
  function channelLabel(ch){
    if(ch.label){return ch.label;}
    if(ch.kind==='whatsapp'){return 'Order via WhatsApp';}
    if(ch.kind==='mailto'){return 'Email your order';}
    if(ch.kind==='payment'){return 'Pay now';}
    if(ch.kind==='form'){return 'Place order';}
    return 'Send order';
  }
  // Clip a name for the order SUMMARY (text + json) so the cart_text/cart_json form fields stay well
  // under the server's per-field cap even for a full cart of long-named products (the canonical item
  // name in localStorage is the un-clipped one).
  function clip(s,n){s=String(s==null?'':s);return s.length>n?s.slice(0,n):s;}
  function cartJson(items){var out=[];for(var i=0;i<items.length;i++){var it=items[i];out.push({sku:clip(it.sku,80),name:clip(it.name,80),price:it.price,qty:it.qty});}return JSON.stringify(out);}
  // ---- cart icon (inline SVG; no external asset) ----
  function cartIcon(){
    var ns='http://www.w3.org/2000/svg';
    var svg=document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');
    svg.setAttribute('stroke-width','2');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
    var p=document.createElementNS(ns,'path');
    p.setAttribute('d','M6 6h15l-1.5 9h-12z M6 6l-2-3H2 M9 21a1 1 0 100-2 1 1 0 000 2z M18 21a1 1 0 100-2 1 1 0 000 2z');
    svg.appendChild(p);return svg;
  }
  // ---- trash icon (inline SVG) for the line remove button ----
  function trashIcon(){
    var ns='http://www.w3.org/2000/svg';
    var svg=document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');
    svg.setAttribute('stroke-width','2');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
    var d=['M3 6h18','M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6','M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2','M10 11v6','M14 11v6'];
    for(var i=0;i<d.length;i++){var pa=document.createElementNS(ns,'path');pa.setAttribute('d',d[i]);svg.appendChild(pa);}
    return svg;
  }
  // ---- Lucide minus / plus icons for the qty stepper (a horizontal bar, + a vertical bar when plus) ----
  function signIcon(isPlus){
    var ns='http://www.w3.org/2000/svg';
    var svg=document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');
    svg.setAttribute('stroke-width','2');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
    var bar=document.createElementNS(ns,'path');bar.setAttribute('d','M5 12h14');svg.appendChild(bar);
    if(isPlus){var v=document.createElementNS(ns,'path');v.setAttribute('d','M12 5v14');svg.appendChild(v);}
    return svg;
  }
  // ---- Lucide "x" close icon — two diagonals crossing at the viewBox centre (12,12), so a hover rotate() is centred ----
  function closeIcon(){
    var ns='http://www.w3.org/2000/svg';
    var svg=document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');
    svg.setAttribute('stroke-width','2');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
    var d=['M18 6 6 18','M6 6l12 12'];
    for(var i=0;i<d.length;i++){var pa=document.createElementNS(ns,'path');pa.setAttribute('d',d[i]);svg.appendChild(pa);}
    return svg;
  }
  // ---- enhance one mount ----
  function enhance(mount){
    if(mount.getAttribute('data-sw-enhanced')==='true'){return;}
    var cfg=readConfig(mount);
    var key='sw-cart:'+siteKey(mount);
    var items=load(key);
    var started=Date.now(); // for the /f time-trap (_elapsed must be >= the server minimum)
    var sent=false; // true after a successful form-channel submit → show the "order sent" panel

    var toggle=part('button','toggle');toggle.type='button';toggle.setAttribute('aria-label',cfg.toggleLabel);
    var tab=mk('span','sw-cart-tab');tab.appendChild(cartIcon());tab.appendChild(mk('span',null,cfg.toggleLabel));toggle.appendChild(tab);ripple(tab,true);
    var count=part('span','count');toggle.appendChild(count);

    var dialog=document.createElement('dialog');
    var head=part('div','head');var h=mk('h2',null,cfg.title);var close=part('button','close');close.type='button';close.setAttribute('aria-label','Close cart');close.appendChild(closeIcon());ripple(close);
    head.appendChild(h);head.appendChild(close);
    var list=part('ul','items');
    var empty=part('p','empty',cfg.emptyLabel);
    var foot=part('div','foot');
    var totalRow=part('div','total');var stLabel=mk('span',null,cfg.totalLabel);var stVal=mk('span',null,'');totalRow.appendChild(stLabel);totalRow.appendChild(stVal);
    var note=part('p','note',cfg.note);
    foot.appendChild(totalRow);foot.appendChild(note);
    // Channels: deep-link kinds (whatsapp/mailto/payment) render as a button; a "form" kind renders an
    // inline order form that POSTs to the resolved /f endpoint (the first form channel wins). A whatsapp/
    // mailto channel WITH configured "fields" renders a collapsible input form instead of firing on click.
    var formCh=null;
    for(var ci=0;ci<cfg.channels.length;ci++){
      var chx=cfg.channels[ci];
      if(chx.kind==='form'){if(!formCh){formCh=chx;}continue;}
      (function(ch){
        var b=part('button','channel',channelLabel(ch));b.type='button';b.className='btn btn-primary btn-block';ripple(b,true);
        var cf=(ch.kind==='whatsapp'||ch.kind==='mailto')?buildChannelForm(ch,b):null;
        if(cf){
          // The button toggles the field form; the form's own submit performs the order (after validation).
          b.setAttribute('aria-expanded','false');
          b.addEventListener('click',function(){
            var opening=cf.form.hidden;
            cf.form.hidden=!opening;
            b.setAttribute('aria-expanded',opening?'true':'false');
            if(opening){cf.open();}
          });
          foot.appendChild(b);foot.appendChild(cf.form);
        }else{
          b.addEventListener('click',function(){runChannel(ch,items,cfg);});
          foot.appendChild(b);
        }
      })(chx);
    }
    if(formCh&&formCh.endpoint){foot.appendChild(buildOrderForm(formCh));}
    var clear=part('button','clear',cfg.clearLabel);clear.type='button';ripple(clear);
    clear.addEventListener('click',function(){items.length=0;persist();});
    foot.appendChild(clear);
    // The post-order confirmation panel (form channel). Kept OUT of the foot (which hides when the cart
    // empties) so the success message stays visible after a submit clears the cart. Toggled in render().
    var sentMsg=part('p','sent-msg',cfg.sentLabel);
    dialog.appendChild(head);dialog.appendChild(empty);dialog.appendChild(list);dialog.appendChild(foot);dialog.appendChild(sentMsg);
    mount.appendChild(toggle);mount.appendChild(dialog);

    // A whatsapp/mailto channel WITH custom "fields": a collapsible inline form collecting the buyer
    // inputs, then opening the deep link with them appended as "Label: value" lines (see orderMessage).
    // Returns { form, open } or null when the channel declares no fields (then the button fires directly).
    // "toggleBtn" is the channel button that shows/hides this form — its aria-expanded is re-synced on
    // submit. Values flow through input .value into the (URL-encoded) deep link — never HTML; no new sink.
    function buildChannelForm(ch,toggleBtn){
      var fields=(ch&&ch.fields&&ch.fields.length)?ch.fields:null;
      if(!fields){return null;}
      var form=part('form','channel-form');form.hidden=true;
      var inputs=[];
      for(var i=0;i<fields.length;i++){
        (function(f){
          var label=clip(String(f&&f.label!=null?f.label:''),60);
          if(!label){return;}
          var t=(f&&(f.type==='textarea'||f.type==='tel'||f.type==='email'))?f.type:'text';
          var req=!!(f&&f.required);
          var wrap=part('label','order-field');wrap.appendChild(mk('span',null,req?(label+' *'):label));
          var inp=t==='textarea'?document.createElement('textarea'):document.createElement('input');
          if(t!=='textarea'){inp.type=t;}if(req){inp.required=true;}
          wrap.appendChild(inp);form.appendChild(wrap);
          inputs.push({label:label,req:req,inp:inp});
        })(fields[i]);
      }
      var submit=part('button','channel-submit',channelLabel(ch));submit.type='submit';submit.className='btn btn-primary btn-block';ripple(submit,true);
      var status=part('p','channel-status');
      form.appendChild(submit);form.appendChild(status);
      form.addEventListener('submit',function(e){
        e.preventDefault();
        if(!items.length){status.textContent='Your cart is empty.';return;}
        // Native (in-browser) validation governs required fields now (no novalidate): a required-but-empty
        // field blocks submit before this handler runs, so here we just collect the non-empty values.
        var values=[];
        for(var i=0;i<inputs.length;i++){
          var v=(inputs[i].inp.value||'').trim();
          if(v){values.push({label:inputs[i].label,value:v});}
        }
        runChannel(ch,items,cfg,values);
        // Collapse + re-sync the toggle's a11y state so it doesn't report "expanded" over a hidden form.
        form.hidden=true;status.textContent='';toggleBtn.setAttribute('aria-expanded','false');
      });
      return {form:form,open:function(){if(inputs[0]){inputs[0].inp.focus();}}};
    }

    // The "form" channel: an inline order form (contact fields) that POSTs name/email/phone/note +
    // cart_text + cart_json to the resolved /f endpoint — reusing the spam-guarded submission pipeline
    // (honeypot _hpt empty, _elapsed time-trap). No new sink: values go through value/JSON, never HTML.
    function buildOrderForm(ch){
      var form=part('form','order');
      function field(name,label,type,required){
        var wrap=part('label','order-field');wrap.appendChild(mk('span',null,label));
        var inp=type==='textarea'?document.createElement('textarea'):document.createElement('input');
        if(type!=='textarea'){inp.type=type;}inp.name=name;if(required){inp.required=true;}
        wrap.appendChild(inp);form.appendChild(wrap);return inp;
      }
      var nameI=field('name','Your name','text',true);
      var emailI=field('email','Email','email',true);
      var phoneI=field('phone','Phone (optional)','tel',false);
      var noteI=field('note','Note (optional)','textarea',false);
      var submit=part('button','order-submit',channelLabel(ch));submit.type='submit';submit.className='btn btn-primary btn-block';ripple(submit,true);
      var status=part('p','order-status');
      form.appendChild(submit);form.appendChild(status);
      form.addEventListener('submit',function(e){
        e.preventDefault();
        if(!items.length){return;}
        // Native validation already enforced the required name + email (+ email format) before submit.
        var payload={_hpt:'',_elapsed:String(Date.now()-started),name:nameI.value,email:emailI.value,phone:phoneI.value,note:noteI.value,cart_text:orderText(items,cfg),cart_json:cartJson(items)};
        submit.disabled=true;status.textContent='Sending\\u2026';
        fetch(ch.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}).then(function(res){
          if(!res.ok){throw new Error('bad status');}
          // Flip to the sent state BEFORE render() so the confirmation panel (not the now-empty cart)
          // is what shows; submit stays disabled (the form is hidden until a new item is added).
          sent=true;items.length=0;form.reset();status.textContent='';persist();
        }).catch(function(){status.textContent='Sorry, something went wrong. Please try again.';submit.disabled=false;});
      });
      return form;
    }

    function render(){
      var n=countOf(items);
      count.textContent=String(n);if(n>0){count.removeAttribute('hidden');}else{count.setAttribute('hidden','');}
      // Three drawer states: the order-sent confirmation (sent), the cart (items), or the empty notice.
      sentMsg.style.display=sent?'block':'none';
      empty.style.display=(!items.length&&!sent)?'block':'none';
      list.style.display=(items.length&&!sent)?'block':'none';
      foot.style.display=(items.length&&!sent)?'block':'none';
      // rebuild the list (textContent only)
      while(list.firstChild){list.removeChild(list.firstChild);}
      for(var i=0;i<items.length;i++){
        (function(it){
          var li=part('li','line');
          // Optional product thumbnail (only when the item carries an image URL; src via setAttribute, never HTML).
          if(it.image){var thumb=part('div','thumb');var img=document.createElement('img');img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=function(){if(thumb.parentNode){thumb.parentNode.removeChild(thumb);}};img.src=it.image;thumb.appendChild(img);li.appendChild(thumb);}
          var body=part('div','line-body');
          body.appendChild(part('div','line-name',it.name));
          // One controls row under the title: base price, qty stepper, remove (trash), then the line subtotal.
          var row=part('div','line-controls');
          var pr=part('span','line-price',money(it.price,cfg));
          var ctrl=part('div','qty');
          var minus=mk('button');minus.type='button';minus.setAttribute('aria-label','Decrease quantity');minus.appendChild(signIcon(false));ripple(minus);
          var qv=mk('span',null,String(it.qty));
          var plus=mk('button');plus.type='button';plus.setAttribute('aria-label','Increase quantity');plus.appendChild(signIcon(true));ripple(plus);
          minus.addEventListener('click',function(){it.qty-=1;if(it.qty<1){removeSku(it.sku);}persist();});
          plus.addEventListener('click',function(){if(it.qty<MAX_QTY){it.qty+=1;}persist();});
          ctrl.appendChild(minus);ctrl.appendChild(qv);ctrl.appendChild(plus);
          var rm=part('button','remove');rm.type='button';rm.setAttribute('aria-label','Remove');rm.appendChild(trashIcon());ripple(rm);
          rm.addEventListener('click',function(){removeSku(it.sku);persist();});
          var sub=part('span','line-subtotal',money(lineTotal(it,cfg),cfg));
          row.appendChild(pr);row.appendChild(ctrl);row.appendChild(rm);row.appendChild(sub);
          body.appendChild(row);li.appendChild(body);
          list.appendChild(li);
        })(items[i]);
      }
      stVal.textContent=money(totalOf(items,cfg),cfg);
    }
    function persist(){save(key,items);render();}
    function removeSku(sku){for(var i=0;i<items.length;i++){if(items[i].sku===sku){items.splice(i,1);return;}}}
    function add(btn){
      sent=false; // a new item returns the drawer from the sent-confirmation back to the cart
      var sku=btn.getAttribute('data-sku')||btn.getAttribute('data-name');if(!sku){return;}
      var price=Number(btn.getAttribute('data-price'));if(!isFinite(price)||price<0){price=0;}
      var existing=null;for(var i=0;i<items.length;i++){if(items[i].sku===sku){existing=items[i];break;}}
      if(existing){if(existing.qty<MAX_QTY){existing.qty+=1;}}
      else{if(items.length>=MAX_LINES){return;}items.push({sku:String(sku).slice(0,200),name:(btn.getAttribute('data-name')||sku).slice(0,300),price:price,image:(btn.getAttribute('data-image')||'').slice(0,2048),qty:1});}
      persist();
      // Feedback WITHOUT interrupting browsing (so multiple items can be added in a row): pulse the
      // button, bump the floating cart, and update its count badge (in render()). The cart toggle is
      // the affordance to open the drawer + check out — we don't pop a modal on every add.
      btn.setAttribute('data-sw-added','true');setTimeout(function(){btn.removeAttribute('data-sw-added');},800);
      toggle.setAttribute('data-sw-bump','1');setTimeout(function(){toggle.removeAttribute('data-sw-bump');},400);
      // PULSE halo: remove + force reflow + re-set so the ::after animation RESTARTS on every add (even
      // rapid repeat adds within the .6s window); the end state is opacity:0 so leaving it set is invisible.
      toggle.removeAttribute('data-sw-pulse');void toggle.offsetWidth;toggle.setAttribute('data-sw-pulse','1');
    }

    // Lock PAGE scroll while the drawer is open (the modal <dialog> traps focus but does not stop the
    // page behind from scrolling). Guarded + idempotent; restores the prior inline overflow on close.
    var scrollLocked=false,prevOverflow='';
    function lockScroll(){if(scrollLocked){return;}scrollLocked=true;prevOverflow=document.documentElement.style.overflow;document.documentElement.style.overflow='hidden';}
    function unlockScroll(){if(!scrollLocked){return;}scrollLocked=false;document.documentElement.style.overflow=prevOverflow;}
    function closeDrawer(){if(dialog.close){dialog.close();}else{dialog.removeAttribute('open');unlockScroll();}}
    // Open first, THEN lock scroll — so a throwing showModal() (e.g. sandboxed iframe) can't strand overflow:hidden.
    toggle.addEventListener('click',function(){if(typeof dialog.showModal==='function'){dialog.showModal();}else{dialog.setAttribute('open','');}lockScroll();});
    close.addEventListener('click',closeDrawer);
    // 'close' fires for Esc + dialog.close() (button/backdrop) → always restore scroll there.
    dialog.addEventListener('close',unlockScroll);
    // Only the BACKDROP closes on a click — a click on the drawer's own empty space must NOT. A native
    // <dialog> reports e.target===dialog for both, so distinguish by the point being outside the panel
    // rect. (Esc still closes natively; both paths trigger the slide-out via the CSS transition.)
    dialog.addEventListener('click',function(e){
      if(e.target!==dialog){return;}
      var r=dialog.getBoundingClientRect();
      if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom){closeDrawer();}
    });
    q('[data-sw-cart-add]').forEach(function(btn){btn.addEventListener('click',function(e){e.preventDefault();add(btn);});});

    mount.setAttribute('data-sw-enhanced','true');
    render();
  }
  function init(){
    // Enhance a SINGLE mount (config is identical across mounts — all read website.shop), so a page
    // that has {{sw-cart}} both inline and in the footer slot still shows one cart, not two.
    var mount=q('[data-sw-cart]')[0];
    if(!mount&&q('[data-sw-cart-add]').length){mount=document.createElement('div');mount.setAttribute('data-sw-cart','');document.body.appendChild(mount);}
    if(mount){enhance(mount);}
  }
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;

/** Whether an authored HTML/template string uses the mini-shop cart (the {{sw-cart}}/{{sw-add-to-cart}} helpers or the rendered markers). */
export function usesCart(html: string | null | undefined): boolean {
  return typeof html === 'string' && hasCartMarker(html);
}

/**
 * Resolve the submission endpoint for every `form` shop channel — the cart cannot build
 * `/f/<projectId>/<formId>` client-side, so the publish/preview render projection fills `endpoint` here
 * from `formEndpoint(formId)`. Returns a shallow copy; non-form channels and an absent/channel-less shop
 * pass through unchanged. Pure — no side effects. Call when projecting `website.shop` into a render ctx.
 */
export function resolveShopChannels(
  shop: unknown,
  formEndpoint: (formId: string) => string,
): unknown {
  if (!shop || typeof shop !== 'object' || Array.isArray(shop)) return shop;
  const s = shop as Record<string, unknown>;
  if (!Array.isArray(s.channels)) return shop;
  const channels = (s.channels as Array<Record<string, unknown>>).map((c) => {
    if (c && typeof c === 'object' && c.kind === 'form' && typeof c.formId === 'string') {
      return { ...c, endpoint: formEndpoint(c.formId) };
    }
    return c;
  });
  return { ...s, channels };
}
