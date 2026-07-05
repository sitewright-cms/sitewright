// The SVG Animation Studio's live CANVAS document — the sandboxed iframe the editor drives to render the
// user's SVG, PLAY the animation on demand (the real runtimes), report element clicks (for tree selection),
// and highlight the selected element. Served same-origin under `Content-Security-Policy: sandbox
// allow-scripts` and loaded via iframe `src` (NOT srcdoc) — the editor's own `script-src 'self'` would
// block the inline runtime; the sandbox gives an opaque, isolated origin where it runs with no session
// access. The user's (import-sanitized) SVG is injected only into this isolated frame.
//
// Protocol (postMessage): editor → frame
//   {type:'sw-studio-render', svg:'<svg>…</svg>'}  render the SVG statically (inert; for selecting/editing)
//   {type:'sw-studio-play'}                         play the animation ONCE using the real runtimes
//   {type:'sw-studio-highlight', id:'…'}            outline the element with that id (selection)
// frame → editor
//   {type:'sw-studio-ready'}                        listener live
//   {type:'sw-studio-click', id:'…'}                an element (carrying a stamped id) was clicked
import { SVG_ANIM_JS } from './svg-anim.js';
import { SVG_ANIM_MORPH_JS } from './svg-anim-morph.js';
import { SVG_ANIM_CSS } from './svg-anim.js';

const SVG_STUDIO_PREVIEW_JS = `(function(){
  'use strict';
  var stage=document.getElementById('stage'),hi=document.getElementById('hi'),lastSvg='';
  var script=null;
  function post(m){try{if(parent)parent.postMessage(m,'*');}catch(e){}}
  // Minimal client strip (the editor sanitizes on import too; belt-and-suspenders for the sandbox).
  function strip(el){var bad=el.querySelectorAll&&el.querySelectorAll('script,foreignObject');if(bad)Array.prototype.forEach.call(bad,function(n){if(n.parentNode)n.parentNode.removeChild(n);});
    function c(n){if(!n.attributes)return;for(var i=n.attributes.length-1;i>=0;i--){var a=n.attributes[i].name;
      if(/^on/i.test(a)){n.removeAttribute(a);continue;}
      if(/(?:^|:)href$/i.test(a)&&/^\\s*(?:javascript|vbscript|data):/i.test(n.attributes[i].value||''))n.setAttribute(a,'#');}}
    c(el);if(el.querySelectorAll)Array.prototype.forEach.call(el.querySelectorAll('*'),c);}
  function render(svg){
    lastSvg=svg||'';hideHi();
    stage.innerHTML=lastSvg;strip(stage);
    var s=stage.querySelector('svg');if(s){
      // Fit-to-canvas: an SVG with only a viewBox (no width/height — the norm for icon sets) collapses
      // to 0x0 when sized 'auto' inside the centred stage, so it renders invisibly. Synthesize a viewBox
      // from the authored width/height when absent, then size the element to fill the stage — the viewBox
      // + default preserveAspectRatio scales & centres the drawing regardless of how it was authored.
      if(!s.getAttribute('viewBox')){var w=parseFloat(s.getAttribute('width'))||0,h=parseFloat(s.getAttribute('height'))||0;if(w>0&&h>0)s.setAttribute('viewBox','0 0 '+w+' '+h);}
      s.removeAttribute('width');s.removeAttribute('height');s.style.width='100%';s.style.height='100%';s.style.maxHeight='80vh';
    }
    // The engine hides [data-sw-svg] from first paint (no-FOUC on real pages). The Studio is an EDITING
    // surface, so show every element in the static view — Play/auto-loop then animates them (revealing +
    // re-hiding via .sw-svg-shown). Mark armed too so the CSS failsafe never kicks in here.
    var an=stage.querySelectorAll('[data-sw-svg]');Array.prototype.forEach.call(an,function(e){e.classList.add('sw-svg-armed');e.classList.add('sw-svg-shown');});
  }
  function play(){
    if(!lastSvg)return;render(lastSvg); // reset to static, then run the real runtime once
    if(script&&script.parentNode)script.parentNode.removeChild(script);
    script=document.createElement('script');script.textContent=SW_RT;document.body.appendChild(script);
  }
  // AUTO-LOOP (editor-only): replay the WHOLE timeline once it has FULLY finished (+ a short gap), so
  // every element — the draw included — restarts cleanly each cycle, exactly like pressing Play. Driven by
  // animation-completion, NOT a fixed interval (a fixed interval could cut a long draw mid-way and leave
  // the static filled shape on screen). A generation counter cancels an in-flight cycle on toggle/re-toggle.
  var autoTimer=null,autoGen=0,autoOn=false;
  function stopAuto(){autoGen++;if(autoTimer){clearTimeout(autoTimer);autoTimer=null;}}
  function autoloop(on){
    stopAuto();autoOn=!!on;
    if(!on){if(lastSvg)render(lastSvg);return;}
    var gen=autoGen;
    function idleThen(next){var t0=Date.now(),idle=0;(function poll(){if(gen!==autoGen)return;
      var busy=document.getAnimations?document.getAnimations().some(function(a){return a.playState==='running'||a.playState==='pending';}):false;
      if(busy){idle=0;}else{idle++;}
      // Require TWO consecutive idle polls so the sub-ms gap between the draw finishing and its fill-reveal
      // starting is never mistaken for "done". A 15s ceiling bounds an SVG with an infinite CSS animation.
      if((!busy&&idle>=2)||Date.now()-t0>15000){next();}else{autoTimer=setTimeout(poll,120);}})();}
    function cycle(){if(gen!==autoGen)return;play();
      autoTimer=setTimeout(function(){idleThen(function(){if(gen===autoGen)autoTimer=setTimeout(cycle,650);});},140);}
    cycle();
  }
  function hideHi(){hi.style.display='none';}
  function highlight(id){
    hideHi();if(!id)return;var el;try{el=stage.querySelector('#'+((window.CSS&&CSS.escape)?CSS.escape(String(id)):String(id).replace(/[^\\w-]/g,'')));}catch(e){}
    if(!el||!el.getBoundingClientRect)return;var r=el.getBoundingClientRect(),sr=stage.getBoundingClientRect();
    hi.style.display='block';hi.style.left=(r.left-sr.left-2)+'px';hi.style.top=(r.top-sr.top-2)+'px';hi.style.width=(r.width+4)+'px';hi.style.height=(r.height+4)+'px';
  }
  stage.addEventListener('click',function(e){
    var n=e.target;while(n&&n!==stage){if(n.getAttribute&&n.getAttribute('id')){post({type:'sw-studio-click',id:n.getAttribute('id')});return;}n=n.parentNode;}
  });
  window.addEventListener('message',function(e){if(e.source!==parent)return;var d=e.data;if(!d||!d.type)return; // only the editor (our parent) drives this canvas
    if(d.type==='sw-studio-render'&&typeof d.svg==='string'){render(d.svg);if(autoOn)autoloop(true);} // reflect edits at once: restart the loop from the new SVG
    else if(d.type==='sw-studio-play')play();
    else if(d.type==='sw-studio-autoloop')autoloop(!!d.on);
    else if(d.type==='sw-studio-highlight')highlight(d.id);
  });
  post({type:'sw-studio-ready'});
})();`;

/** The Studio canvas document. `SW_RT` embeds the REAL runtimes (core + morph) so "play" animates exactly
 *  like the published site. Rendered content arrives only via postMessage from the editor. */
export function svgStudioPreviewDoc(): string {
  const rt = JSON.stringify(SVG_ANIM_JS + '\n' + SVG_ANIM_MORPH_JS);
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>` +
    `html,body{margin:0;height:100%}body{display:grid;place-items:center;background:` +
    `repeating-conic-gradient(#eef0f7 0% 25%,#f7f8fc 0% 50%) 50%/22px 22px;color:#1a1a23;font-family:system-ui,sans-serif}` +
    `#wrap{position:relative;width:92%;height:92%;display:grid;place-items:center}` +
    `#stage{width:100%;height:100%;display:grid;place-items:center;cursor:pointer}` +
    `#stage svg{width:100%;height:100%;max-height:80vh}` +
    `#hi{position:absolute;display:none;border:2px solid #4f46e5;border-radius:3px;pointer-events:none;box-shadow:0 0 0 2px rgba(79,70,229,.25)}` +
    SVG_ANIM_CSS +
    `</style></head><body><div id="wrap"><div id="stage"></div><div id="hi"></div></div>` +
    `<script>var SW_RT=${rt};${SVG_STUDIO_PREVIEW_JS}</script></body></html>`
  );
}
