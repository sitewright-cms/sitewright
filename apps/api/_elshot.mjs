import { chromium } from '@playwright/test';
const [url, outDir] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const pg = await ctx.newPage();
await pg.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await pg.evaluate(async () => { await new Promise(r => { let y = 0; const t = setInterval(() => { scrollTo(0, y += 400); if (y > document.body.scrollHeight + 1000) { clearInterval(t); r(); } }, 50); }); }).catch(() => {});
await pg.waitForTimeout(1200);
// screenshot the map region by scrolling it into view and clipping
const box = await pg.evaluate(() => {
  const if_ = document.querySelector('iframe');
  if (!if_) return null;
  // find the outermost band wrapper around the iframe (consent placeholder + iframe)
  let el = if_; for (let i=0;i<4 && el.parentElement;i++){ el = el.parentElement; }
  el.scrollIntoView(); window.scrollBy(0,-120);
  const r = if_.getBoundingClientRect();
  return { x: 0, y: Math.max(0, r.top-20), w: 1440, h: Math.min(520, r.height+140), ifTop: Math.round(r.top+scrollY), ifH: Math.round(r.height) };
});
console.log('mapbox', JSON.stringify(box));
await pg.waitForTimeout(500);
await pg.screenshot({ path: `${outDir}/map-region.jpg`, quality: 70, type: 'jpeg', clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
// also report the consent placeholder element geometry
const info = await pg.evaluate(() => {
  const cand = document.querySelectorAll('[class*="consent"],[data-sw-consent],[class*="gate"],[class*="placeholder"]');
  return Array.from(cand).slice(0,6).map(e=>{const r=e.getBoundingClientRect();return `<${e.tagName.toLowerCase()} class="${(e.className||'').toString().slice(0,50)}"> w=${Math.round(r.width)} h=${Math.round(r.height)}`;});
});
console.log('consent-els:', JSON.stringify(info));
await b.close();
