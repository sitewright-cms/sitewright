/**
 * A DEMO COPY's stand-in for the platform — the page's half of a deploy target with `demo` on.
 *
 * A demo copy shows the live features working (a contact form, the cart's order form and checkout, the
 * thank-you page's order status, a booking widget and its status page) while nothing leaves the browser:
 * the build drops every receiver (see apps/api/src/publish/demo-build.ts), and this file takes the place of
 * the encoded endpoint blob (formApiScript in render.ts). It defines the same four address builders, so the
 * runtimes are unchanged, but their addresses start with `sw-demo:`, and a wrapper around `fetch` answers
 * those in the page with the shapes the platform's routes answer with. Every other request goes to the real
 * `fetch` untouched.
 *
 * ★ The answers mirror the platform's routes, and the runtimes read them field by field. A runtime that starts
 * reading a new field breaks a demo copy, not the live site, so `test/demo-runtime.test.ts` runs the REAL
 * form, cart, order-status and booking runtimes against this file and asserts each reaches its success state.
 *
 * Loaded as a plain (not deferred) script where the blob would sit, at body end, so it runs before the
 * deferred runtimes. It sets `data-sw-demo` on `<html>`, for an author who wants to say on the page that
 * nothing is sent (`[data-sw-demo] .demo-note{display:block}`).
 */

import type { ShopPricing } from '@sitewright/schema';
import { escapeAttr } from './escape.js';

/** The demo runtime's file name under the site's platform-script directory. */
export const DEMO_SCRIPT = 'sw-demo.js';

/** A price list as the demo prices a checkout: currency, its decimals, each SKU's name and unit price, and the
 *  shipping and tax the live checkout applies to it. */
export interface DemoPriceList {
  c: string;
  d: number;
  items: Record<string, { n: string; p: number }>;
  pricing?: ShopPricing;
}

/** What a demo copy knows about the site, all of it already public on its pages. */
export interface DemoRuntimeData {
  /** Each booking offering as the booking widget's availability answer names it (the server's public view). */
  offerings?: Record<string, Record<string, unknown>>;
  /** Each checkout channel's thank-you page, by channel key, as the site path the server would return to. */
  returnPaths?: Record<string, string>;
  /** The shop's price list (a shop without markets), or one per market. */
  catalog?: DemoPriceList;
  catalogs?: Record<string, DemoPriceList>;
}

/** The tag a demo copy's page loads the runtime with. PLAIN — never `defer`/`async` — so it runs where it stands,
 *  at body end, before the deferred runtimes that call the address builders. */
export function demoScriptTag(src: string): string {
  return `<script src="${escapeAttr(src)}"></script>`;
}

// A page needs the runtime only where the platform's endpoint would be called: a platform-routed form, the cart
// (or an add-to-cart button), a thank-you page's order status, a booking widget or a booking's own page.
const DEMO_USERS = /\bdata-sw-(?:routed|cart|order-status|booking)\b/;

/** Whether a rendered page has anything the demo runtime answers for. */
export function usesDemoRuntime(html: string): boolean {
  return DEMO_USERS.test(html);
}

// ES5, kept as a string like the other runtimes; minified at publish. NO backticks and no backslashes inside
// (a backslash would need doubling in this template literal), hence `[/]` in the one pattern below.
const DEMO_FN = `function(D){
  'use strict';
  var P='sw-demo:',DAY=86400000;
  var own=Object.prototype.hasOwnProperty;
  // The site root, from this script's own address (<root>/_assets/_sw/sw-demo.js): a thank-you page is a site path.
  var root=(function(){var s=document.currentScript;try{return s&&s.src?new URL('../../',s.src).href:location.origin+'/';}catch(e){return '/';}})();
  document.documentElement.setAttribute('data-sw-demo','');
  window.__swf=function(i){return P+'/f/'+i;};
  window.__swp=function(k){return P+'/pay/'+k;};
  window.__swt=function(t){return P+'/txn/'+encodeURIComponent(t);};
  window.__swb=function(s){return P+'/b/'+s;};
  window.__swb.preview=false;

  // A demo's orders and bookings live for the tab's session; in memory too, for a browser that refuses storage.
  var mem={};
  function save(k,v){var s=JSON.stringify(v);mem[k]=s;try{sessionStorage.setItem('sw-demo:'+k,s);}catch(e){}}
  function load(k){
    var s=null;
    try{s=sessionStorage.getItem('sw-demo:'+k);}catch(e){}
    if(s==null&&own.call(mem,k)){s=mem[k];}
    try{return s?JSON.parse(s):null;}catch(e){return null;}
  }
  function code(){var a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',s='';for(var i=0;i<6;i++){s+=a.charAt(Math.floor(Math.random()*a.length));}return s;}
  function pick(map,k){return map&&k!=null&&own.call(map,k)?map[k]:undefined;}
  // A proof of work solved by its first try: sha256('sw-demo'+'0'), with nothing to search.
  var CHALLENGE={algorithm:'SHA-256',challenge:'6f61e87b35ca01726cce57946340b63c332928476bb3db2c947d23d6bde4d516',salt:'sw-demo',signature:'sw-demo',maxnumber:0};

  // ---- checkout and order status: the server's pricing (priceOrder, composeAmounts), on integers ----
  // Amounts as the server formats them (fromMinorUnits): the currency's own decimals, no symbol.
  function money(minor,d){
    var neg=minor<0,s=String(Math.abs(Math.trunc(minor)));
    while(s.length<d+1){s='0'+s;}
    return (neg?'-':'')+s.slice(0,s.length-d)+(d>0?'.'+s.slice(s.length-d):'');
  }
  // n/d rounded half-up, for n >= 0 and d > 0, on integers: the server's Math.round of the same exact quotient.
  function half(n,d){var r=n%d;return (n-r)/d+(2*r>=d?1:0);}
  function amounts(sub,count,p){
    var ship=p&&p.shipping,free=!!ship&&ship.freeOverMinor!=null&&sub>=ship.freeOverMinor;
    var shipping=!ship||free||!count?0:ship.flatMinor,taxable=sub+shipping,tax=p&&p.tax,taxMinor=0,total=taxable;
    if(tax&&tax.rateBp>0){
      if(tax.mode==='exclusive'){taxMinor=half(taxable*tax.rateBp,10000);total=taxable+taxMinor;}
      else{taxMinor=half(taxable*tax.rateBp,10000+tax.rateBp);}
    }
    return {subtotalMinor:sub,shippingMinor:shipping,taxMinor:taxMinor,totalMinor:total};
  }
  function checkout(key,b){
    var cs=D.catalogs,cat=pick(cs,b.market)||D.catalog||(cs?cs[Object.keys(cs)[0]]:undefined);
    if(!cat){return [503,{error:'unavailable'}];}
    var items=Array.isArray(b.items)?b.items:[],lines=[],seen={},sub=0;
    if(!items.length){return [400,{error:'empty'}];}
    if(items.length>50){return [400,{error:'too-many-lines'}];}
    for(var i=0;i<items.length;i++){
      var it=items[i]||{},sku=String(it.sku);
      if(own.call(seen,sku)){return [400,{error:'duplicate-sku',sku:sku}];}
      seen[sku]=1;
      var c=pick(cat.items,sku);
      if(!c){return [409,{error:'unknown-sku',sku:sku}];}
      var q=Math.max(1,Math.floor(+it.qty)||1),m=c.p*q;sub+=m;
      lines.push({name:c.n,qty:q,amount:money(m,cat.d)});
    }
    var a=amounts(sub,lines.length,cat.pricing);
    if(a.totalMinor<=0){return [400,{error:'zero-total'}];}
    var token='demo-'+code().toLowerCase()+code().toLowerCase();
    var display={subtotal:money(a.subtotalMinor,cat.d),shipping:money(a.shippingMinor,cat.d),tax:money(a.taxMinor,cat.d),total:money(a.totalMinor,cat.d)};
    // The token goes in the QUERY even when the thank-you path carries a #fragment (as the server's withToken does).
    var back;
    try{back=new URL(String(pick(D.returnPaths,key)||'/').replace(/^[/]+/,''),root);back.searchParams.set('t',token);back=back.href;}catch(e){back=root;}
    save('o:'+token,{currency:cat.c,amounts:a,display:display,
      lines:lines.map(function(l){return {name:l.name,qty:l.qty};}),lineDisplay:lines.map(function(l){return l.amount;})});
    return [200,{token:token,redirectUrl:back,currency:cat.c,amounts:a,display:display,lines:lines}];
  }
  function txn(token){
    var o=load('o:'+token);
    if(!o){return [404,{error:'not-found'}];}
    var now=new Date().toISOString();
    return [200,{transaction:{status:'paid',currency:o.currency,amounts:o.amounts,lines:o.lines,display:o.display,lineDisplay:o.lineDisplay,createdAt:now,paidAt:now}}];
  }

  // ---- booking: sample free times in the offering's own time zone ----
  var fmts={};
  function parts(t,tz){
    var f=fmts[tz]||(fmts[tz]=new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'}));
    var p={};f.formatToParts(new Date(t)).forEach(function(x){p[x.type]=+x.value;});return p;
  }
  function offset(t,tz){var p=parts(t,tz);return Date.UTC(p.year,p.month-1,p.day,p.hour%24,p.minute,p.second)-(t-t%1000);}
  // The instant a wall-clock time (minutes after midnight) on a date names in the zone. A day past the month's
  // end rolls over (Date.UTC does), so a stay's last day is simply its first day plus its length.
  function at(y,m,d,min,tz){var g=Date.UTC(y,m,d,0,min),o=offset(g,tz),t=g-o,o2=offset(t,tz);return o2===o?t:g-o2;}
  function clock(s){var p=String(s||'').split(':');return (+p[0]||0)*60+(+p[1]||0);}
  // What units days or nights from a date occupy, as the server's unitSpan: whole days run midnight to midnight,
  // nights from check-in on the first day to check-out on the last.
  function stay(o,y,m,d,units,tz){
    var day=o.unit==='day';
    return [at(y,m,d,day?0:clock(o.checkIn),tz),at(y,m,d+units,day?0:clock(o.checkOut),tz)];
  }
  function datesFrom(from,to,tz){
    var p=parts(from,tz),out=[];
    for(var i=0;i<450;i++){
      var u=new Date(Date.UTC(p.year,p.month-1,p.day+i)),y=u.getUTCFullYear(),m=u.getUTCMonth(),d=u.getUTCDate();
      if(at(y,m,d,0,tz)>=to){break;}
      out.push({y:y,m:m,d:d,w:u.getUTCDay()});
    }
    return out;
  }
  function ymd(x){return x.y+'-'+(x.m<9?'0':'')+(x.m+1)+'-'+(x.d<10?'0':'')+x.d;}
  function slotMin(o){return o.mode==='slots'?60:Math.max(15,o.durationMin||60);}
  function resourcesOf(o,asked){
    var all=(o.resources||[]).map(function(r){return r.id;});
    if(!asked){return {ok:true,ids:all};}
    return {ok:all.indexOf(asked)>=0,ids:[asked]};
  }
  function availability(id,q){
    var o=pick(D.offerings,id);
    if(!o){return [404,{error:'not-found'}];}
    if(!(+q.from>0)||!(+q.to>0)){return [400,{error:'invalid'}];}
    var res=resourcesOf(o,q.resource);
    if(!res.ok){return [400,{error:'unknown-resource'}];}
    // The window the server lists: from now at the earliest, at most 62 days of times or 400 of days, and no later
    // than the offering books ahead.
    var tz=o.timeZone||'UTC',now=Date.now(),first=now+(o.minNoticeMin||0)*60000,last=now+(o.maxAdvanceDays||0)*DAY;
    var from=Math.max(+q.from,now),to=Math.min(+q.to,from+(o.mode==='days'?400:62)*DAY,now+((o.maxAdvanceDays||0)+1)*DAY);
    var ids=res.ids,body={offering:o,truncated:false};
    var dates=to>from?datesFrom(from,to,tz):[];
    if(o.mode==='days'){
      body.kind='days';body.days=[];
      dates.forEach(function(x){
        var s=stay(o,x.y,x.m,x.d,1,tz)[0];
        if(s<first||s>last||s<from||s>=to){return;}
        var e={date:ymd(x)};if(ids.length){e.resources=ids;}body.days.push(e);
      });
      return [200,body];
    }
    if(o.mode==='range'){
      body.kind='windows';body.windows=[];
      var step=(o.stepMin||30)*60000;
      dates.forEach(function(x){
        if(x.w===0||x.w===6){return;}
        var s=at(x.y,x.m,x.d,540,tz),e=Math.min(at(x.y,x.m,x.d,1020,tz),to),lo=Math.max(first,from);
        if(s<lo){s+=Math.ceil((lo-s)/step)*step;}
        if(s>last||e-s<(o.minMin||30)*60000){return;}
        (ids.length?ids:[null]).forEach(function(r){var w={start:s,end:e};if(r){w.resource=r;}body.windows.push(w);});
      });
      return [200,body];
    }
    // duration: every slot length from 09:00 to 17:00 on weekdays; slots: 10:00 and 14:00 every day.
    body.kind='times';body.times=[];
    var len=slotMin(o);
    dates.forEach(function(x){
      var starts=[];
      if(o.mode==='slots'){starts=[600,840];}
      else if(x.w!==0&&x.w!==6){for(var mm=540;mm+len<=1020;mm+=len){starts.push(mm);}}
      starts.forEach(function(mm){
        var s=at(x.y,x.m,x.d,mm,tz);
        if(s<first||s>last||s<from||s>=to){return;}
        var t={start:s,end:s+len*60000};
        if(o.mode==='slots'){t.places=Math.max(1,o.maxQuantity||1);}
        if(ids.length){t.resources=ids;}
        body.times.push(t);
      });
    });
    return [200,body];
  }
  function book(id,b){
    var o=pick(D.offerings,id);
    if(!o){return [404,{error:'not-found'}];}
    var tz=o.timeZone||'UTC',start,end;
    if(o.mode==='days'){
      var dp=String(b.date||'').split('-'),span=stay(o,+dp[0],+dp[1]-1,+dp[2],Math.max(1,Math.floor(+b.units)||1),tz);
      start=span[0];end=span[1];
    }else{
      start=+b.start;end=o.mode==='range'?+b.end:start+slotMin(o)*60000;
    }
    if(!(start>0)||!(end>start)){return [400,{error:'invalid'}];}
    // No payment step: a demo never hands a visitor to a provider, so a priced offering books like a free one.
    var ref='DEMO-'+code(),state=o.confirmation==='request'?'pending':'booked';
    var summary={id:o.id,name:o.name,mode:o.mode,timeZone:o.timeZone};
    if(o.mode==='days'){summary.unit=o.unit;}
    save('b:'+ref,{state:state,start:start,end:end,quantity:Math.max(1,Math.floor(+b.quantity)||1),offering:summary});
    return [200,{ok:true,reference:ref,state:state,start:start,end:end}];
  }
  function booking(token,method,action){
    var b=load('b:'+token);
    if(!b){return [404,{error:'not-found'}];}
    if(method==='POST'&&action==='cancel'){b.state='cancelled';save('b:'+token,b);return [200,{ok:true}];}
    if(method==='POST'){return [400,{error:'invalid'}];}
    return [200,{state:b.state,start:b.start,end:b.end,quantity:b.quantity,offering:b.offering,cancellable:b.state!=='cancelled'}];
  }
  // ---- the router: the platform's routes, answered in the page ----
  function answer(url,init){
    var method=String(init.method||'GET').toUpperCase(),path=url.slice(P.length),qs='',i=path.indexOf('?');
    if(i>=0){qs=path.slice(i+1);path=path.slice(0,i);}
    var q={};
    qs.split('&').forEach(function(kv){if(!kv){return;}var j=kv.indexOf('=');try{q[decodeURIComponent(j<0?kv:kv.slice(0,j))]=decodeURIComponent(j<0?'':kv.slice(j+1));}catch(e){}});
    var seg=path.split('/').slice(1).map(function(s){try{return decodeURIComponent(s);}catch(e){return s;}});
    var body={};
    try{body=init.body?JSON.parse(String(init.body)):{};}catch(e){}
    if(!body||typeof body!=='object'){body={};}
    var kind=seg[0];
    if(method==='GET'&&seg[seg.length-1]==='challenge'){return [200,CHALLENGE];}
    if(kind==='f'&&seg.length===2&&method==='POST'){return [200,{ok:true}];}
    if(kind==='pay'&&seg.length===2&&method==='POST'){return checkout(seg[1],body);}
    if(kind==='txn'&&seg.length===2&&method==='GET'){return txn(seg[1]);}
    if(kind==='b'){
      if(seg[1]==='_booking'&&seg.length>=3){return booking(seg[2],method,seg[3]);}
      if(seg.length===3&&seg[2]==='availability'&&method==='GET'){return availability(seg[1],q);}
      if(seg.length===2&&method==='POST'){return book(seg[1],body);}
    }
    return [404,{error:'not-found'}];
  }
  var real=window.fetch;
  window.fetch=function(input,init){
    var url=typeof input==='string'?input:input&&input.url?String(input.url):String(input);
    if(url.indexOf(P)!==0){return real?real.apply(this,arguments):Promise.reject(new TypeError('fetch is unavailable'));}
    var r;
    try{r=answer(url,init||{});}catch(e){r=[500,{error:'failed'}];}
    // A short wait, so a demo's "Sending…" states show as they would on the live site.
    return new Promise(function(done){setTimeout(function(){
      done(new Response(JSON.stringify(r[1]),{status:r[0],headers:{'content-type':'application/json'}}));
    },250);});
  };
}`;

/** The demo runtime with this site's data, as the script file a demo copy loads on every page. */
export function demoRuntimeJs(data: DemoRuntimeData): string {
  return `(${DEMO_FN})(${JSON.stringify(data)});`;
}
