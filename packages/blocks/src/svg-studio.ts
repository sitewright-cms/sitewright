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
    var s=stage.querySelector('svg');if(s){s.removeAttribute('width');s.removeAttribute('height');s.style.maxWidth='100%';s.style.maxHeight='100%';s.style.height='auto';}
  }
  function play(){
    if(!lastSvg)return;render(lastSvg); // reset to static, then run the real runtime once
    if(script&&script.parentNode)script.parentNode.removeChild(script);
    script=document.createElement('script');script.textContent=SW_RT;document.body.appendChild(script);
  }
  function hideHi(){hi.style.display='none';}
  function highlight(id){
    hideHi();if(!id)return;var el;try{el=stage.querySelector('[id="'+String(id).replace(/["\\\\]/g,'')+'"]');}catch(e){}
    if(!el||!el.getBoundingClientRect)return;var r=el.getBoundingClientRect(),sr=stage.getBoundingClientRect();
    hi.style.display='block';hi.style.left=(r.left-sr.left-2)+'px';hi.style.top=(r.top-sr.top-2)+'px';hi.style.width=(r.width+4)+'px';hi.style.height=(r.height+4)+'px';
  }
  stage.addEventListener('click',function(e){
    var n=e.target;while(n&&n!==stage){if(n.getAttribute&&n.getAttribute('id')){post({type:'sw-studio-click',id:n.getAttribute('id')});return;}n=n.parentNode;}
  });
  window.addEventListener('message',function(e){var d=e.data;if(!d||!d.type)return;
    if(d.type==='sw-studio-render'&&typeof d.svg==='string')render(d.svg);
    else if(d.type==='sw-studio-play')play();
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
    `#stage{max-width:100%;max-height:100%;display:grid;place-items:center;cursor:pointer}` +
    `#stage svg{max-width:100%;max-height:78vh}` +
    `#hi{position:absolute;display:none;border:2px solid #4f46e5;border-radius:3px;pointer-events:none;box-shadow:0 0 0 2px rgba(79,70,229,.25)}` +
    SVG_ANIM_CSS +
    `</style></head><body><div id="wrap"><div id="stage"></div><div id="hi"></div></div>` +
    `<script>var SW_RT=${rt};${SVG_STUDIO_PREVIEW_JS}</script></body></html>`
  );
}
