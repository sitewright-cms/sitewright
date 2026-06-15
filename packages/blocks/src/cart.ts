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
 */
export const CART_CSS = [
  '[data-sw-cart]{display:none}',
  '[data-sw-cart][data-sw-enhanced="true"]{display:block}',
  // Floating toggle button (bottom-right) with an item-count badge. position/overflow are !important so
  // the generic `.waves-effect` rule below (position:relative; overflow:hidden) can't unpin the floating
  // toggle or clip its count badge.
  '[data-sw-cart] [data-sw-part="toggle"]{position:fixed !important;overflow:visible !important;right:1rem;bottom:1rem;z-index:9997;display:flex;align-items:center;justify-content:center;width:3.25rem;height:3.25rem;border:0;border-radius:9999px;background:var(--sw-color-primary,#0a7a5a);color:#fff;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);transition:transform .15s ease,box-shadow .15s ease}',
  '[data-sw-cart] [data-sw-part="toggle"] svg{width:1.5rem;height:1.5rem}',
  '[data-sw-cart] [data-sw-part="count"]{position:absolute;top:-.25rem;right:-.25rem;min-width:1.25rem;height:1.25rem;padding:0 .25rem;border-radius:9999px;background:#b00020;color:#fff;font-size:.75rem;line-height:1.25rem;text-align:center}',
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
  '[data-sw-cart] dialog{position:fixed;inset:0 0 0 auto;margin:0;width:min(92vw,24rem);max-width:100vw;max-height:100vh;max-height:100dvh;border:0;padding:0;background:#fff;box-shadow:-8px 0 32px rgba(0,0,0,.25);transform:translateX(100%);transition:transform .3s cubic-bezier(.4,0,.2,1),overlay .3s allow-discrete,display .3s allow-discrete}',
  // flex/height live on [open] ONLY — a closed <dialog> must keep its UA display:none (else it renders
  // off-screen but counts as visible). When open it is a full-height vertical flex column.
  '[data-sw-cart] dialog[open]{transform:translateX(0);height:100vh;height:100dvh;display:flex;flex-direction:column}',
  '@starting-style{[data-sw-cart] dialog[open]{transform:translateX(100%)}}',
  '[data-sw-cart] dialog::backdrop{background:rgba(0,0,0,.35);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);opacity:0;transition:opacity .3s ease,overlay .3s allow-discrete,display .3s allow-discrete}',
  '[data-sw-cart] dialog[open]::backdrop{opacity:1}',
  '@starting-style{[data-sw-cart] dialog[open]::backdrop{opacity:0}}',
  '@media (prefers-reduced-motion:reduce){[data-sw-cart] dialog,[data-sw-cart] dialog::backdrop{transition:none}}',
  '[data-sw-cart] [data-sw-part="head"]{flex:none;display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid rgba(0,0,0,.12)}',
  '[data-sw-cart] [data-sw-part="head"] h2{margin:0;font-size:1.125rem}',
  '[data-sw-cart] [data-sw-part="close"]{border:0;background:none;font-size:1.5rem;line-height:1;cursor:pointer}',
  // The items list FILLS the space between the fixed head and foot (flex:1) and scrolls when it overflows.
  // min-height:0 lets a flex item shrink below its content height so overflow-y actually scrolls (the
  // default min-height:auto would otherwise blow the drawer past 100vh on a long cart). This replaces a
  // fragile `max-height:calc(100% - 16rem)` magic constant that left a dead gap on a short cart.
  '[data-sw-cart] [data-sw-part="items"]{list-style:none;margin:0;padding:.5rem 1.25rem;flex:1 1 auto;min-height:0;overflow-y:auto}',
  '[data-sw-cart] [data-sw-part="line"]{display:grid;grid-template-columns:1fr auto;gap:.25rem .75rem;align-items:center;padding:.75rem 0;border-bottom:1px solid rgba(0,0,0,.08)}',
  '[data-sw-cart] [data-sw-part="line-name"]{font-weight:600}',
  '[data-sw-cart] [data-sw-part="line-price"]{color:rgba(0,0,0,.6);font-size:.875rem}',
  '[data-sw-cart] [data-sw-part="qty"]{display:flex;align-items:center;gap:.5rem}',
  '[data-sw-cart] [data-sw-part="qty"] button{width:1.75rem;height:1.75rem;border:1px solid rgba(0,0,0,.2);border-radius:.375rem;background:#fff;cursor:pointer;font-size:1rem;line-height:1}',
  '[data-sw-cart] [data-sw-part="remove"]{border:0;background:none;color:#b00020;cursor:pointer;font-size:.875rem}',
  '[data-sw-cart] [data-sw-part="empty"]{padding:2rem 1.25rem;color:rgba(0,0,0,.6);text-align:center}',
  // The foot is a fixed-size flex item; the list (flex:1) above it consumes the free space, so the foot
  // pins to the bottom without needing `margin-top:auto`. flex:none → it never shrinks the checkout area.
  '[data-sw-cart] [data-sw-part="foot"]{flex:none;padding:1rem 1.25rem;border-top:1px solid rgba(0,0,0,.12)}',
  '[data-sw-cart] [data-sw-part="subtotal"]{display:flex;justify-content:space-between;font-weight:700;margin-bottom:.25rem}',
  '[data-sw-cart] [data-sw-part="note"]{font-size:.75rem;color:rgba(0,0,0,.55);margin:.25rem 0 .75rem}',
  '[data-sw-cart] [data-sw-part="channel"]{display:block;width:100%;border:0;border-radius:.375rem;padding:.625rem 1rem;margin-top:.5rem;background:var(--sw-color-primary,#0a7a5a);color:#fff;cursor:pointer;text-align:center;font:inherit;transition:filter .15s ease}',
  '[data-sw-cart] [data-sw-part="clear"]{display:block;width:100%;border:0;background:none;color:rgba(0,0,0,.55);cursor:pointer;margin-top:.5rem;font-size:.875rem}',
  // Inline order form (the `form` channel).
  '[data-sw-cart] [data-sw-part="order"]{margin-top:.75rem}',
  '[data-sw-cart] [data-sw-part="order-field"]{display:block;margin-bottom:.5rem;font-size:.8125rem}',
  '[data-sw-cart] [data-sw-part="order-field"]>span{display:block;margin-bottom:.15rem}',
  '[data-sw-cart] [data-sw-part="order-field"] input,[data-sw-cart] [data-sw-part="order-field"] textarea{width:100%;padding:.4rem .5rem;border:1px solid rgba(0,0,0,.2);border-radius:.375rem;font:inherit}',
  '[data-sw-cart] [data-sw-part="order-submit"]{display:block;width:100%;border:0;border-radius:.375rem;padding:.5rem 1rem;margin-top:.25rem;background:var(--sw-color-primary,#0a7a5a);color:#fff;cursor:pointer;font:inherit;transition:filter .15s ease}',
  '[data-sw-cart] [data-sw-part="order-submit"][disabled]{opacity:.6;cursor:progress}',
  '[data-sw-cart] [data-sw-part="order-status"]{margin:.5rem 0 0;font-size:.8125rem}',
  // Collapsible per-channel input form (whatsapp/mailto with custom fields). Reuses the order-field
  // input styling above; hidden until the channel button toggles it open.
  '[data-sw-cart] [data-sw-part="channel-form"]{margin:.25rem 0;padding:.625rem .75rem;border:1px solid rgba(0,0,0,.12);border-radius:.375rem;background:rgba(0,0,0,.02)}',
  '[data-sw-cart] [data-sw-part="channel-form"][hidden]{display:none}',
  '[data-sw-cart] [data-sw-part="channel-submit"]{display:block;width:100%;border:0;border-radius:.375rem;padding:.5rem 1rem;margin-top:.25rem;background:var(--sw-color-primary,#0a7a5a);color:#fff;cursor:pointer;font:inherit;transition:filter .15s ease}',
  '[data-sw-cart] [data-sw-part="channel-submit"]:hover{filter:brightness(.92)}',
  '[data-sw-cart] [data-sw-part="channel-status"]{margin:.4rem 0 0;font-size:.8125rem;color:#b00020}',
  '[data-sw-cart] [data-sw-part="sent-msg"]{padding:1.5rem 1.25rem;text-align:center;color:var(--sw-color-primary,#0a7a5a);font-weight:600}',
  // The "added" pulse on an add-to-cart button (runtime toggles data-sw-added briefly).
  '[data-sw-cart-add][data-sw-added="true"]{opacity:.7}',
  // A brief "bump" on the floating cart when an item is added — the non-interrupting add feedback.
  '@keyframes sw-cart-bump{0%,100%{transform:none}30%{transform:scale(1.15)}}',
  '[data-sw-cart] [data-sw-part="toggle"][data-sw-bump]{animation:sw-cart-bump .4s ease}',
  // Hover affordances on the interactive controls.
  '[data-sw-cart] [data-sw-part="toggle"]:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 12px 30px rgba(0,0,0,.32)}',
  '[data-sw-cart] [data-sw-part="channel"]:hover,[data-sw-cart] [data-sw-part="order-submit"]:hover{filter:brightness(.92)}',
  '[data-sw-cart] [data-sw-part="close"]{transition:color .15s ease,transform .15s ease}',
  '[data-sw-cart] [data-sw-part="close"]:hover{color:#b00020;transform:rotate(90deg)}',
  '[data-sw-cart] [data-sw-part="qty"] button{transition:background .15s ease,border-color .15s ease}',
  '[data-sw-cart] [data-sw-part="qty"] button:hover{background:rgba(0,0,0,.06);border-color:rgba(0,0,0,.35)}',
  '[data-sw-cart] [data-sw-part="clear"]:hover{color:rgba(0,0,0,.8);text-decoration:underline}',
  '[data-sw-cart] [data-sw-part="remove"]:hover{text-decoration:underline}',
  // Self-contained "waves" ripple (the platform ripple runtime only enhances elements present at load,
  // so the runtime-built cart wires its own — scoped to the cart so it never double-binds page buttons).
  '[data-sw-cart] .waves-effect{position:relative;overflow:hidden;-webkit-tap-highlight-color:transparent}',
  '[data-sw-cart] .waves-ripple{position:absolute;border-radius:50%;pointer-events:none;background:rgba(0,0,0,.18);transform:scale(0);opacity:.5;will-change:transform,opacity}',
  '[data-sw-cart] .waves-light .waves-ripple{background:rgba(255,255,255,.5)}',
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
    return {
      symbol:mount.getAttribute('data-currency-symbol')||'',
      code:mount.getAttribute('data-currency-code')||'',
      pos:mount.getAttribute('data-currency-pos')==='after'?'after':'before',
      decimals:d,
      title:mount.getAttribute('data-cart-title')||'Your cart',
      addedLabel:mount.getAttribute('data-added-label')||'Added',
      note:mount.getAttribute('data-note')||'Prices are indicative. This sends an order request \\u2014 the seller confirms availability and final price.',
      emptyLabel:mount.getAttribute('data-empty-label')||'Your cart is empty.',
      subtotalLabel:mount.getAttribute('data-subtotal-label')||'Subtotal',
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
  // ---- enhance one mount ----
  function enhance(mount){
    if(mount.getAttribute('data-sw-enhanced')==='true'){return;}
    var cfg=readConfig(mount);
    var key='sw-cart:'+siteKey(mount);
    var items=load(key);
    var started=Date.now(); // for the /f time-trap (_elapsed must be >= the server minimum)
    var sent=false; // true after a successful form-channel submit → show the "order sent" panel

    var toggle=part('button','toggle');toggle.type='button';toggle.setAttribute('aria-label','Open cart');ripple(toggle,true);
    toggle.appendChild(cartIcon());
    var count=part('span','count');toggle.appendChild(count);

    var dialog=document.createElement('dialog');
    var head=part('div','head');var h=mk('h2',null,cfg.title);var close=part('button','close','\\u00d7');close.type='button';close.setAttribute('aria-label','Close cart');ripple(close);
    head.appendChild(h);head.appendChild(close);
    var list=part('ul','items');
    var empty=part('p','empty',cfg.emptyLabel);
    var foot=part('div','foot');
    var subtotal=part('div','subtotal');var stLabel=mk('span',null,cfg.subtotalLabel);var stVal=mk('span',null,'');subtotal.appendChild(stLabel);subtotal.appendChild(stVal);
    var note=part('p','note',cfg.note);
    foot.appendChild(subtotal);foot.appendChild(note);
    // Channels: deep-link kinds (whatsapp/mailto/payment) render as a button; a "form" kind renders an
    // inline order form that POSTs to the resolved /f endpoint (the first form channel wins). A whatsapp/
    // mailto channel WITH configured "fields" renders a collapsible input form instead of firing on click.
    var formCh=null;
    for(var ci=0;ci<cfg.channels.length;ci++){
      var chx=cfg.channels[ci];
      if(chx.kind==='form'){if(!formCh){formCh=chx;}continue;}
      (function(ch){
        var b=part('button','channel',channelLabel(ch));b.type='button';ripple(b,true);
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
      var form=part('form','channel-form');form.setAttribute('novalidate','');form.hidden=true;
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
      var submit=part('button','channel-submit',channelLabel(ch));submit.type='submit';ripple(submit,true);
      var status=part('p','channel-status');
      form.appendChild(submit);form.appendChild(status);
      form.addEventListener('submit',function(e){
        e.preventDefault();
        if(!items.length){status.textContent='Your cart is empty.';return;}
        var values=[];var missing=[];
        for(var i=0;i<inputs.length;i++){
          var v=(inputs[i].inp.value||'').trim();
          if(inputs[i].req&&!v){missing.push(inputs[i].label);continue;}
          if(v){values.push({label:inputs[i].label,value:v});}
        }
        if(missing.length){status.textContent='Please fill in: '+missing.join(', ');return;}
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
      var form=part('form','order');form.setAttribute('novalidate','');
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
      var submit=part('button','order-submit',channelLabel(ch));submit.type='submit';ripple(submit,true);
      var status=part('p','order-status');
      form.appendChild(submit);form.appendChild(status);
      form.addEventListener('submit',function(e){
        e.preventDefault();
        if(!items.length){return;}
        if(!nameI.value||!emailI.value){status.textContent='Please enter your name and email.';return;}
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
          var info=mk('div');var nm=part('div','line-name',it.name);var pr=part('div','line-price',money(it.price,cfg)+' each');
          info.appendChild(nm);info.appendChild(pr);
          var ctrl=part('div','qty');
          var minus=mk('button',null,'\\u2212');minus.type='button';minus.setAttribute('aria-label','Decrease quantity');ripple(minus);
          var qv=mk('span',null,String(it.qty));
          var plus=mk('button',null,'+');plus.type='button';plus.setAttribute('aria-label','Increase quantity');ripple(plus);
          minus.addEventListener('click',function(){it.qty-=1;if(it.qty<1){removeSku(it.sku);}persist();});
          plus.addEventListener('click',function(){if(it.qty<MAX_QTY){it.qty+=1;}persist();});
          ctrl.appendChild(minus);ctrl.appendChild(qv);ctrl.appendChild(plus);
          var rm=part('button','remove','Remove');rm.type='button';ripple(rm);
          rm.addEventListener('click',function(){removeSku(it.sku);persist();});
          li.appendChild(info);li.appendChild(ctrl);li.appendChild(rm);
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
    }

    function closeDrawer(){if(dialog.close){dialog.close();}else{dialog.removeAttribute('open');}}
    toggle.addEventListener('click',function(){if(typeof dialog.showModal==='function'){dialog.showModal();}else{dialog.setAttribute('open','');}});
    close.addEventListener('click',closeDrawer);
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
