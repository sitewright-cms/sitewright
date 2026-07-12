import { chromium } from '@playwright/test';
const COOKIE = process.env.COOKIE;
const ORIG = process.argv[2] || 'https://www.advancedtechcc.com/';
const CLONE = process.argv[3] || 'http://dind.local:2003/sites/advanced-tech/';

async function anchors(page) {
  await page.evaluate(async () => { for (let y=0;y<=document.body.scrollHeight;y+=400){scrollTo(0,y);await new Promise(r=>setTimeout(r,90));} scrollTo(0,0); });
  await page.waitForTimeout(800);
  return await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const norm = t => t.replace(/\s+/g,' ').trim().toLowerCase().slice(0,44);
    const texts = [], imgs = [];
    const root = document.querySelector('#content-wrapper, main') || document.body;
    const walk = el => {
      const tag = el.tagName.toLowerCase();
      if (['script','style','nav','header','footer','svg'].includes(tag) || el.closest('#top-nav,#mobile-nav,#footer')) {} 
      if (['script','style','noscript','button'].includes(tag)) { for (const c of el.children) walk(c); return; }
      const own = [...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').replace(/\s+/g,' ').trim();
      if (own && own.length>2 && !/function|var |window\.|=>/.test(own)) {
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        const cx = r.left + r.width/2; const bucket = cx < W/3 ? 'L' : cx < 2*W/3 ? 'C' : 'R';
        texts.push({ k: norm(own), x: Math.round(bucket==='L'?0:bucket==='C'?1:2), w: Math.round(r.width), h: Math.round(r.height),
          fs: parseFloat(cs.fontSize), ff: cs.fontFamily.split(',')[0].replace(/["']/g,''), fw: cs.fontWeight, color: cs.color });
      }
      for (const c of el.children) walk(c);
    };
    walk(root);
    for (const im of root.querySelectorAll('img')) { const r = im.getBoundingClientRect(); imgs.push({ w: Math.round(r.width), h: Math.round(r.height) }); }
    return { texts, imgs };
  });
}

const b = await chromium.launch();
const c1 = await b.newContext({ viewport:{width:1280,height:1000} });
const op = await c1.newPage(); await op.goto(ORIG,{waitUntil:'networkidle',timeout:60000}).catch(()=>{});
const O = await anchors(op);
const c2 = await b.newContext({ viewport:{width:1280,height:1000} });
if (COOKIE) await c2.addCookies([{name:'sw_session',value:COOKIE,domain:'dind.local',path:'/',httpOnly:true,sameSite:'Lax'}]);
const cp = await c2.newPage(); await cp.goto(CLONE,{waitUntil:'networkidle',timeout:45000}).catch(()=>{});
const C = await anchors(cp);
await b.close();

const deltas = []; let ok = 0;
const cByKey = new Map(); for (const t of C.texts) if(!cByKey.has(t.k)) cByKey.set(t.k, t);
for (const o of O.texts) {
  const m = cByKey.get(o.k);
  if (!m) { deltas.push(`MISSING TEXT  "${o.k}"`); continue; }
  const fcat = x => { x=(x||'').toLowerCase(); if(x.includes('text-font'))return'body'; if(x.includes('client-font-1'))return'c1'; if(x.includes('client-font-2'))return'c2'; if(/times|georgia|serif|primary-font|secondary-font/.test(x))return'serif'; if(/arial|helvetica|verdana|sans|tertiary-font/.test(x))return'sans'; return x; };
  const issues = [];
  if (Math.abs(o.fs - m.fs) > 1.5) issues.push(`font-size ${o.fs}->${m.fs}`);
  if (fcat(o.ff) !== fcat(m.ff)) issues.push(`font ${o.ff}->${m.ff}`);
  if (o.color !== m.color) issues.push(`color ${o.color}->${m.color}`);
  if (o.x !== m.x) issues.push(`h-position ${'LCR'[o.x]}->${'LCR'[m.x]}`);
  if (issues.length) deltas.push(`STYLE  "${o.k}"  [${issues.join(', ')}]`); else ok++;
}
// images by order
const n = Math.max(O.imgs.length, C.imgs.length);
let imgOk = 0;
for (let i=0;i<n;i++) {
  const o = O.imgs[i], m = C.imgs[i];
  if (o && o.h>5 && (!m || m.h<5)) { deltas.push(`IMG ${i} COLLAPSED/MISSING  (orig ${o.w}x${o.h}, clone ${m?m.w+'x'+m.h:'absent'})`); continue; }
  if (o && m && o.h>5 && (m.h/o.h < 0.5 || m.h/o.h > 2)) { deltas.push(`IMG ${i} SIZE  orig ${o.w}x${o.h} -> clone ${m.w}x${m.h}`); continue; }
  if (o && m) imgOk++;
}
const total = O.texts.length + O.imgs.length;
const good = ok + imgOk;
const score = ((good/total)*100).toFixed(1);
console.log(`\n=== STRUCTURAL DIFF: ${ORIG}  vs  clone ===`);
console.log(`text anchors: ${O.texts.length} orig / ${C.texts.length} clone | images: ${O.imgs.length} orig / ${C.imgs.length} clone`);
console.log(`FAITHFULNESS SCORE: ${score}%  (${good}/${total} anchors match within tolerance)\n`);
console.log(`DELTAS (${deltas.length}):`);
for (const d of deltas) console.log('  - '+d);
