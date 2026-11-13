/**
 * Retries a project image the server turned away while it was busy, in the editor's single-page preview.
 *
 * ★ Why the preview needs it. The whole-site preview and a published site link pre-built image files;
 * this canvas asks for every `/media/…?size=` rung ON DEMAND, and an uncached one is encoded right then
 * under the public thumbnail gate (3 at once, 20 queued per project). The canvas loads every image
 * EAGERLY — native lazy-load is unreliable in the preview frame (directives.ts) — so a cold, image-heavy
 * page asks for all of them at once and the ones past the queue are refused with `503 Retry-After`. A
 * browser never retries an image, so each of those stayed a broken icon until the next reload. Here a
 * refused image is asked for again a moment later, so the page's images arrive batch after batch as the
 * encodes finish instead of all at once.
 *
 * What it touches, and what it does not:
 * - Only `<img>` whose current URL is a project media path on THIS instance (`/media/…` on the page's base
 *   origin — another host's `/media/` is not ours to retry), never an SVG (a vector has no
 *   encode to wait for), and at most {@link MAX_RETRIES} times per element, so an image that is really
 *   gone costs a handful of cheap requests, not a loop. The count resets once the image loads, so a
 *   later swap (a carousel, a replaced `data-sw-src`) gets the full budget again.
 * - It re-sets the element's own `srcset` / `src` to the SAME values, which makes the browser select and
 *   fetch again (a `<picture>`'s `<source>`s included). It adds NO attribute and keeps its count in a
 *   WeakMap: the bridge serialises edited regions straight back into page content, so a marker written
 *   onto an `<img>` would end up saved into the page.
 * - It runs in `<head>`, so its capture-phase listener sees every image error; on a raw-replica page
 *   (no head scripts) it runs at the end of `<body>` and first picks up the images that already failed.
 *
 * Preview-only: injected by `styledSourceDocument` (the sandboxed preview shells), never by the build.
 */
const MAX_RETRIES = 10;
/**
 * Wait before retry n: FIRST + (n − 1) × STEP, capped at CAP, plus up to JITTER — about a minute in all
 * before it gives up. The first wait honours the busy answer's `Retry-After: 2`, and the jitter is wide
 * so a page's refused images come back spread out rather than as one wave the queue refuses again.
 */
const RETRY_FIRST_MS = 2000;
const RETRY_STEP_MS = 1000;
const RETRY_CAP_MS = 6000;
const RETRY_JITTER_MS = 1500;

// NOTE: no backticks anywhere in the script body — they would close the template literal.
export const PREVIEW_IMAGE_RETRY_JS = `(function(){
  'use strict';
  if(typeof WeakMap!=='function')return;
  var tries=new WeakMap();
  // The page's own origin, from its BASE url: the canvas may be a sandboxed srcdoc, whose own origin is
  // opaque, while its relative /media/ urls resolve against the base (the instance).
  var here='';
  try{here=new URL(document.baseURI).origin;}catch(_){}
  function mediaPath(img){
    // currentSrc names the candidate that failed; a browser that clears it on error leaves the src, or
    // for a srcset-only image the first candidate.
    var u=img.currentSrc||img.getAttribute('src')||((img.getAttribute('srcset')||'').split(',')[0]||'').trim().split(/\\s+/)[0]||'';
    if(!u||!here)return false;
    try{u=new URL(u,document.baseURI);}catch(_){return false;}
    return u.origin===here&&u.pathname.indexOf('/media/')===0&&!/\\.svg$/i.test(u.pathname);
  }
  function retry(img){
    if(!img||img.tagName!=='IMG'||!mediaPath(img))return;
    var n=(tries.get(img)||0)+1;
    if(n>${MAX_RETRIES})return;
    tries.set(img,n);
    var wait=Math.min(${RETRY_FIRST_MS}+(n-1)*${RETRY_STEP_MS},${RETRY_CAP_MS})+Math.floor(Math.random()*${RETRY_JITTER_MS});
    setTimeout(function(){
      if(!img.isConnected)return;
      var srcset=img.getAttribute('srcset');
      var src=img.getAttribute('src');
      if(srcset!==null)img.setAttribute('srcset',srcset);
      if(src!==null)img.setAttribute('src',src);
    },wait);
  }
  document.addEventListener('error',function(e){retry(e.target);},true);
  document.addEventListener('load',function(e){if(tries.has(e.target))tries.delete(e.target);},true);
  var imgs=document.images;
  for(var i=0;i<imgs.length;i++){if(imgs[i].complete&&imgs[i].naturalWidth===0)retry(imgs[i]);}
})();`;
