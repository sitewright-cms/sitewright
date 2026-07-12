import { chromium } from '@playwright/test';
const [url, outDir] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const pg = await ctx.newPage();
await pg.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await pg.evaluate(async () => { await new Promise(r => { let y = 0; const t = setInterval(() => { scrollTo(0, y += 400); if (y > document.body.scrollHeight + 1000) { clearInterval(t); r(); } }, 50); }); }).catch(() => {});
await pg.waitForTimeout(2500); // extra wait for map tiles
const rep = await pg.evaluate(() => {
  const out = [];
  const banner = document.querySelector('[class*="consent"],[id*="consent"],[data-consent],[class*="cookie"],[id*="cookie"]');
  out.push('consent/cookie banner el: ' + (banner ? `<${banner.tagName.toLowerCase()} class="${(banner.className||'').toString().slice(0,60)}">` : 'NONE'));
  const gate = document.querySelector('[data-sw-consent-src],[class*="gate"],[class*="placeholder"]');
  out.push('gate/placeholder el: ' + (gate ? `<${gate.tagName.toLowerCase()} class="${(gate.className||'').toString().slice(0,60)}">` : 'NONE'));
  const ifr = document.querySelector('iframe');
  out.push('iframe: ' + (ifr ? `src=${(ifr.getAttribute('src')||ifr.getAttribute('data-sw-consent-src')||'').slice(0,60)} w=${Math.round(ifr.getBoundingClientRect().width)} h=${Math.round(ifr.getBoundingClientRect().height)}` : 'NONE'));
  // footer HOME link color
  const fl = Array.from(document.querySelectorAll('footer a, [data-sw-slot] a')).find(a=>/^home$/i.test(a.textContent.trim()));
  if (fl) { const cs=getComputedStyle(fl); out.push(`footer HOME: color=${cs.color} text=${fl.textContent.trim()}`); }
  return out.join('\n');
});
console.log(rep);
// re-shot map region after longer wait
const box = await pg.evaluate(() => { const if_=document.querySelector('iframe'); if(!if_) return null; if_.scrollIntoView(); window.scrollBy(0,-140); const r=if_.getBoundingClientRect(); return {top:Math.max(0,Math.round(r.top-20)), h:Math.min(460,Math.round(r.height+120))}; });
if (box) { await pg.waitForTimeout(800); await pg.screenshot({ path: `${outDir}/map-region.jpg`, quality: 72, type: 'jpeg', clip: { x: 0, y: box.top, width: 1440, height: box.h } }).catch(e=>console.log('shoterr',e.message.slice(0,60))); console.log('map-region saved'); }
await b.close();
