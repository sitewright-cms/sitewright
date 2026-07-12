import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const URL = process.argv[2] || 'https://www.advancedtechcc.com/';
const ROOT_SEL = process.argv[3] || '#content-wrapper';
const OUT = process.argv[4] || '/tmp/clone-body.html';

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(e => console.error('goto', e.message));
await p.waitForTimeout(2500);

// ---- in-page: walk the content root, capture per-element diffed computed styles ----
const tree = await p.evaluate((ROOT_SEL) => {
  const INHERIT = ['color','font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-align','text-transform'];
  const BOX = ['display','position','top','right','bottom','left','z-index','flex-direction','align-items','justify-content','flex-wrap','gap',
    'width','height','max-width','min-height','margin-top','margin-right','margin-bottom','margin-left',
    'padding-top','padding-right','padding-bottom','padding-left','border-top-width','border-right-width','border-bottom-width','border-left-width',
    'border-top-color','border-style','border-radius','box-shadow','background-color','background-image','background-size','background-position',
    'object-fit','opacity','overflow'];
  const DEF = {position:'static','z-index':'auto',width:'auto',height:'auto','max-width':'none','min-height':'auto',
    'border-radius':'0px','box-shadow':'none','background-color':'rgba(0, 0, 0, 0)','background-image':'none','object-fit':'fill',opacity:'1',overflow:'visible',
    'flex-wrap':'nowrap',gap:'normal','background-size':'auto','background-position':'0% 0%','border-style':'none'};
  const skipTags = new Set(['script','style','svg','path','noscript','br','i','use']);
  function walk(el, pcs) {
    const tag = el.tagName.toLowerCase();
    if (skipTags.has(tag)) return null;
    const cs = getComputedStyle(el);
    const s = {};
    for (const k of INHERIT) { const v = cs.getPropertyValue(k); if (v && (!pcs || v !== pcs.getPropertyValue(k))) s[k] = v; }
    for (const k of BOX) {
      const v = cs.getPropertyValue(k);
      if (!v) continue;
      if (k.startsWith('margin')||k.startsWith('padding')||k.endsWith('-width')) { if (v!=='0px') s[k]=v; continue; }
      if (k==='display') { if (['flex','inline-flex','grid','inline-grid','inline-block','none','inline'].includes(v)) s[k]=v; continue; }
      if (k==='top'||k==='right'||k==='bottom'||k==='left') { if (cs.position!=='static' && v!=='auto') s[k]=v; continue; }
      if (DEF[k]!==undefined) { if (v!==DEF[k]) s[k]=v; continue; }
      s[k]=v;
    }
    const node = { tag, s, children: [], text: '' };
    if (tag==='img') { node.src=el.getAttribute('src'); node.srcset=el.getAttribute('srcset')||''; node.alt=el.getAttribute('alt')||''; }
    if (tag==='a') node.href=el.getAttribute('href')||'';
    if (tag==='iframe') { node.src=el.getAttribute('src')||''; node.title=el.getAttribute('title')||''; }
    // direct text
    node.text = [...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').replace(/\s+/g,' ').trim();
    for (const c of el.children) { const cn = walk(c, cs); if (cn) node.children.push(cn); }
    return node;
  }
  const root = document.querySelector(ROOT_SEL) || document.querySelector('#main-content') || document.querySelector('main') || document.body;
  return [...root.children].map(c => walk(c, getComputedStyle(root))).filter(Boolean);
}, ROOT_SEL);

// ---- node: map diffed computed styles -> Tailwind utilities ----
const COLORS = { '11,74,119':'primary','57,193,240':'secondary','12,163,200':'accent' };
const rgbKey = (v) => { const m=v.match(/(\d+),\s*(\d+),\s*(\d+)/); return m?`${m[1]},${m[2]},${m[3]}`:null; };
const hex = (v) => { const m=v.match(/(\d+),\s*(\d+),\s*(\d+)/); if(!m) return v; return '#'+[1,2,3].map(i=>(+m[i]).toString(16).padStart(2,'0')).join(''); };
const colorTok = (v) => { const k=rgbKey(v); if(k&&COLORS[k]) return COLORS[k]; if(k==='255,255,255') return 'white'; if(k==='0,0,0') return 'black'; return `[${hex(v)}]`; };
const px = (v) => v.replace(/\s+/g,'_');
const FONTS = [['text-font','font-body'],['primary-font','font-heading'],['client-font-1','font-client1'],['client-font-2','font-client2'],['secondary-font','font-heading'],['tertiary-font','font-sans']];
function fourSide(s, base) {
  const t=s[`${base}-top`], r=s[`${base}-right`], bo=s[`${base}-bottom`], l=s[`${base}-left`];
  const pfx = base==='margin'?'m':'p'; const out=[];
  if (t&&r&&bo&&l && t===r&&r===bo&&bo===l) return [`${pfx}-[${t}]`];
  if (t&&bo&&t===bo) out.push(`${pfx}y-[${t}]`); else { if(t)out.push(`${pfx}t-[${t}]`); if(bo)out.push(`${pfx}b-[${bo}]`); }
  if (l&&r&&l===r) out.push(`${pfx}x-[${l}]`); else { if(l)out.push(`${pfx}l-[${l}]`); if(r)out.push(`${pfx}r-[${r}]`); }
  return out;
}
function classesFor(s) {
  const c = []; const styleExtra = [];
  if (s.color) c.push(`text-${colorTok(s.color)}`);
  if (s['background-color']) c.push(`bg-${colorTok(s['background-color'])}`);
  if (s['font-family']) { const f=FONTS.find(([k])=>s['font-family'].includes(k)); if(f) c.push(f[1]); }
  if (s['font-size']) c.push(`text-[${s['font-size']}]`);
  if (s['font-weight']) { const w=s['font-weight']; c.push({'700':'font-bold','600':'font-semibold','500':'font-medium','400':'font-normal','300':'font-light'}[w]||`font-[${w}]`); }
  if (s['font-style']==='italic') c.push('italic');
  if (s['line-height'] && s['line-height']!=='normal') c.push(`leading-[${s['line-height']}]`);
  if (s['letter-spacing'] && s['letter-spacing']!=='normal') c.push(`tracking-[${s['letter-spacing']}]`);
  if (s['text-align'] && s['text-align']!=='left') c.push(`text-${s['text-align']}`);
  if (s['text-transform'] && s['text-transform']!=='none') c.push(s['text-transform']);
  if (s.display) c.push({flex:'flex','inline-flex':'inline-flex',grid:'grid','inline-block':'inline-block',inline:'inline',none:'hidden'}[s.display]||'');
  if (s['flex-direction']==='column') c.push('flex-col');
  if (s['align-items']) c.push(`items-${{'flex-start':'start','flex-end':'end',center:'center',stretch:'stretch',baseline:'baseline'}[s['align-items']]||s['align-items']}`);
  if (s['justify-content']) c.push(`justify-${{'flex-start':'start','flex-end':'end',center:'center','space-between':'between','space-around':'around','space-evenly':'evenly'}[s['justify-content']]||s['justify-content']}`);
  if (s['flex-wrap']==='wrap') c.push('flex-wrap');
  if (s.gap && s.gap!=='normal') c.push(`gap-[${s.gap}]`);
  if (s.position && s.position!=='static') c.push(s.position);
  if (s['z-index'] && s['z-index']!=='auto') c.push(`z-[${s['z-index']}]`);
  if (s.width && s.width!=='auto') c.push(s.width==='100%'?'w-full':`w-[${s.width}]`);
  if (s.height && s.height!=='auto') c.push(s.height==='100%'?'h-full':`h-[${s.height}]`);
  if (s['max-width'] && s['max-width']!=='none') c.push(`max-w-[${s['max-width']}]`);
  if (s['min-height'] && s['min-height']!=='auto') c.push(`min-h-[${s['min-height']}]`);
  c.push(...fourSide(s,'margin')); c.push(...fourSide(s,'padding'));
  const bw=s['border-top-width']; if (bw) { c.push(`border-[${bw}]`); if(s['border-top-color']) c.push(`border-${colorTok(s['border-top-color'])}`); }
  if (s['border-radius']) c.push(`rounded-[${px(s['border-radius'])}]`);
  if (s['box-shadow']) c.push(`shadow-[${px(s['box-shadow'])}]`);
  if (s['object-fit']) c.push(`object-${s['object-fit']}`);
  if (s.opacity) c.push(`opacity-[${s.opacity}]`);
  if (s.overflow==='hidden') c.push('overflow-hidden');
  if (s['background-image']) styleExtra.push(`background-image:${s['background-image']};background-size:${s['background-size']||'cover'};background-position:${s['background-position']||'center'}`);
  return { cls: c.filter(Boolean).join(' '), style: styleExtra.join(';') };
}
const swUrl = (href) => {
  if (!href) return href;
  let h = href.replace(/^https?:\/\/(www\.)?advancedtechcc\.com/,'');
  if (h==='' || h==='/' ) return `{{sw-url 'home'}}`;
  const m = h.match(/^\/([a-z0-9-]+)\/?$/i); if (m) return `{{sw-url '${m[1]==='about-us'?'about-us':m[1]}'}}`;
  return href; // external / anchors / tel / mailto kept
};
const VOID = new Set(['img','iframe','input','br','hr']);
function emit(node, depth) {
  const ind = '  '.repeat(depth);
  const { cls, style } = classesFor(node.s);
  const attrs = [];
  if (cls) attrs.push(`class="${cls}"`);
  if (style) attrs.push(`style="${style}"`);
  if (node.tag==='img') { attrs.push(`src="${node.src}"`); if(node.alt) attrs.push(`alt="${node.alt}"`); attrs.push('loading="lazy"'); }
  if (node.tag==='a') attrs.push(`href="${swUrl(node.href)}"`);
  if (node.tag==='iframe') { attrs.push(`src="${node.src}"`); if(node.title) attrs.push(`title="${node.title}"`); attrs.push('loading="lazy"'); }
  const open = `<${node.tag}${attrs.length?' '+attrs.join(' '):''}>`;
  if (VOID.has(node.tag)) return `${ind}${open}`;
  const inner = [];
  if (node.text) inner.push(`${'  '.repeat(depth+1)}${node.text}`);
  for (const ch of node.children) inner.push(emit(ch, depth+1));
  if (!inner.length) return `${ind}${open}</${node.tag}>`;
  return `${ind}${open}\n${inner.join('\n')}\n${ind}</${node.tag}>`;
}
const html = tree.map(n => emit(n, 0)).join('\n');
writeFileSync(OUT, html);
console.error(`emitted ${html.length} chars, ${tree.length} top-level sections`);
await b.close();
