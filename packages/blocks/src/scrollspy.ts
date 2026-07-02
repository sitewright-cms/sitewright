// SCROLLSPY — highlight the navigation link whose in-page section is currently scrolled into view, on
// one-page / landing layouts (`<a href="#about">` → `<section id="about">`). The runtime toggles the
// platform's existing active convention — `.active` + `aria-current="true"` — so it composes for free
// with every nav-effect scheme (which style `a.active`) and the recipes' route highlighting.
//
// Two opt-in surfaces (only-used-ships, like the parallax / nav-effects runtimes):
//   • data-sw-scrollspy on any nav container → that element is a scrollspy SCOPE (a custom on-page nav).
//   • website.effects.scrollSpy → the `sw-scrollspy` body class → the runtime governs each `.menu`
//     inside the `#main-nav` landmark (its desktop bar + mobile drawer; the brand/CTA/lang-flags that
//     sit OUTSIDE a `.menu` are spared — same scoping discipline as nav-effects.ts).
//
// GOVERNANCE — a scope that has at least one in-page section target OWNS its active state: on every
// scroll it CLEARS `.active`/`aria-current` from ALL its links (including non-anchor/route links, so a
// server-rendered `{{sw-active}}` route highlight can't linger next to a section highlight) and sets the
// active link(s). A scope with NO resolvable section targets is DORMANT (left untouched) so ordinary
// route highlighting survives on pages that have no in-page sections.
//
// ANCHORS ONLY — a link is a spy target only when its URL fragment resolves to a section that EXISTS on
// the current page (`getElementById`). This makes PATH-PREFIXED anchors (`/#about`, `/en/#about`) work
// cleanly: they spy on the page that actually has `#about` and are inert elsewhere, with no fragile
// path comparison. A hashless link to the current page itself (a "Home" item) is a TOP sentinel — it
// lights while the visitor is above the first section.
//
// Algorithm (gumshoe-style scroll-position, NOT IntersectionObserver — an IO "trigger band" leaves the
// active state stale when a section is taller or shorter than the band): the active section is the LAST
// one whose top edge has crossed a trigger line at the fixed-header offset; at the page bottom the last
// section wins (a short final section never reaches the line); above the first section the sentinel (or
// nothing) is active. Passive scroll listener + rAF throttle; DOM writes only when the selection changes.
//
// Invariants (shared with the other runtimes):
//   • Static, first-party, audited code; no tenant string reaches it. No-JS / SSR → links still work,
//     they just carry no auto-highlight (graceful degradation; the box/layout is untouched).
//   • The fixed-header offset is read per-frame (measures the real `#main-nav` when it is fixed/sticky,
//     so a shrinking/breakpoint-varying header stays correct; falls back to the `--sw-header-h` token).

/** The marker substring shared by BOTH opt-in surfaces: the `data-sw-scrollspy` attribute AND the
 *  site-wide `sw-scrollspy` body class both contain it, so one source/body scan gates the runtime. */
const SCROLLSPY_MARKER = 'sw-scrollspy';

/**
 * Whether a rendered HTML / body-class string opts into scrollspy — either a per-element
 * `data-sw-scrollspy` attribute or the site-wide `sw-scrollspy` body class (both contain the marker).
 * Used by the preview inline-gate; publish gates the site-wide flag via `scrollSpyUsesRuntime` and
 * scans authored sources for the attribute with this same function.
 */
export function usesScrollSpy(html: string | null | undefined): boolean {
  return typeof html === 'string' && html.includes(SCROLLSPY_MARKER);
}

/** The scrollspy runtime, linked per page (publish) or inlined in the preview. */
export const SCROLLSPY_JS = `(function(){
  'use strict';
  var root=document.documentElement;
  var navEl=document.getElementById('main-nav'); // the landmark — stable for the page lifetime; cached once
  function qsa(sel,ctx){return Array.prototype.slice.call((ctx||document).querySelectorAll(sel));}
  // Collect SCOPES: every [data-sw-scrollspy] element, plus each .menu inside #main-nav when the
  // site-wide flag is on. Keep only the OUTERMOST of any nested pair (a dropdown .menu lives inside the
  // bar .menu → the outer one governs its links; avoids double clear/set on the same link).
  var cands=[];
  function addCand(el){if(el&&cands.indexOf(el)<0)cands.push(el);}
  qsa('[data-sw-scrollspy]').forEach(addCand);
  if(navEl&&/(^|\\s)sw-scrollspy(\\s|$)/.test(document.body.className||'')){
    qsa('.menu',navEl).forEach(addCand);
  }
  var scopes=cands.filter(function(el){return !cands.some(function(o){return o!==el&&o.contains(el);});});
  if(scopes.length===0)return;
  function decodeId(s){try{return decodeURIComponent(s);}catch(e){return s;}}
  // A hashless link to the current page itself (e.g. a Home item) — the TOP sentinel.
  function samePage(a){return a.hash===''&&a.pathname===location.pathname&&a.search===location.search;}
  function domBefore(a,b){return (a.compareDocumentPosition(b)&4)?-1:1;}
  var governed=[];
  scopes.forEach(function(scope){
    var links=qsa('a[href]',scope);
    // Object.create(null): a section id of "__proto__"/"constructor" must key cleanly (a bare {} would
    // hit Object.prototype, so the !byId[id] guard misfires and the forEach throws — killing the runtime).
    var byId=Object.create(null),order=[],sentinels=[];
    links.forEach(function(a){
      var h=a.hash;
      if(h&&h.length>1){
        var id=decodeId(h.slice(1));
        var el=id?document.getElementById(id):null;
        if(el){if(!byId[id]){byId[id]={el:el,links:[]};order.push(id);}byId[id].links.push(a);}
      }else if(samePage(a)){sentinels.push(a);}
    });
    if(order.length===0)return; // dormant: no in-page sections → leave route highlighting alone
    var secs=order.map(function(id){return byId[id];}).sort(function(a,b){return domBefore(a.el,b.el);});
    governed.push({links:links,secs:secs,sentinels:sentinels,key:undefined});
  });
  if(governed.length===0)return;
  // The fixed-header offset in PX. The cached #main-nav element is re-MEASURED each frame (not re-queried)
  // so a shrinking / breakpoint-varying header stays correct — only while it is actually fixed/sticky.
  // Else resolve the --sw-header-h token (authored in rem, which parseFloat alone cannot resolve to px).
  function offset(){
    if(navEl){var p=getComputedStyle(navEl).position;if(p==='fixed'||p==='sticky')return navEl.getBoundingClientRect().height;}
    var v=(getComputedStyle(root).getPropertyValue('--sw-header-h')||'').trim();
    if(v){var n=parseFloat(v);if(isFinite(n))return (/rem$/.test(v))?n*(parseFloat(getComputedStyle(root).fontSize)||16):n;}
    return 0;
  }
  function paint(g,set,key){
    if(key===g.key)return; // no change → no DOM writes
    g.key=key;
    var i;
    for(i=0;i<g.links.length;i++){g.links[i].classList.remove('active');g.links[i].removeAttribute('aria-current');}
    for(i=0;i<set.length;i++){set[i].classList.add('active');set[i].setAttribute('aria-current','true');}
  }
  // Scroll metrics read from whatever actually scrolls: the viewport on a published site (html), but the
  // BODY in the editor preview (html{overflow:hidden} → body{overflow-y:auto}) — window.pageYOffset stays 0
  // there. Section activation itself is viewport-relative (getBoundingClientRect), so only the bottom-edge
  // check needs the real scroll position/height.
  function scrollPos(){return window.pageYOffset||root.scrollTop||document.body.scrollTop||0;}
  function scrollMax(){return Math.max(root.scrollHeight,document.body.scrollHeight);}
  var ticking=false;
  function update(){
    ticking=false;
    var line=offset()+1;
    var atBottom=(window.innerHeight+scrollPos())>=(scrollMax()-2);
    for(var s=0;s<governed.length;s++){
      var g=governed[s],set,key;
      if(atBottom){var last=g.secs[g.secs.length-1];set=last.links;key='b'+(g.secs.length-1);}
      else if(g.secs[0].el.getBoundingClientRect().top-line>0){set=g.sentinels;key='top';}
      else{
        var cur=0;
        for(var i=0;i<g.secs.length;i++){if(g.secs[i].el.getBoundingClientRect().top-line<=0)cur=i;else break;}
        set=g.secs[cur].links;key='s'+cur;
      }
      paint(g,set,key);
    }
  }
  function onScroll(){if(!ticking){ticking=true;(window.requestAnimationFrame||function(f){return f();})(update);}}
  // capture:true so a BODY scroll (the editor preview's scroll container) still reaches this — a scroll
  // event on a non-root scroller does NOT fire a bubbling window listener, but the capture phase sees it.
  window.addEventListener('scroll',onScroll,{passive:true,capture:true});
  window.addEventListener('resize',onScroll,{passive:true});
  update();
})();`;
