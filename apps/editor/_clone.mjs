import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { ICON_NAMES, BRAND_ICON_NAMES } from '@sitewright/blocks';
const URL = process.argv[2] || 'https://www.advancedtechcc.com/';
const ROOT_SEL = process.argv[3] || '#content-wrapper';
const OUT = process.argv[4] || '/tmp/clone-home.html';
const MODE = process.argv[5] || ''; // 'navbar' → emit a responsive DaisyUI navbar from the captured logo + links

// Mobile-first breakpoints. We walk the SAME DOM at each width and capture per-viewport computed
// styles, then emit base (mobile) utilities + md:/lg: overrides — picking up the source's own
// responsive breakpoints instead of pinning a single 1280px snapshot.
const VIEWPORTS = [[390, ''], [768, 'md:'], [1280, 'lg:']];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => console.error('goto', e.message));

// NAVBAR MODE — a nav is JS-interactive (mobile toggle / dropdowns) which a mechanical capture can't
// reproduce. Instead emit a clean, RESPONSIVE DaisyUI navbar from the captured logo + links: a desktop
// menu + a mobile dropdown that opens on focus (CSS-only → works in the no-JS, sandboxed slot). No <nav>
// landmark inside (the platform wraps the topNav slot in <nav id="top-nav">).
if (MODE === 'navbar') {
  const navData = await p.evaluate((sel) => {
    const root = document.querySelector(sel) || document.body;
    const img = root.querySelector('img');
    const logo = img ? { src: img.currentSrc || img.src || '', alt: img.getAttribute('alt') || '' } : null;
    const seen = new Set(), links = [];
    for (const a of root.querySelectorAll('a')) {
      const text = a.textContent.replace(/\s+/g, ' ').trim();
      if (!text || text.length > 40 || a.querySelector('img')) continue; // skip the logo link + icon-only
      const key = text.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
      links.push({ text, href: a.getAttribute('href') || '' });
    }
    return { logo, links };
  }, ROOT_SEL);
  await b.close();
  // sw-url SANITIZES a URL (it does NOT resolve a bare slug) — so it needs a ROOT-RELATIVE path
  // ('/about-us'), not 'about-us' (which safeUrl rejects → '#'). Home → '/'.
  // DATA-DRIVEN nav: loop the platform's auto-built menu ({{#each nav.header}}) — NOT hard-coded per-page
  // links. {{sw-label}}/{{sw-url path}} come from each page's own nav config, so adding/renaming/reordering a
  // page updates the menu automatically. The CURRENT page is a cyan (secondary) pill via {{sw-active}} (no JS);
  // the rest carry the original's cyan underline.
  const desktopItem = `    {{#each nav.header}}
    <li><a href="{{sw-url path}}" class="px-3 py-2 font-medium no-underline transition-colors {{#if (sw-active path)}}rounded-full bg-secondary text-secondary-content{{else}}border-b-2 border-secondary text-base-content hover:text-secondary{{/if}}">{{sw-label}}</a></li>
    {{/each}}`;
  const mobileItem = `      {{#each nav.header}}
      <li><a href="{{sw-url path}}" class="block rounded-md px-3 py-2 font-medium no-underline {{#if (sw-active path)}}bg-secondary text-secondary-content{{else}}text-base-content hover:bg-base-200{{/if}}">{{sw-label}}</a></li>
      {{/each}}`;
  const logoHtml = navData.logo
    ? `<a href="{{sw-url '/'}}" class="flex shrink-0 items-center"><img src="${navData.logo.src}" alt="${navData.logo.alt || '{{company.name}}'}" class="h-10 w-auto max-w-full"></a>`
    : `<a href="{{sw-url '/'}}" class="font-heading text-xl font-bold text-primary no-underline">{{company.name}}</a>`;
  const html = `<div class="sw-container flex items-center gap-4 py-3">
  ${logoHtml}
  <ul class="ml-auto flex list-none items-center gap-2 max-lg:hidden">
${desktopItem}
  </ul>
  <details class="dropdown dropdown-end ml-auto lg:hidden">
    <summary class="btn btn-ghost btn-square list-none" aria-label="Open menu">{{sw-icon "menu" "h-6 w-6"}}</summary>
    <ul class="dropdown-content z-20 mt-2 w-56 list-none space-y-1 rounded-box bg-base-100 p-2 shadow-lg ring-1 ring-base-200">
${mobileItem}
    </ul>
  </details>
</div>
`;
  writeFileSync(OUT, html);
  console.error(`emitted navbar: logo=${!!navData.logo}, data-driven {{#each nav.header}}`);
  process.exit(0);
}

// The DOM walk that builds a styled tree at the CURRENT viewport. Structure (tags/text/attrs) is
// viewport-independent; the style map `s` (and the full-width / single-line flags folded into it) is
// captured per-viewport so the merge step can emit responsive variants.
const WALK = (ROOT_SEL) => {
  const INH = ['color','font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-align','text-transform','text-decoration-line','white-space'];
  const BOX = {
    'display':'block','position':'static','top':'auto','right':'auto','bottom':'auto','left':'auto','z-index':'auto','float':'none',
    'flex-direction':'row','flex-wrap':'nowrap','align-items':'normal','align-self':'auto','justify-content':'normal','align-content':'normal',
    'gap':'normal','column-gap':'normal','row-gap':'normal','grid-template-columns':'none','flex-grow':'0','flex-shrink':'1','flex-basis':'auto','order':'0',
    'width':'auto','height':'auto','min-width':'auto','min-height':'auto','max-width':'none','max-height':'none','box-sizing':'content-box','aspect-ratio':'auto',
    'margin-top':'0px','margin-right':'0px','margin-bottom':'0px','margin-left':'0px',
    'padding-top':'0px','padding-right':'0px','padding-bottom':'0px','padding-left':'0px',
    'border-top-width':'0px','border-right-width':'0px','border-bottom-width':'0px','border-left-width':'0px','border-radius':'0px',
    'background-color':'rgba(0, 0, 0, 0)','background-image':'none','background-size':'auto','background-position':'0% 0%','background-repeat':'repeat',
    'box-shadow':'none','opacity':'1','transform':'none','overflow':'visible','object-fit':'fill','text-decoration-color':'',
  };
  const skip = new Set(['script','style','noscript','br','svg','path','use','link','meta']); // keep <i> — FontAwesome icons
  function walk(el, pcs){
    const raw = el.tagName.toLowerCase(); if(skip.has(raw)) return null;
    // The platform OWNS the semantic landmarks (it wraps the page body + each chrome slot in
    // <nav>/<main>/<footer>/<aside>), and the no-JS validator rejects them inside a page source OR a
    // slot. Rename them to <div> so nativized CONTENT and CHROME both pass validation (<header> is allowed).
    const tag = ['nav','main','footer','aside'].includes(raw) ? 'div' : raw;
    const cs = getComputedStyle(el);
    // Full-width detection (this viewport): a block filling its parent's content box with ~0 side
    // margins was width:100%/auto → emit w-full (fluid), not a pinned px width.
    let fullW = false; const par = el.parentElement;
    if(par && pcs){ const pcw = par.clientWidth - parseFloat(pcs.paddingLeft||'0') - parseFloat(pcs.paddingRight||'0');
      const ml = parseFloat(cs.marginLeft||'0'), mr = parseFloat(cs.marginRight||'0');
      if(pcw>0 && Math.abs(ml)<1 && Math.abs(mr)<1 && el.getBoundingClientRect().width >= pcw-2) fullW = true; }
    const own = [...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').replace(/\s+/g,' ').trim();
    const s = {};
    for(const k of INH){ const v=cs.getPropertyValue(k); if(v && (own||!pcs||v!==pcs.getPropertyValue(k))) s[k]=v; }
    for(const k in BOX){ const v=cs.getPropertyValue(k); if(v && v!==BOX[k]) s[k]=v; }
    if(fullW) s.width='100%';
    // Lock SHORT single-line text as nowrap (this viewport): it was one line by design, often relying
    // on a condensed web font; a fallback font would wrap it. Short cap so real prose can still wrap.
    if(own && own.length<25){ const lh=parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.2; if(lh>0 && el.getBoundingClientRect().height<=lh*1.4) s['white-space']='nowrap'; }
    for(const sd of ['top','right','bottom','left']){ if(s[`border-${sd}-width`]){ s[`border-${sd}-style`]=cs.getPropertyValue(`border-${sd}-style`); s[`border-${sd}-color`]=cs.getPropertyValue(`border-${sd}-color`);} }
    if(own){ delete s.width; delete s.height; }
    const node={tag,s,children:[],text:own};
    // A flex child defaults to min-width:auto, so a fixed/large-content child won't shrink and overflows
    // a narrow row → mark it so we emit min-w-0 (the standard flex-overflow fix), letting it shrink to fit.
    node.pflex = !!(pcs && /flex/.test(pcs.display));
    // MOTION: the original's scroll-reveal (WOW.js / animate.css / AOS) is JS-driven and gets stripped.
    // Capture the COMPUTED animation — keyframe name + delay + duration — so we can re-express it as a
    // platform data-aos (effect + data-aos-delay + data-aos-duration). Fall back to the class string for
    // WOW elements whose animation already finished by capture time (animationName resets to 'none').
    { const an=cs.animationName, acl=el.getAttribute('class')||'';
      const name=(an&&an!=='none')?an:(acl.match(/\b(fadeIn\w*|slideIn\w*|zoomIn\w*|flipIn\w*|fadeOut\w*|zoomOut\w*)/i)?.[0]||null);
      if(name) node.anim={ name, delay:cs.animationDelay, dur:cs.animationDuration }; }
    if(tag==='img'){ const cur=el.currentSrc||el.src; let raw=(cur&&!/^data:|\/1x1|blank|placeholder/.test(cur))?cur:(el.getAttribute('data-src')||el.getAttribute('data-original')||el.getAttribute('data-lazy-src')||cur||''); try{node.src=raw?new URL(raw,location.href).href:'';}catch(e){node.src=raw||'';} node.alt=el.getAttribute('alt')||''; }
    if(tag==='a') node.href=el.getAttribute('href')||'';
    if(tag==='i'||tag==='span'){ node.icon=el.getAttribute('class')||''; if(/\bfa/.test(node.icon)){ node.iconSize=cs.fontSize; node.iconColor=cs.color; } } // FontAwesome icon → capture its size+color for {{sw-icon}}
    if(tag==='iframe'){ node.src=el.src||el.getAttribute('src')||''; node.title=el.getAttribute('title')||''; s.height=cs.getPropertyValue('height'); }
    // ROTATING TILES (3D flip cards): the source marks the card `.flippable` and its hidden face `.back`
    // (a matrix3d rotateY(180)). The flip mechanics are JS/CSS we strip → record them so emit() rebuilds a
    // working pure-Tailwind flip (perspective + preserve-3d + backface-hidden + group-hover rotateY).
    { const acl=el.getAttribute('class')||''; if(/\bflippable\b/.test(acl)){ node.flip=true; node.flipH=cs.getPropertyValue('height'); } if(/\bback\b/.test(acl)&&/matrix3d/.test(cs.transform)) node.isBack=true; }
    for(const c of el.children){ const cn=walk(c,cs); if(cn) node.children.push(cn); }
    return node;
  }
  const root = document.querySelector(ROOT_SEL)||document.querySelector('#main-content')||document.querySelector('main')||document.body;
  return [...root.children].map(c=>walk(c,getComputedStyle(root))).filter(Boolean);
};

// Capture one tree per viewport (smallest → largest; largest last so node.src holds the desktop image).
const trees = [];
for(const [w] of VIEWPORTS){
  await p.setViewportSize({ width: w, height: 1000 });
  await p.evaluate(async()=>{for(let y=0;y<=document.body.scrollHeight;y+=400){scrollTo(0,y);await new Promise(r=>setTimeout(r,60));}scrollTo(0,0);});
  await p.waitForTimeout(700);
  trees.push(await p.evaluate(WALK, ROOT_SEL));
}
await b.close();
const TBASE = trees[0], TMD = trees[1], TLG = trees[2]; // smallest..largest

// ─────────────────────────────── style → keyed utility groups ───────────────────────────────
const COLORS={'11,74,119':'primary','57,193,240':'secondary','12,163,200':'accent'};
const rgbKey=v=>{const m=(v||'').match(/(\d+),\s*(\d+),\s*(\d+)/);return m?`${m[1]},${m[2]},${m[3]}`:null;};
const hex=v=>{const m=(v||'').match(/(\d+),\s*(\d+),\s*(\d+)/);return m?'#'+[1,2,3].map(i=>(+m[i]).toString(16).padStart(2,'0')).join(''):v;};
const tok=v=>{const k=rgbKey(v);return k&&COLORS[k]?COLORS[k]:k==='255,255,255'?'white':k==='0,0,0'?'black':null;};
const cvar=v=>{const t=tok(v);return t&&t!=='white'&&t!=='black'?`var(--sw-color-${t})`:t==='white'?'#fff':t==='black'?'#000':hex(v);};
const A=v=>(v||'').replace(/\s+/g,'_');
const FONTS=[['text-font','font-body'],['primary-font','font-heading'],['client-font-1','font-client1'],['client-font-2','font-client2'],['secondary-font','font-heading'],['tertiary-font','font-sans']];

// DESIGN-TOKEN SNAPPING — map a px value onto Tailwind's scale so the output is short, idiomatic and
// THEME-EDITABLE (text-lg / p-4 / gap-6) instead of arbitrary [19.2px] soup. Tight tolerances keep the
// layout within ~1-2px of the capture; anything off the scale stays an exact arbitrary value.
const SPX=[0,1,2,4,6,8,10,12,14,16,20,24,28,32,36,40,44,48,56,64,80,96,112,128,144,160,176,192,208,224,240,256,288,320,384];
const STOK={0:'0',1:'px',2:'0.5',4:'1',6:'1.5',8:'2',10:'2.5',12:'3',14:'3.5',16:'4',20:'5',24:'6',28:'7',32:'8',36:'9',40:'10',44:'11',48:'12',56:'14',64:'16',80:'20',96:'24',112:'28',128:'32',144:'36',160:'40',176:'44',192:'48',208:'52',224:'56',240:'60',256:'64',288:'72',320:'80',384:'96'};
const nearest=(px,arr)=>arr.reduce((b,s)=>Math.abs(s-px)<Math.abs(b-px)?s:b,arr[0]);
const spTok=(v,tol)=>{const px=parseFloat(v);if(isNaN(px))return null;const b=nearest(px,SPX);return Math.abs(b-px)<=(tol??Math.max(1.5,px*0.06))?STOK[b]:null;};
const sp=(pre,v)=>{const t=spTok(v);return t!==null?`${pre}-${t}`:`${pre}-[${v}]`;}; // sp('p','16px') → 'p-4'
const FPX={12:'text-xs',14:'text-sm',16:'text-base',18:'text-lg',20:'text-xl',24:'text-2xl',30:'text-3xl',36:'text-4xl',48:'text-5xl',60:'text-6xl',72:'text-7xl',96:'text-8xl',128:'text-9xl'};
const fontCls=v=>{const px=parseFloat(v);if(isNaN(px))return`text-[${v}]`;const b=nearest(px,Object.keys(FPX).map(Number));return Math.abs(b-px)<=Math.max(1.5,px*0.08)?FPX[b]:`text-[${v}]`;};
const RPX={0:'rounded-none',2:'rounded-sm',4:'rounded',6:'rounded-md',8:'rounded-lg',12:'rounded-xl',16:'rounded-2xl',24:'rounded-3xl'};
const radCls=v=>{const px=parseFloat(v);if(isNaN(px))return`rounded-[${A(v)}]`;if(px>=400)return'rounded-full';const b=nearest(px,Object.keys(RPX).map(Number));return Math.abs(b-px)<=Math.max(2,px*0.12)?RPX[b]:`rounded-[${A(v)}]`;};
const dim=(pre,v,tol)=>{const t=spTok(v,tol??1);return t!==null?`${pre}-${t}`:`${pre}-[${v}]`;}; // tight snap for w/h/min-h (icons → w-4)

// Each utility goes under a KEY (its responsive property group) so the merge can override/reset it per
// breakpoint. Inline styles (st) are non-responsive (multi-layer shadow / elliptical radius / bg-image).
function emitGroups(s, tag, pflex){
  const g={}, st=[];
  if(s.color){const t=tok(s.color);g.color=`text-${t?t:`[${hex(s.color)}]`}`;}
  if(s['background-color']){const t=tok(s['background-color']);g.bg=`bg-${t?t:`[${hex(s['background-color'])}]`}`;}
  if(s['font-family']){const f=FONTS.find(([k])=>s['font-family'].includes(k));if(f)g.fontfam=f[1];}
  if(s['font-size'])g.fsize=fontCls(s['font-size']);
  if(s['font-weight'])g.fweight={'700':'font-bold','600':'font-semibold','500':'font-medium','400':'font-normal','300':'font-light'}[s['font-weight']]||`font-[${s['font-weight']}]`;
  if(s['font-style']==='italic')g.fstyle='italic';
  if(s['line-height']&&s['line-height']!=='normal'){const lt=spTok(s['line-height'],2.5);g.leading=lt!==null?`leading-${lt}`:`leading-[${s['line-height']}]`;}
  if(s['letter-spacing']&&s['letter-spacing']!=='normal')g.tracking=`tracking-[${s['letter-spacing']}]`;
  if(s['text-align']&&s['text-align']!=='start'&&s['text-align']!=='left')g.talign=`text-${s['text-align']}`;
  if(s['text-transform']&&s['text-transform']!=='none')g.ttransform=s['text-transform'];
  if(s['text-decoration-line']&&s['text-decoration-line']!=='none')g.tdecor=`[text-decoration-line:${s['text-decoration-line']}]`;
  if(s['white-space']&&s['white-space']!=='normal')g.whitespace=s['white-space']==='nowrap'?'whitespace-nowrap':`[white-space:${s['white-space']}]`;
  if(s.display)g.display={flex:'flex','inline-flex':'inline-flex',grid:'grid','inline-grid':'inline-grid','inline-block':'inline-block',inline:'inline',none:'hidden',block:'block'}[s.display]||`[display:${s.display}]`;
  if(s['flex-direction']==='column')g.flexdir='flex-col'; else if(s['flex-direction']&&s['flex-direction']!=='row')g.flexdir=`[flex-direction:${s['flex-direction']}]`;
  if(s['flex-wrap']==='wrap')g.flexwrap='flex-wrap';
  if(s['align-items']&&s['align-items']!=='normal')g.items=`items-${({'flex-start':'start','flex-end':'end',center:'center',stretch:'stretch',baseline:'baseline'})[s['align-items']]||s['align-items']}`;
  if(s['justify-content']&&s['justify-content']!=='normal')g.justify=`justify-${({'flex-start':'start','flex-end':'end',center:'center','space-between':'between','space-around':'around','space-evenly':'evenly'})[s['justify-content']]||s['justify-content']}`;
  // Capture column-gap / row-gap SEPARATELY — a 3-col footer with col-gap 32 + row-gap 48 must not
  // collapse to one `gap-12`. Equal → `gap-N`; different → `gap-x-N` + `gap-y-N`.
  { const cg=s['column-gap'], rg=s['row-gap'];
    if(cg&&cg!=='normal'&&rg&&rg!=='normal'){ if(cg===rg)g.gap=sp('gap',cg); else { g.gapx=sp('gap-x',cg); g.gapy=sp('gap-y',rg); } }
    else if(s.gap&&s.gap!=='normal'){ const pr=s.gap.split(/\s+/); if(pr.length===2&&pr[0]!==pr[1]){ g.gapy=sp('gap-y',pr[0]); g.gapx=sp('gap-x',pr[1]); } else g.gap=sp('gap',pr[0]); } }
  if(s['grid-template-columns']&&s['grid-template-columns']!=='none'){
    // getComputedStyle resolves `1fr 1fr` / `2fr 1fr` to px (e.g. "768px 384px"), which would pin a fluid
    // grid to fixed tracks that overflow narrower viewports. Re-fluidize: equal px tracks → grid-cols-N;
    // unequal px tracks → PROPORTIONAL fr (keeps the ratio, shares the row). Non-px tracks kept as-is.
    const tr=s['grid-template-columns'].trim().split(/\s+/), px=tr.map(parseFloat);
    const allPx=px.length===tr.length&&px.length>0&&px.every(n=>!isNaN(n)&&n>0);
    const allEq=allPx&&px.every(n=>Math.abs(n-px[0])<=Math.max(2,px[0]*0.05));
    g.gridcols=allEq?`grid-cols-${tr.length}`:allPx?`grid-cols-[${px.map(n=>`minmax(0,${Math.round(n)}fr)`).join('_')}]`:`grid-cols-[${A(s['grid-template-columns'])}]`;
  }
  if(s.position&&s.position!=='static')g.position=s.position;
  if(s['z-index']&&s['z-index']!=='auto')g.zindex=`z-[${s['z-index']}]`;
  for(const [pp,pre] of [['top','top'],['right','right'],['bottom','bottom'],['left','left']]) if(s[pp]&&s[pp]!=='auto'&&s[pp]!=='0px')g[pre]=dim(pre,s[pp]); // skip no-op 0 insets; snap the rest
  // width: a centered fixed-width container → responsive `w-full max-w-[W]` (caps + fluid); a plain fixed
  // width → pin it BUT cap with max-w-full so it can never exceed a narrow viewport (no small-device overflow).
  const ml=s['margin-left'],mr=s['margin-right'];
  const centered=(ml&&mr&&ml===mr&&parseFloat(ml)>0);
  if(s.width&&s.width!=='auto'){ if(s.width==='100%')g.w='w-full'; else if(centered){g.w='w-full';g.maxw=dim('max-w',s.width);} else {g.w=dim('w',s.width);g.maxw='max-w-full';} }
  // height: pin only for an <iframe> (video/map); a background BAND keeps a min-h floor (it needs height
  // even if empty); plain content containers size to CONTENT — a min-h floor would leave empty space when
  // content reflows shorter at another breakpoint. Images go responsive (h-auto) below.
  if(s.height&&s.height!=='auto'&&s.height!=='100%'){
    if(tag==='iframe')g.h=dim('h',s.height);
    else if(tag!=='img'&&s.overflow==='hidden')g.h=dim('h',s.height); // a CLIPPING viewport (slider/carousel) needs its height to clip — without it the slides expand
    else if(tag!=='img'&&s['background-image']&&s['background-image']!=='none')g.minh=dim('min-h',s.height); // background BAND → floor (can grow)
  }
  if(s['min-height']&&s['min-height']!=='auto'&&s['min-height']!=='0px')g.minh=dim('min-h',s['min-height']);
  if(s['max-width']&&s['max-width']!=='none')g.maxw=s['max-width']==='100%'?'max-w-full':dim('max-w',s['max-width']);
  // Responsive images: never exceed their column, keep aspect (auto height) when they shrink.
  if(tag==='img'){ g.h='h-auto'; if(!g.maxw)g.maxw='max-w-full'; }
  // box-border is redundant — the platform base CSS sets `box-sizing:border-box` on everything.
  for(const base of ['margin','padding']){const pf=base==='margin'?'m':'p',t=s[`${base}-top`],r=s[`${base}-right`],bo=s[`${base}-bottom`],l=s[`${base}-left`],au=pf==='m';
    const tv=parseFloat(t||'0'),bv=parseFloat(bo||'0'),lv=parseFloat(l||'0'),rv=parseFloat(r||'0');
    // VERTICAL: a flex child centered with `margin-block:auto` resolves to ~equal top/bottom px via
    // getComputedStyle. Detect it APPROXIMATELY (sub-pixel rounding makes the two sides differ by ≤2px,
    // which otherwise emits a FROZEN px offset that breaks centering) → restore my-auto so it re-centers
    // as the band grows. Must be a flex child (else equal margins are intentional spacing → keep px).
    if(au&&pflex&&t&&bo&&Math.abs(tv-bv)<=2&&tv>4)g.my='my-auto';
    else if(t&&bo&&t===bo)g[pf+'y']=sp(`${pf}y`,t);
    else{if(t)g[pf+'t']=sp(`${pf}t`,t);if(bo)g[pf+'b']=sp(`${pf}b`,bo);}
    // HORIZONTAL: equal left/right → mx-auto (centered); a flex child's asymmetric auto → ml-auto/mr-auto.
    if(l&&r&&Math.abs(lv-rv)<=2&&(au?lv>0:true)){g[pf+'x']=au?'mx-auto':sp(`${pf}x`,l);}
    else{
      if(au&&pflex&&lv>rv+24){g.ml='ml-auto';if(r)g.mr=sp('mr',r);}
      else if(au&&pflex&&rv>lv+24){g.mr='mr-auto';if(l)g.ml=sp('ml',l);}
      else{if(l)g[pf+'l']=sp(`${pf}l`,l);if(r)g[pf+'r']=sp(`${pf}r`,r);}}}
  for(const sd of ['top','right','bottom','left']){const w=s[`border-${sd}-width`];if(w)g['border'+sd]=`[border-${sd}:${w}_${s[`border-${sd}-style`]||'solid'}_${cvar(s[`border-${sd}-color`])}]`;}
  if(s['border-radius']){ if(s['border-radius'].includes('/')) st.push(`border-radius:${s['border-radius']}`); else g.radius=radCls(s['border-radius']); }
  if(s['box-shadow']&&s['box-shadow']!=='none')st.push(`box-shadow:${s['box-shadow']}`);
  if(s.opacity&&s.opacity!=='1')g.opacity=`opacity-[${s.opacity}]`;
  if(s.transform&&s.transform!=='none'&&!/matrix3d/.test(s.transform)&&!/^matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\)$/.test(s.transform))g.transform=`[transform:${A(s.transform)}]`;
  if(s.overflow&&s.overflow!=='visible')g.overflow=`overflow-${s.overflow}`;
  if(s['object-fit']&&s['object-fit']!=='fill')g.objectfit=`object-${s['object-fit']}`;
  if(s['aspect-ratio']&&s['aspect-ratio']!=='auto')g.aspect=`aspect-[${s['aspect-ratio'].replace(/\s*\/\s*/,'/').replace(/\s+/g,'/')}]`;
  if(s['background-image']&&s['background-image']!=='none'){const bg=s['background-image'].replace(/"/g,"'");st.push(`background-image:${bg};background-size:${(s['background-size']||'cover').split(',')[0]};background-position:${(s['background-position']||'center').split(',')[0]};background-repeat:${(s['background-repeat']||'no-repeat').split(',')[0]}`);}
  return {g,st};
}

// To turn a property OFF at a larger breakpoint (set at base but absent later) we emit its default.
const RESET={ w:'w-auto',h:'h-auto',minh:'min-h-0',maxw:'max-w-none',display:'block',flexdir:'flex-row',flexwrap:'flex-nowrap',
  items:'items-stretch',justify:'justify-start',gap:'gap-0',gapx:'gap-x-0',gapy:'gap-y-0',gridcols:'grid-cols-none',talign:'text-left',ttransform:'normal-case',
  tdecor:'no-underline',whitespace:'whitespace-normal',position:'static',zindex:'z-auto',top:'top-auto',right:'right-auto',bottom:'bottom-auto',left:'left-auto',
  aspect:'aspect-auto',overflow:'overflow-visible',opacity:'opacity-100',
  mt:'mt-0',mb:'mb-0',my:'my-0',ml:'ml-0',mr:'mr-0',mx:'mx-0',pt:'pt-0',pb:'pb-0',py:'py-0',pl:'pl-0',pr:'pr-0',px:'px-0' };

// Merge per-breakpoint group maps (small→large) into one mobile-first class list with md:/lg: overrides.
function mergeGroups(maps){
  const keys=new Set(); maps.forEach(m=>Object.keys(m.g).forEach(k=>keys.add(k)));
  const out=[];
  for(const k of keys){
    let prev;
    for(const m of maps){
      const v=m.g[k];
      const eff = v!==undefined ? v : (prev!==undefined && RESET[k]!==undefined ? RESET[k] : undefined);
      if(eff!==undefined && eff!==prev){ out.push((m.bp||'')+eff); prev=eff; }
      else if(eff===undefined) prev=undefined;
    }
  }
  return out;
}

// Walk the three same-shape trees in parallel → final node with merged responsive classes.
// Map an animate.css/WOW keyframe name → a platform data-aos effect. Directions follow animate.css
// semantics (fadeInLeft ENTERS from the left → AOS fade-right). Returns null for non-reveal keyframes
// (continuous spin/pulse/etc.) — those can't be expressed as a one-shot scroll reveal.
const mapAosEffect=c=>{ if(!c) return null;
  if(/(fadeInLeft|slideInLeft|fade-?left)/i.test(c)) return 'fade-right';
  if(/(fadeInRight|slideInRight|fade-?right)/i.test(c)) return 'fade-left';
  if(/(fadeInDown|slideInDown|fade-?down)/i.test(c)) return 'fade-down';
  if(/(fadeInUp|slideInUp|fade-?up)/i.test(c)) return 'fade-up';
  if(/(zoomIn|zoom-?in)/i.test(c)) return 'zoom-in';
  if(/(zoomOut|zoom-?out)/i.test(c)) return 'zoom-out';
  if(/flip/i.test(c)) return 'flip-up';
  if(/(fadeIn|^fade$)/i.test(c)) return 'fade';
  if(/(wow|animated|animate__)/i.test(c)) return 'fade-up'; // generic reveal hint → tasteful default
  return null;
};
const ms=v=>{ if(!v) return 0; const m=String(v).match(/([\d.]+)\s*(ms|s)?/); if(!m) return 0; let n=parseFloat(m[1]); if(m[2]!=='ms') n*=1000; return Math.max(0,Math.min(5000,Math.round(n))); };
// Build the data-aos attribute set from a captured {name,delay,dur}, or null if it isn't a scroll reveal.
const aosAttrs=a=>{ if(!a) return null; const effect=mapAosEffect(a.name); if(!effect) return null;
  const delay=ms(a.delay); const dur=ms(a.dur);
  const at={ effect }; if(delay>=50) at.delay=Math.round(delay/50)*50; if(dur>=100 && Math.abs(dur-400)>50) at.dur=dur; return at; };
// HEURISTIC icon mapper — mirrors the PRODUCTIONIZED version in @sitewright/site-import/nativize/icon-map.ts
// (kept inline here because this throwaway spike isn't a dependency of that package). Normalize an FA class
// + match it against the platform's ACTUAL icon sets (Lucide + brand) + a small alias table. → {{sw-icon}}.
const LUCIDE = new Set(ICON_NAMES);
const BRANDS = new Set(BRAND_ICON_NAMES);
const ICON_ALIAS = {
  suitcase:'briefcase', envelope:'mail', 'paper-plane':'send', 'map-marker':'map-pin', 'location-arrow':'navigation',
  'location-dot':'map-pin', bars:'menu', times:'x', close:'x', xmark:'x', 'check-circle':'circle-check',
  'times-circle':'circle-x', 'pencil-square':'square-pen', edit:'square-pen', 'pen-to-square':'square-pen',
  cog:'settings', gear:'settings', cogs:'settings', tachometer:'gauge', 'life-ring':'life-buoy', home:'house',
  trash:'trash-2', 'info-circle':'info', 'exclamation-circle':'circle-alert', 'exclamation-triangle':'triangle-alert',
  'question-circle':'circle-help', comment:'message-square', comments:'message-square', mobile:'smartphone',
  'eye-slash':'eye-off', unlock:'lock-open', 'bar-chart':'chart-column', 'line-chart':'chart-line', 'pie-chart':'chart-pie',
  'quote-left':'quote', 'quote-right':'quote', headset:'headphones', 'angle-right':'chevron-right', 'angle-left':'chevron-left',
  'angle-up':'chevron-up', 'angle-down':'chevron-down', 'angle-double-right':'chevrons-right', 'angle-double-left':'chevrons-left',
  'sign-in':'log-in', 'sign-out':'log-out', 'plus-circle':'circle-plus', 'minus-circle':'circle-minus', dollar:'dollar-sign',
  usd:'dollar-sign', picture:'image', photo:'image', 'shopping-cart':'shopping-cart', 'paint-brush':'paintbrush',
  magic:'wand-sparkles', bolt:'zap', flash:'zap', file:'file-text', 'thumbs-o-up':'thumbs-up', 'external-link':'external-link',
};
const BRAND_ALIAS = { twitter:'x', 'x-twitter':'x', 'facebook-f':'facebook', 'facebook-square':'facebook',
  'facebook-official':'facebook', 'youtube-play':'youtube', 'youtube-square':'youtube', 'pinterest-p':'pinterest' };
const FA_MODIFIER = /^(\d+x|fw|lg|sm|xs|spin|pulse|border|pull-left|pull-right|inverse|li|stack|stack-1x|stack-2x|rotate-\d+|flip-\w+|fixed-width)$/;
function mapIcon(classStr){
  if(!classStr) return null;
  let raw=null;
  for(const t of classStr.split(/\s+/)){ const m=t.match(/^fa-(.+)$/); if(m && !FA_MODIFIER.test(m[1])){ raw=m[1]; break; } }
  if(!raw) return null;
  const base=raw.replace(/-o$/,'').replace(/-alt$/,'');
  if(raw==='linkedin'||raw==='linkedin-in'||base==='linkedin') return 'linkedin';
  if(BRAND_ALIAS[raw]) return 'brand:'+BRAND_ALIAS[raw];
  if(BRANDS.has(raw)) return 'brand:'+raw;
  if(BRANDS.has(base)) return 'brand:'+base;
  if(LUCIDE.has(raw)) return raw;
  if(LUCIDE.has(base)) return base;
  if(ICON_ALIAS[raw] && LUCIDE.has(ICON_ALIAS[raw])) return ICON_ALIAS[raw];
  if(ICON_ALIAS[base] && LUCIDE.has(ICON_ALIAS[base])) return ICON_ALIAS[base];
  if(LUCIDE.has(base+'s')) return base+'s';
  if(base.endsWith('s') && LUCIDE.has(base.slice(0,-1))) return base.slice(0,-1);
  return null;
}
function mergeTree(nb, nm, nl, inSlider, pTrack){
  const maps = [ {bp:VIEWPORTS[0][1], ...emitGroups(nb.s, nl.tag, nb.pflex)}, {bp:VIEWPORTS[1][1], ...emitGroups(nm.s, nl.tag, nm.pflex)}, {bp:VIEWPORTS[2][1], ...emitGroups(nl.s, nl.tag, nl.pflex)} ];
  const cw=parseFloat(nl.s.width||''), cml=parseFloat(nl.s['margin-left']||'0'), cmr=parseFloat(nl.s['margin-right']||'0');
  // CAROUSEL: a JS slider (slick/Embla/swiper) leaves a huge transformed TRACK (e.g. w-[45000px]) inside
  // an overflow-hidden VIEWPORT. We can't run the source's JS, so we re-express it with the PLATFORM's own
  // carousel: the viewport becomes data-sw-component="carousel" (auto-scrolling ticker), the track gets
  // data-sw-part="track", and each slide data-sw-part="slide" — so the logos actually rotate again.
  const isTrack = cw > 2500;
  const hasTrackChild = nl.children.some((c) => parseFloat((c.s || {}).width || '0') > 2500);
  const isSlide = !!pTrack;
  const slider = !!(inSlider || isTrack || hasTrackChild);
  // CONTENT CONTAINER: a wide, horizontally-centered structural block (at desktop) is a section's main
  // content wrapper → emit the site-wide `.sw-container` instead of a captured per-section width.
  const isContainer = !slider && cw>=760 && cml>0 && Math.abs(cml-cmr)<2 && nl.tag!=='img' && nl.tag!=='iframe' && nl.children.length>0;
  if(isContainer) for(const m of maps) for(const k of ['w','maxw','mx','px','pl','pr']) delete m.g[k];
  let cls, marqueeTrack=false, swMarquee=false;
  // The source's slick slider auto-cycles its logos. Re-express it with the PLATFORM's official CSS-only
  // marquee primitive: the viewport gets `data-sw-marquee` (which ships MARQUEE_CSS + animates the scroll),
  // the track is `.sw-marquee-track`, each slide is `.sw-marquee-item` (the platform CSS height-locks the
  // logos uniformly). emit() duplicates the track's slides for the seamless loop. No per-site injected CSS.
  if(hasTrackChild){ swMarquee=true; cls=''; } // the VIEWPORT → data-sw-marquee
  else if(isTrack){ marqueeTrack=true; cls='sw-marquee-track'; } // the TRACK
  else if(isSlide){ cls='sw-marquee-item'; } // each SLIDE (a logo cell; platform CSS sizes the <img>)
  else {
    cls = (isContainer?'sw-container ':'') + mergeGroups(maps).join(' ');
    if(nl.pflex && !isContainer) cls=(cls?cls+' ':'')+'min-w-0';
  }
  if(nl.tag==='a' && (nl.s['text-decoration-line']||'none')!=='underline') cls=(cls?cls+' ':'')+'no-underline';
  let swicon=null;
  if((nl.tag==='i'||nl.tag==='span') && nl.icon){
    swicon = mapIcon(nl.icon); // mirrors the productionized @sitewright/site-import mapFaIcon
    if(!swicon){ const fa=nl.icon.split(/\s+/).filter((x)=>/^fa([bsrl]?$|-)/.test(x)).join(' '); if(fa) cls=(cls?cls+' ':'')+fa; } // unmapped → keep FA
  }
  const node={ tag:nl.tag, text:nl.text, href:nl.href, src:nl.src, alt:nl.alt, swicon, iconSize:nl.iconSize, iconColor:nl.iconColor, marqueeTrack, swMarquee, flip:nl.flip, isBack:nl.isBack, flipH:nl.flipH, aos:(slider||nl.tag==='img')?null:aosAttrs(nl.anim), title:nl.title, cls, style:maps[2].st.filter(Boolean).join(';'), children:[] };
  const e={s:{},children:[]};
  for(let i=0;i<nl.children.length;i++) node.children.push(mergeTree(nb.children[i]||e, nm.children[i]||e, nl.children[i], slider, isTrack));
  return node;
}
const merged = TLG.map((n,i)=>mergeTree(TBASE[i]||{s:{},children:[]}, TMD[i]||{s:{},children:[]}, n, false, false));

// ─────────────────────────────── tree → HTML ───────────────────────────────
// sw-url SANITIZES a URL — pass a ROOT-RELATIVE path ('/services'), not a bare slug (→ '#'). Keep a #anchor outside.
const swUrl=h=>{if(!h)return h;let x=h.replace(/^https?:\/\/(www\.)?advancedtechcc\.com/,'').replace(/^\.\//,'/');if(x===''||x==='/'||x==='.')return `{{sw-url '/'}}`;const m=x.match(/^\/([a-z0-9-]+)\/?(#[^"']*)?$/i);return m?`{{sw-url '/${m[1]}'}}${m[2]||''}`:h;};
const VOID=new Set(['img','input','br','hr']); // NB: <iframe> is NOT void
// Logos captured from a marquee → handed to the logo-marquee WIDGET's config dataset at deploy time
// (so the page references the platform primitive instead of hard-coding the strip + its CSS).
const MARQUEE_LOGOS = [];
function emit(n,d){const ind='  '.repeat(d);
  // MARQUEE → SNAP to the official `logo-marquee` widget: emit its partial and collect the captured logos
  // for its config, rather than reconstructing the strip inline. The widget owns the markup, CSS, and the
  // editable config (logo list / folder / speed) — so the result is customizable, not hard-coded.
  if(n.swMarquee){ (function ci(x){ if(x.tag==='img'&&x.src&&!MARQUEE_LOGOS.some((m)=>m.image===x.src)) MARQUEE_LOGOS.push({image:x.src,alt:x.alt||''}); (x.children||[]).forEach(ci); })(n); return ind+'{{> logo-marquee}}'; }
  // ROTATING TILE (flip card): rebuild a working pure-Tailwind 3D flip from the captured front (non-.back
  // children) + back (.back child's content). perspective + preserve-3d + backface-hidden + group-hover flip.
  if(n.flip){
    // Don't wrap the source's messy face markup (each face had its OWN absolute positioning + bg → both
    // bled through). EXTRACT the essentials — icon, front title, back description — into CLEAN flip faces.
    const h = n.flipH ? dim('h', String(Math.round(parseFloat(n.flipH)))+'px', 4) : 'h-56';
    // `.back` is nested (.flippable > .card > [front + .back]) → find it ANYWHERE, not just direct children.
    const findBack = (ns)=>{ for(const x of ns){ if(x.isBack) return x; const f=findBack(x.children||[]); if(f) return f; } return null; };
    const findIcon = (ns,skip)=>{ for(const x of ns){ if(x===skip) continue; if(x.swicon) return x.swicon; const f=findIcon(x.children||[],skip); if(f) return f; } return null; };
    const allText = (ns,skip)=>{ let t=''; for(const x of ns){ if(x===skip) continue; if(x.text) t+=x.text+' '; t+=allText(x.children||[],skip); } return t.replace(/\s+/g,' ').trim(); };
    const backNode = findBack(n.children);
    const icon = findIcon(n.children, backNode) || 'square';
    const title = allText(n.children, backNode);                 // front text, EXCLUDING the back subtree
    let desc = backNode ? allText([backNode]) : '';              // the back description
    if(title && desc.startsWith(title)) desc = desc.slice(title.length).trim(); // back repeats the title → drop it
    return `${ind}<div class="group ${h} perspective-distant">
${ind}  <div class="relative h-full w-full transition-transform duration-700 transform-3d group-hover:rotate-y-180">
${ind}    <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-box bg-base-100 p-6 text-center shadow backface-hidden">
${ind}      {{sw-icon "${icon}" "h-10 w-10 text-primary"}}
${ind}      <h3 class="font-heading text-lg font-semibold text-base-content">${title}</h3>
${ind}    </div>
${ind}    <div class="absolute inset-0 flex items-center justify-center rounded-box bg-primary p-6 text-center text-primary-content shadow rotate-y-180 backface-hidden">
${ind}      <p>${desc}</p>
${ind}    </div>
${ind}  </div>
${ind}</div>`;
  }
  // An icon element → the platform {{sw-icon}} helper, honoring the ORIGINAL icon's size + color (an SVG
  // uses currentColor, so the size goes on h-/w- and the color on text-*). Size snaps loosely (icons don't
  // need exact px); color → a brand token when it matches, else the literal hex.
  if(n.swicon){
    const szN = n.iconSize ? Math.round(parseFloat(n.iconSize)) : 0;
    const size = szN ? `${dim('h',szN+'px',3)} ${dim('w',szN+'px',3)}` : 'h-[1em] w-[1em]';
    const t = n.iconColor ? tok(n.iconColor) : null;
    const color = n.iconColor ? (t ? `text-${t}` : `text-[${hex(n.iconColor)}]`) : '';
    return ind+`{{sw-icon "${n.swicon}" "inline-block align-[-0.125em] ${size}${color?' '+color:''}"}}`;
  }
  const at=[];if(n.cls)at.push(`class="${n.cls}"`);if(n.style)at.push(`style="${n.style}"`);if(n.ariaHidden)at.push('aria-hidden="true"');if(n.swMarquee)at.push('data-sw-marquee','aria-label="Partners"');if(n.marqueeDup)at.push('data-sw-marquee-dup');if(n.aos){at.push(`data-aos="${n.aos.effect}"`);if(n.aos.delay)at.push(`data-aos-delay="${n.aos.delay}"`);if(n.aos.dur)at.push(`data-aos-duration="${n.aos.dur}"`);}
  if(n.tag==='img'){at.push(`src="${n.src}"`);if(n.alt)at.push(`alt="${n.alt}"`);at.push('loading="lazy"');}
  if(n.tag==='a')at.push(`href="${swUrl(n.href)}"`);
  if(n.tag==='iframe'){at.push(`src="${n.src}"`);if(n.title)at.push(`title="${n.title}"`);at.push('loading="lazy"');}
  const open=`<${n.tag}${at.length?' '+at.join(' '):''}>`;if(VOID.has(n.tag))return ind+open;
  const inner=[];if(n.text)inner.push('  '.repeat(d+1)+n.text);for(const ch of n.children)inner.push(emit(ch,d+1));
  // Marquee seamless loop: render the slide set TWICE (the 2nd copy aria-hidden + data-sw-marquee-dup so
  // reduced-motion can drop it) so the platform's translateX(-50%) keyframe wraps without a visible seam.
  if(n.marqueeTrack&&n.children.length)for(const ch of n.children)inner.push(emit({...ch,ariaHidden:true,marqueeDup:true},d+1));
  return inner.length?`${ind}${open}\n${inner.join('\n')}\n${ind}</${n.tag}>`:`${ind}${open}</${n.tag}>`;}

const imgs=new Set();(function ci(ns){for(const n of ns){if(n.src&&/^https?:/.test(n.src))imgs.add(n.src);const m=(n.style||'').match(/url\(["']?([^"')]+)/);if(m&&/^https?:/.test(m[1]))imgs.add(m[1]);ci(n.children||[]);}})(merged);
writeFileSync('/tmp/clone-imgs.txt',[...imgs].join('\n'));
writeFileSync(OUT, merged.map(n=>emit(n,0)).join('\n'));
// Sidecar: the logos the page's marquee snapped to the logo-marquee widget → deploy populates dataset.marquee.
if(MARQUEE_LOGOS.length) writeFileSync(OUT.replace(/\.html$/,'')+'.marquee.json', JSON.stringify(MARQUEE_LOGOS));
console.error(`emitted ${merged.length} sections, ${imgs.size} images${MARQUEE_LOGOS.length?`, snapped marquee → {{> logo-marquee}} (${MARQUEE_LOGOS.length} logos)`:''} (responsive: ${VIEWPORTS.map(v=>v[0]).join('/')})`);
