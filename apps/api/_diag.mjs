import { chromium } from '@playwright/test';
const [url] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const pg = await ctx.newPage();
await pg.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await pg.evaluate(async () => { await new Promise(r => { let y = 0; const t = setInterval(() => { scrollTo(0, y += 500); if (y > document.body.scrollHeight + 1200) { clearInterval(t); r(); } }, 50); }); }).catch(() => {});
await pg.waitForTimeout(1500); await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(400);
const report = await pg.evaluate(() => {
  const out = [];
  const sel = (label, q) => {
    const el = document.querySelector(q);
    if (!el) { out.push(`${label}: MISSING (${q})`); return; }
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    out.push(`${label}: y=${Math.round(r.top+scrollY)} h=${Math.round(r.height)} opacity=${cs.opacity} vis=${cs.visibility} display=${cs.display} bg=${cs.backgroundColor} color=${cs.color} transform=${cs.transform.slice(0,30)}`);
  };
  out.push(`bodyHeight=${document.body.scrollHeight}`);
  // count opacity:0 elements
  const zero = Array.from(document.querySelectorAll('*')).filter(e => { const o=getComputedStyle(e).opacity; return o && parseFloat(o) < 0.05; });
  out.push(`opacity<0.05 elements: ${zero.length}`);
  zero.slice(0, 12).forEach(e => { const r=e.getBoundingClientRect(); out.push(`  · <${e.tagName.toLowerCase()} class="${(e.className||'').toString().slice(0,60)}"> y=${Math.round(r.top+scrollY)} h=${Math.round(r.height)}`); });
  sel('footer', 'footer, [data-sw-slot="footer"], .footer, #footer');
  sel('map-iframe', 'iframe');
  sel('carousel', '[data-sw-component="carousel"]');
  sel('modal', '[data-sw-component="modal"], dialog');
  sel('quicklinks-first-btn', 'a[href="/consultancy"]');
  return out.join('\n');
});
console.log(report);
await b.close();
