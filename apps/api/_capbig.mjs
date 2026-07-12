import { chromium } from '@playwright/test';
// args: url outDir prefix — measure height, grow viewport to it, screenshot viewport (NO fullPage)
const [url, outDir, prefix] = process.argv.slice(2);
const BPS = [[1440, 'd'], [390, 'm']];
const b = await chromium.launch({ args: ['--no-sandbox'] });
for (const [w, tag] of BPS) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1000 }, deviceScaleFactor: 1, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' });
  const pg = await ctx.newPage();
  try {
    await pg.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await pg.evaluate(async () => { await new Promise(r => { let y = 0; const t = setInterval(() => { scrollTo(0, y += 400); if (y > document.body.scrollHeight + 1000) { clearInterval(t); r(); } }, 50); }); }).catch(() => {});
    await pg.waitForTimeout(1000);
    let h = await pg.evaluate(() => document.body.scrollHeight);
    h = Math.min(h + 40, 8000);
    await pg.setViewportSize({ width: w, height: h });
    await pg.evaluate(async () => { const imgs = Array.from(document.images); await Promise.all(imgs.map(im => im.complete ? 0 : new Promise(res => { im.onload = im.onerror = res; setTimeout(res, 3500); }))); }).catch(() => {});
    await pg.evaluate(async()=>{await (document.fonts?document.fonts.ready:Promise.resolve());}); await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(900);
    await pg.screenshot({ path: `${outDir}/${prefix}-${tag}.jpg`, quality: 62, type: 'jpeg' }); // viewport, not fullPage
    console.log('captured', tag, 'viewportH', h);
  } catch (e) { console.log('ERR', tag, e.message.slice(0, 80)); }
  await ctx.close();
}
await b.close();
