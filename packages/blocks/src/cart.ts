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
import { walk } from '@sitewright/core';
import type { PageNode } from '@sitewright/schema';

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
  // Floating toggle button (bottom-right) with an item-count badge.
  '[data-sw-cart] [data-sw-part="toggle"]{position:fixed;right:1rem;bottom:1rem;z-index:9997;display:flex;align-items:center;justify-content:center;width:3.25rem;height:3.25rem;border:0;border-radius:9999px;background:var(--sw-color-primary,#0a7a5a);color:#fff;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)}',
  '[data-sw-cart] [data-sw-part="toggle"] svg{width:1.5rem;height:1.5rem}',
  '[data-sw-cart] [data-sw-part="count"]{position:absolute;top:-.25rem;right:-.25rem;min-width:1.25rem;height:1.25rem;padding:0 .25rem;border-radius:9999px;background:#b00020;color:#fff;font-size:.75rem;line-height:1.25rem;text-align:center}',
  '[data-sw-cart] [data-sw-part="count"][hidden]{display:none}',
  // Drawer (native <dialog> → focus trap + Esc + ::backdrop for free).
  '[data-sw-cart] dialog{position:fixed;top:0;right:0;margin:0;height:100%;max-height:100%;width:min(92vw,24rem);border:0;padding:0;background:#fff;box-shadow:-8px 0 32px rgba(0,0,0,.2)}',
  '[data-sw-cart] dialog::backdrop{background:rgba(0,0,0,.5)}',
  '[data-sw-cart] [data-sw-part="head"]{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid rgba(0,0,0,.12)}',
  '[data-sw-cart] [data-sw-part="head"] h2{margin:0;font-size:1.125rem}',
  '[data-sw-cart] [data-sw-part="close"]{border:0;background:none;font-size:1.5rem;line-height:1;cursor:pointer}',
  '[data-sw-cart] [data-sw-part="items"]{list-style:none;margin:0;padding:.5rem 1.25rem;overflow-y:auto;max-height:calc(100% - 16rem)}',
  '[data-sw-cart] [data-sw-part="line"]{display:grid;grid-template-columns:1fr auto;gap:.25rem .75rem;align-items:center;padding:.75rem 0;border-bottom:1px solid rgba(0,0,0,.08)}',
  '[data-sw-cart] [data-sw-part="line-name"]{font-weight:600}',
  '[data-sw-cart] [data-sw-part="line-price"]{color:rgba(0,0,0,.6);font-size:.875rem}',
  '[data-sw-cart] [data-sw-part="qty"]{display:flex;align-items:center;gap:.5rem}',
  '[data-sw-cart] [data-sw-part="qty"] button{width:1.75rem;height:1.75rem;border:1px solid rgba(0,0,0,.2);border-radius:.375rem;background:#fff;cursor:pointer;font-size:1rem;line-height:1}',
  '[data-sw-cart] [data-sw-part="remove"]{border:0;background:none;color:#b00020;cursor:pointer;font-size:.875rem}',
  '[data-sw-cart] [data-sw-part="empty"]{padding:2rem 1.25rem;color:rgba(0,0,0,.6);text-align:center}',
  '[data-sw-cart] [data-sw-part="foot"]{padding:1rem 1.25rem;border-top:1px solid rgba(0,0,0,.12)}',
  '[data-sw-cart] [data-sw-part="subtotal"]{display:flex;justify-content:space-between;font-weight:700;margin-bottom:.25rem}',
  '[data-sw-cart] [data-sw-part="note"]{font-size:.75rem;color:rgba(0,0,0,.55);margin:.25rem 0 .75rem}',
  '[data-sw-cart] [data-sw-part="channel"]{display:block;width:100%;border:0;border-radius:.375rem;padding:.625rem 1rem;margin-top:.5rem;background:var(--sw-color-primary,#0a7a5a);color:#fff;cursor:pointer;text-align:center;font:inherit}',
  '[data-sw-cart] [data-sw-part="clear"]{display:block;width:100%;border:0;background:none;color:rgba(0,0,0,.55);cursor:pointer;margin-top:.5rem;font-size:.875rem}',
  // The "added" pulse on an add-to-cart button (runtime toggles data-sw-added briefly).
  '[data-sw-cart-add][data-sw-added="true"]{opacity:.7}',
].join('');

// The runtime. ES5-style (var / function) — served raw, never transpiled, like the other
// component bundles. Built with createElement + textContent; no innerHTML of cart data.
export const CART_JS = `(function(){
  'use strict';
  var MAX_LINES=50, MAX_QTY=99;
  function q(sel,root){return Array.prototype.slice.call((root||document).querySelectorAll(sel));}
  function mk(tag,cls,txt){var n=document.createElement(tag);if(cls){n.className=cls;}if(txt!=null){n.textContent=txt;}return n;}
  function part(tag,name,txt){var n=mk(tag,null,txt);n.setAttribute('data-sw-part',name);return n;}
  // ---- per-site storage key: this script's own directory (stable site-wide, unique per site) ----
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
  function countOf(items){var n=0;for(var i=0;i<items.length;i++){n+=items[i].qty;}return n;}
  // ---- order summary (plain text, used by the deep-link channels) ----
  function orderText(items,cfg){
    var lines=[];
    for(var i=0;i<items.length;i++){var it=items[i];lines.push(it.qty+' x '+it.name+' ('+money(it.price,cfg)+') = '+money(it.price*it.qty,cfg));}
    lines.push('Total: '+money(totalOf(items,cfg),cfg));
    return lines.join('\\n');
  }
  function itemsSummary(items){var p=[];for(var i=0;i<items.length;i++){p.push(items[i].qty+'x '+items[i].name);}return p.join(', ');}
  // ---- channel execution ----
  function runChannel(ch,items,cfg){
    if(!items.length){return;}
    var text=orderText(items,cfg);
    if(ch.kind==='whatsapp'){
      var num=String(ch.number||'').replace(/[^0-9]/g,'');if(!num){return;}
      var msg=(ch.intro?ch.intro+'\\n\\n':'')+text;
      window.open('https://wa.me/'+num+'?text='+encodeURIComponent(msg),'_blank','noopener');
    }else if(ch.kind==='mailto'){
      if(!ch.email){return;}
      var subj=encodeURIComponent(ch.subject||'Order');
      window.location.href='mailto:'+ch.email+'?subject='+subj+'&body='+encodeURIComponent(text);
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
    return 'Send order';
  }
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

    var toggle=part('button','toggle');toggle.type='button';toggle.setAttribute('aria-label','Open cart');
    toggle.appendChild(cartIcon());
    var count=part('span','count');toggle.appendChild(count);

    var dialog=document.createElement('dialog');
    var head=part('div','head');var h=mk('h2',null,cfg.title);var close=part('button','close','\\u00d7');close.type='button';close.setAttribute('aria-label','Close cart');
    head.appendChild(h);head.appendChild(close);
    var list=part('ul','items');
    var empty=part('p','empty','Your cart is empty.');
    var foot=part('div','foot');
    var subtotal=part('div','subtotal');var stLabel=mk('span',null,'Subtotal');var stVal=mk('span',null,'');subtotal.appendChild(stLabel);subtotal.appendChild(stVal);
    var note=part('p','note','Prices are indicative. This sends an order request \\u2014 the seller confirms availability and final price.');
    foot.appendChild(subtotal);foot.appendChild(note);
    // channel buttons
    for(var ci=0;ci<cfg.channels.length;ci++){
      (function(ch){
        var b=part('button','channel',channelLabel(ch));b.type='button';
        b.addEventListener('click',function(){runChannel(ch,items,cfg);});
        foot.appendChild(b);
      })(cfg.channels[ci]);
    }
    var clear=part('button','clear','Clear cart');clear.type='button';
    clear.addEventListener('click',function(){items.length=0;persist();});
    foot.appendChild(clear);
    dialog.appendChild(head);dialog.appendChild(empty);dialog.appendChild(list);dialog.appendChild(foot);
    mount.appendChild(toggle);mount.appendChild(dialog);

    function render(){
      var n=countOf(items);
      count.textContent=String(n);if(n>0){count.removeAttribute('hidden');}else{count.setAttribute('hidden','');}
      empty.style.display=items.length?'none':'block';
      list.style.display=items.length?'block':'none';
      foot.style.display=items.length?'block':'none';
      // rebuild the list (textContent only)
      while(list.firstChild){list.removeChild(list.firstChild);}
      for(var i=0;i<items.length;i++){
        (function(it){
          var li=part('li','line');
          var info=mk('div');var nm=part('div','line-name',it.name);var pr=part('div','line-price',money(it.price,cfg)+' each');
          info.appendChild(nm);info.appendChild(pr);
          var ctrl=part('div','qty');
          var minus=mk('button',null,'\\u2212');minus.type='button';minus.setAttribute('aria-label','Decrease quantity');
          var qv=mk('span',null,String(it.qty));
          var plus=mk('button',null,'+');plus.type='button';plus.setAttribute('aria-label','Increase quantity');
          minus.addEventListener('click',function(){it.qty-=1;if(it.qty<1){removeSku(it.sku);}persist();});
          plus.addEventListener('click',function(){if(it.qty<MAX_QTY){it.qty+=1;}persist();});
          ctrl.appendChild(minus);ctrl.appendChild(qv);ctrl.appendChild(plus);
          var rm=part('button','remove','Remove');rm.type='button';
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
      var sku=btn.getAttribute('data-sku')||btn.getAttribute('data-name');if(!sku){return;}
      var price=Number(btn.getAttribute('data-price'));if(!isFinite(price)||price<0){price=0;}
      var existing=null;for(var i=0;i<items.length;i++){if(items[i].sku===sku){existing=items[i];break;}}
      if(existing){if(existing.qty<MAX_QTY){existing.qty+=1;}}
      else{if(items.length>=MAX_LINES){return;}items.push({sku:String(sku).slice(0,200),name:(btn.getAttribute('data-name')||sku).slice(0,300),price:price,image:(btn.getAttribute('data-image')||'').slice(0,2048),qty:1});}
      persist();
      // brief visual ack + open the drawer
      btn.setAttribute('data-sw-added','true');setTimeout(function(){btn.removeAttribute('data-sw-added');},800);
    }

    toggle.addEventListener('click',function(){if(typeof dialog.showModal==='function'){dialog.showModal();}else{dialog.setAttribute('open','');}});
    close.addEventListener('click',function(){dialog.close&&dialog.close();dialog.removeAttribute('open');});
    dialog.addEventListener('click',function(e){if(e.target===dialog){dialog.close&&dialog.close();}});
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

/** Whether a block tree uses the cart — any node with a string prop carrying the marker (raw Html embed). */
export function treeUsesCart(root: PageNode): boolean {
  let found = false;
  walk(root, (node) => {
    if (found || !node.props) return;
    for (const value of Object.values(node.props)) {
      if (typeof value === 'string' && hasCartMarker(value)) {
        found = true;
        return;
      }
    }
  });
  return found;
}
