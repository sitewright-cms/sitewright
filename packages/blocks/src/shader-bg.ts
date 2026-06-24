// Platform-authored WebGL ANIMATED BACKGROUND component (`data-sw-component="shader-bg"`).
//
// First-party, CSP-clean (the JS ships as an external components.js served from the site's own origin,
// no `eval`/Workers/WASM), only-used-ships (CSS/JS ship only when a page uses the marker). The author
// supplies only declarative data: a preset key + look knobs via `data-*`; never JavaScript.
//
// Authoring (markup): put `data-sw-component="shader-bg"` on a section/hero/full-page wrapper that
// already contains the content. The runtime injects a background `<canvas>` BEHIND the content
// (negative z-index inside an isolated stacking context), reads the project's CI colors from the
// `--sw-color-*` tokens, and animates the chosen preset. Until enhanced (and when JS is off / WebGL is
// unavailable) a CSS gradient built from the same tokens shows as a `noJs` fallback.
//
//   <section class="py-24" data-sw-component="shader-bg" data-preset="mesh-gradient">
//     <div class="sw-container"> … hero content … </div>
//   </section>
//
// data-* knobs (all optional):
//   data-preset       one of SHADER_BG_PRESET_KEYS (default "mesh-gradient")
//   data-speed        animation speed multiplier, 0–4 (default 1; 0 = static)
//   data-intensity    saturation/brightness, 0–1 (default 0.5)
//   data-angle        rotation of the whole field in degrees, -360–360 (default 0)
//   data-interactive  "true" to let the pointer morph the effect (default off; ignored under reduced-motion)
//   data-colors       override the 3 palette slots, comma-separated — CI token names ("accent,primary,
//                     base-content") or literal colors ("#fff,rgb(0,0,0),steelblue"); defaults to
//                     primary,secondary,neutral
//
// Behaviour: one WebGL context per instance; animation pauses when the element is offscreen
// (IntersectionObserver) or the tab is hidden (visibilitychange); `prefers-reduced-motion` renders a
// single static frame; DPR is capped at 2; color uniforms are re-read when the active theme changes
// (`data-sw-theme` on <html>), so it follows light/dark themes.

import {
  SHADER_VERT,
  SHADER_PRELUDE,
  SHADER_MAIN,
  SHADER_BG_PRESETS,
  DEFAULT_SHADER_PRESET,
} from './shader-bg-presets.js';

// --- CSS --------------------------------------------------------------------
// Zero-specificity `:where(...)` so author utilities/classes always win. The host becomes a relative,
// isolated stacking context; the gradient fallback (::before) and the injected canvas sit at z-index:-1
// — above the host's own background box but below in-flow content — so nothing in the content needs to
// be repositioned. Once the runtime takes over it sets data-sw-enhanced="true" and the fallback hides.
export const SHADER_BG_CSS = [
  ':where([data-sw-component="shader-bg"]){position:relative;isolation:isolate}',
  ':where([data-sw-component="shader-bg"])::before{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(135deg,var(--sw-color-primary,#4f46e5),var(--sw-color-secondary,#0ea5e9) 55%,var(--sw-color-neutral,#1f2937))}',
  ':where([data-sw-component="shader-bg"][data-sw-enhanced="true"])::before{display:none}',
  ':where([data-sw-component="shader-bg"]) > canvas[data-sw-shader]{position:absolute;inset:0;z-index:-1;display:block;width:100%;height:100%;pointer-events:none}',
  // Optional legibility scrim: a `data-sw-part="overlay"` child sits above the canvas but below
  // content (negative z, painted after the prepended canvas). Author the tint with utilities (bg-black/30).
  ':where([data-sw-component="shader-bg"]) > [data-sw-part="overlay"]{position:absolute;inset:0;z-index:-1;pointer-events:none}',
].join('');

// --- runtime ----------------------------------------------------------------
// Authored as JS with __PLACEHOLDER__ tokens; the GLSL is injected as JSON literals below so the GLSL
// stays single-sourced in shader-bg-presets.ts. NOTE: no backslash-containing regex literals here — a
// template literal would mangle `\d` etc.; color parsing uses the backslash-free /[^0-9.,]/g.
const RUNTIME = `(function(){
  "use strict";
  var VERT=__VERT__, PRELUDE=__PRELUDE__, MAIN=__MAIN__, PRESETS=__PRESETS__, DEF=__DEF__;
  var hosts=document.querySelectorAll('[data-sw-component="shader-bg"]');
  if(!hosts.length)return;
  var DPR=Math.min(window.devicePixelRatio||1,2);
  // One shared tab-visibility handler drives all animated instances (no per-instance listener pileup).
  var updaters=[];
  var sharedShown=!document.hidden;
  document.addEventListener('visibilitychange',function(){ sharedShown=!document.hidden; for(var k=0;k<updaters.length;k++) updaters[k](); });
  var reduce=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches);
  var FALLBACK={primary:'#4f46e5',secondary:'#0ea5e9',neutral:'#1f2937'};

  // Resolve a CI token name or literal color string to [r,g,b] in 0..1 via a hidden probe.
  var probe=document.createElement('span');
  probe.setAttribute('aria-hidden','true');
  probe.style.cssText='position:absolute;left:-9999px;top:-9999px;width:0;height:0;pointer-events:none';
  (document.body||document.documentElement).appendChild(probe);
  function toRGB(c){
    probe.style.color=''; probe.style.color=c;
    var s=getComputedStyle(probe).color;
    var n=s.replace(/[^0-9.,]/g,'').split(',');
    return [(+n[0]||0)/255,(+n[1]||0)/255,(+n[2]||0)/255];
  }
  function slot(entry, defToken){
    if(entry){ return (entry.charAt(0)==='#'||entry.indexOf('(')>=0) ? toRGB(entry) : toRGB('var(--sw-color-'+entry+')'); }
    return toRGB('var(--sw-color-'+defToken+', '+FALLBACK[defToken]+')');
  }
  function num(v, def, lo, hi){ var f=parseFloat(v); if(isNaN(f))return def; return Math.max(lo,Math.min(hi,f)); }
  function truthy(v){ return v==='true'||v==='1'||v==='yes'||v==='on'||v===''; }
  // Split data-colors on commas OUTSIDE parens, so literal rgb()/hsl() colors survive (their inner
  // commas must not split). Token names + hex have no parens and split normally.
  function splitColors(s){ var out=[],depth=0,cur=''; for(var i=0;i<s.length;i++){ var ch=s.charAt(i);
    if(ch==='(')depth++; else if(ch===')')depth--; if(ch===','&&depth<=0){ out.push(cur.trim()); cur=''; } else cur+=ch; }
    out.push(cur.trim()); return out; }

  function build(gl, glsl){
    var vs=gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs,VERT); gl.compileShader(vs);
    var fs=gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs,PRELUDE+glsl+MAIN); gl.compileShader(fs);
    if(!gl.getShaderParameter(fs,gl.COMPILE_STATUS)){ gl.deleteShader(vs); gl.deleteShader(fs); return null; }
    var p=gl.createProgram(); gl.attachShader(p,vs); gl.attachShader(p,fs); gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)){ gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteProgram(p); return null; }
    var quad=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,quad);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    return { p:p, quad:quad, aPos:gl.getAttribLocation(p,'aPos'), u:{
      time:gl.getUniformLocation(p,'uTime'), res:gl.getUniformLocation(p,'uRes'), mouse:gl.getUniformLocation(p,'uMouse'),
      c1:gl.getUniformLocation(p,'uC1'), c2:gl.getUniformLocation(p,'uC2'), c3:gl.getUniformLocation(p,'uC3'),
      intensity:gl.getUniformLocation(p,'uIntensity'), interact:gl.getUniformLocation(p,'uInteract'), angle:gl.getUniformLocation(p,'uAngle')
    }};
  }

  function init(host){
    if(host.getAttribute('data-sw-enhanced')==='true')return;
    var glsl=PRESETS[host.getAttribute('data-preset')]||PRESETS[DEF]; if(!glsl)return;
    var speed=num(host.getAttribute('data-speed'),1,0,4);
    var intensity=num(host.getAttribute('data-intensity'),0.5,0,1);
    var angle=num(host.getAttribute('data-angle'),0,-360,360)*Math.PI/180;
    var interactive=!reduce && host.hasAttribute('data-interactive') && truthy(host.getAttribute('data-interactive'));
    var cols=splitColors(host.getAttribute('data-colors')||'');

    var canvas=document.createElement('canvas'); canvas.setAttribute('data-sw-shader',''); canvas.setAttribute('aria-hidden','true');
    var glo={antialias:false,depth:false,alpha:false,premultipliedAlpha:false,powerPreference:'low-power'};
    var gl=canvas.getContext('webgl',glo)||canvas.getContext('experimental-webgl',glo);
    if(!gl)return; // leave the CSS gradient fallback in place
    var prog=build(gl,glsl); if(!prog)return;
    host.insertBefore(canvas, host.firstChild);

    var c1=[0,0,0],c2=[0,0,0],c3=[0,0,0], mouse=[0,0], pointer=null, time=0;
    function readColors(){ c1=slot(cols[0],'primary'); c2=slot(cols[1],'secondary'); c3=slot(cols[2],'neutral'); }
    readColors();

    function size(){ var w=Math.max(1,Math.round(host.clientWidth*DPR)), h=Math.max(1,Math.round(host.clientHeight*DPR));
      if(canvas.width!==w||canvas.height!==h){ canvas.width=w; canvas.height=h; } return [w,h]; }

    function draw(){
      var d=size(); gl.viewport(0,0,d[0],d[1]);
      gl.useProgram(prog.p); gl.bindBuffer(gl.ARRAY_BUFFER,prog.quad);
      gl.enableVertexAttribArray(prog.aPos); gl.vertexAttribPointer(prog.aPos,2,gl.FLOAT,false,0,0);
      gl.uniform1f(prog.u.time,time); gl.uniform2f(prog.u.res,d[0],d[1]);
      var ca=Math.cos(angle),sa=Math.sin(angle);
      gl.uniform2f(prog.u.mouse, mouse[0]*ca+mouse[1]*sa, -mouse[0]*sa+mouse[1]*ca);
      gl.uniform3fv(prog.u.c1,c1); gl.uniform3fv(prog.u.c2,c2); gl.uniform3fv(prog.u.c3,c3);
      gl.uniform1f(prog.u.intensity,intensity); gl.uniform1f(prog.u.interact,interactive?1:0); gl.uniform1f(prog.u.angle,angle);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }

    var animates=!reduce && (speed>0 || interactive);
    var running=false, raf=0, last=0, visible=true;
    function frame(now){
      if(!running)return;
      var dt=Math.min((now-last)/1000||0,0.05); last=now;
      if(speed>0) time+=dt*speed;
      var tx=interactive&&pointer?pointer[0]:0, ty=interactive&&pointer?pointer[1]:0;
      mouse[0]+=(tx-mouse[0])*0.08; mouse[1]+=(ty-mouse[1])*0.08;
      draw(); raf=requestAnimationFrame(frame);
    }
    function start(){ if(running||!animates)return; running=true; last=(window.performance&&performance.now())||0; raf=requestAnimationFrame(frame); }
    function stop(){ running=false; if(raf)cancelAnimationFrame(raf); raf=0; }
    function update(){ if(animates&&visible&&sharedShown){ start(); } else { stop(); draw(); } }

    if(interactive){
      host.addEventListener('pointermove',function(e){ var r=host.getBoundingClientRect(); if(!r.height)return;
        pointer=[(e.clientX-r.left-r.width*0.5)/r.height,(r.height*0.5-(e.clientY-r.top))/r.height]; });
      host.addEventListener('pointerleave',function(){ pointer=null; });
    }
    // Re-read CI colors when the active theme flips (the tokens change with data-sw-theme on <html>).
    var mo=new MutationObserver(function(){ readColors(); if(!running)draw(); });
    mo.observe(document.documentElement,{attributes:true,attributeFilter:['data-sw-theme','class','style']});
    if('ResizeObserver' in window){ new ResizeObserver(function(){ if(!running)draw(); }).observe(host); }

    draw(); // first paint (also the only frame under reduced-motion / static)
    host.setAttribute('data-sw-enhanced','true');

    if(animates){
      if('IntersectionObserver' in window){
        new IntersectionObserver(function(es){ visible=es[0].isIntersecting; update(); },{rootMargin:'128px'}).observe(host);
      }
      updaters.push(update);
      update();
    }
  }

  for(var i=0;i<hosts.length;i++) init(hosts[i]);
})();`;

const PRESET_GLSL: Record<string, string> = {};
for (const p of SHADER_BG_PRESETS) PRESET_GLSL[p.key] = p.glsl;

/** External, CSP-clean runtime for `data-sw-component="shader-bg"` (bundled into components.js). */
export const SHADER_BG_JS = RUNTIME.replace('__VERT__', () => JSON.stringify(SHADER_VERT))
  .replace('__PRELUDE__', () => JSON.stringify(SHADER_PRELUDE))
  .replace('__MAIN__', () => JSON.stringify(SHADER_MAIN))
  .replace('__PRESETS__', () => JSON.stringify(PRESET_GLSL))
  .replace('__DEF__', () => JSON.stringify(DEFAULT_SHADER_PRESET));
