/**
 * ORDER STATUS — the thank-you page's runtime.
 *
 * ★★ THE PAGE MUST BE COMPLETE WITHOUT THIS SCRIPT. A buyer has just paid; a page that is blank
 * until a fetch resolves is blank on a flaky connection, at the single worst moment to show someone
 * nothing. So the author's own thank-you copy renders server-side and stands alone, and everything
 * here only ENRICHES it: the order number, the totals, the lines, the payment state.
 *
 * ★ And it is DISPLAY ONLY. The buyer's return from the provider is a navigation they can forge, so
 * nothing here treats arriving on this page as evidence of payment — the status comes from the
 * platform, over `window.__swt`, and that is the only thing believed.
 */

/** Marker the `{{sw-order-status}}` helper emits; the runtime ships only when a page carries it. */
export const ORDER_STATUS_MARKER = 'data-sw-order-status';

/** Parts an authored thank-you panel can declare, filled with textContent only. */
export const ORDER_STATUS_PARTS = Object.freeze({
  /** Shown while the status is being fetched; removed either way. */
  pending: 'status-pending',
  /** Shown when the payment is confirmed. */
  paid: 'status-paid',
  /** Shown when the provider says it failed, was cancelled or expired. */
  failed: 'status-failed',
  /** Shown when the platform has no answer yet — the provider has not reported. */
  unknown: 'status-unknown',
  /** Container the order summary is written into. */
  summary: 'status-summary',
  /** One line's template, cloned per line. */
  lineTemplate: 'status-line-template',
  /** Where the grand total goes. */
  total: 'status-total',
} as const);

export function usesOrderStatus(html: string | null | undefined): boolean {
  return typeof html === 'string' && (html.includes(ORDER_STATUS_MARKER) || html.includes('sw-order-status'));
}

export const ORDER_STATUS_JS = `(function(){
  function q(sel,root){return Array.prototype.slice.call((root||document).querySelectorAll(sel));}
  function part(root,name){return root.querySelector('[data-sw-part="'+name+'"]');}
  function show(el,on){if(el){el.style.display=on?'':'none';}}

  // The token the provider's return URL carried, else the one the cart persisted before redirecting.
  // Reading the URL first matters: a buyer may open the thank-you page in a different tab or after
  // clearing storage, and the link they were sent is the more reliable of the two.
  function tokenFor(mount){
    try{
      var fromUrl=new URL(window.location.href).searchParams.get('t');
      if(fromUrl){return fromUrl;}
    }catch(e){}
    var key=mount.getAttribute('data-cart-key');
    if(key){try{return localStorage.getItem(key+':txn')||'';}catch(e){}}
    try{
      // Fall back to any cart key this origin holds — a site with one shop has exactly one.
      for(var i=0;i<localStorage.length;i++){
        var k=localStorage.key(i);
        if(k&&k.indexOf('sw-cart:')===0&&k.slice(-4)===':txn'){return localStorage.getItem(k)||'';}
      }
    }catch(e){}
    return '';
  }

  function money(v){return String(v==null?'':v);}

  function fill(mount,txn){
    var paid=txn&&txn.status==='paid';
    var dead=txn&&(txn.status==='failed'||txn.status==='cancelled'||txn.status==='expired');
    show(part(mount,'status-pending'),false);
    show(part(mount,'status-paid'),!!paid);
    show(part(mount,'status-failed'),!!dead);
    show(part(mount,'status-unknown'),!!txn&&!paid&&!dead);
    if(!txn){show(part(mount,'status-unknown'),true);return;}

    var summary=part(mount,'status-summary');
    var tpl=part(mount,'status-line-template');
    if(summary&&tpl&&tpl.content){
      while(summary.firstChild){summary.removeChild(summary.firstChild);}
      var lines=txn.lines||[];
      for(var i=0;i<lines.length;i++){
        var frag=tpl.content.cloneNode(true);
        var n=frag.querySelector('[data-sw-field="name"]');if(n){n.textContent=lines[i].name;}
        var qf=frag.querySelector('[data-sw-field="qty"]');if(qf){qf.textContent=String(lines[i].qty);}
        var lt=frag.querySelector('[data-sw-field="line-total"]');
        if(lt&&txn.lineDisplay&&txn.lineDisplay[i]){
          var lsym=mount.getAttribute('data-currency-symbol')||'';
          lt.textContent=mount.getAttribute('data-currency-pos')==='after'?(txn.lineDisplay[i]+' '+lsym):(lsym+txn.lineDisplay[i]);
        }
        summary.appendChild(frag);
      }
    }
    var total=part(mount,'status-total');
    if(total&&txn.display&&txn.display.total){
      // ★★ The SERVER's formatted string, never arithmetic here. This used to divide by
      // 10^data-currency-decimals, which is the merchant's display preference and has nothing to do
      // with the settlement currency's ISO-4217 exponent — so a 0- or 3-decimal currency rendered a
      // total out by a factor of 100 or 10. The symbol and its position remain presentation.
      var sym=mount.getAttribute('data-currency-symbol')||'';
      var amount=String(txn.display.total);
      total.textContent=mount.getAttribute('data-currency-pos')==='after'?(amount+' '+sym):(sym+amount);
    }
    // ★ The cart is cleared HERE, and only on a confirmed payment. Clearing at redirect time would
    // lose the basket of every buyer who changed their mind on the provider's page.
    if(paid){
      var ck=mount.getAttribute('data-cart-key');
      try{
        if(ck){localStorage.removeItem(ck);localStorage.removeItem(ck+':txn');}
        else{
          var kill=[];
          for(var j=0;j<localStorage.length;j++){var kk=localStorage.key(j);if(kk&&kk.indexOf('sw-cart:')===0){kill.push(kk);}}
          for(var m=0;m<kill.length;m++){localStorage.removeItem(kill[m]);}
        }
      }catch(e){}
    }
  }

  function init(){
    var mounts=q('[data-sw-order-status]');
    for(var i=0;i<mounts.length;i++){
      (function(mount){
        if(!window.__swt){show(part(mount,'status-pending'),false);return;}
        var token=tokenFor(mount);
        if(!token){
          // No token at all: the author's static copy is already on screen, which is the whole point
          // of rendering it server-side. Say nothing more.
          show(part(mount,'status-pending'),false);
          show(part(mount,'status-unknown'),true);
          return;
        }
        fetch(window.__swt(token),{headers:{accept:'application/json'}})
          .then(function(r){return r.ok?r.json():null;})
          .then(function(body){fill(mount,body&&body.transaction);})
          .catch(function(){fill(mount,null);});
      })(mounts[i]);
    }
  }
  if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}
})();`;
