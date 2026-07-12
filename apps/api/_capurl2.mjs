import { chromium } from '@playwright/test';
// args: url outDir prefix   (robust settle: scroll, wait for images + fonts, re-scroll, then fullPage)
const [url, outDir, prefix] = process.argv.slice(2);
const BPS = [[1440, 'd'], [390, 'm']];
const b = await chromium.launch({ args: ['--no-sandbox'] });
for (const [w, tag] of BPS) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1000 }, deviceScaleFactor: 1, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' });
  const pg = await ctx.newPage();
  try {
    await pg.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    // slow scroll to trigger lazy loaders
    await pg.evaluate(async () => { await new Promise(r => { let y = 0; const t = setInterval(() => { scrollTo(0, y += 400); if (y > document.body.scrollHeight + 1200) { clearInterval(t); r(); } }, 60); }); }).catch(() => {});
    await pg.waitForTimeout(1500);
    // wait for all <img> to finish + fonts ready
    await pg.evaluate(async () => {
      await (document.fonts ? document.fonts.ready : Promise.resolve());
      const imgs = Array.from(document.images);
      await Promise.all(imgs.map(im => im.complete ? Promise.resolve() : new Promise(res => { im.addEventListener('load', res, { once: true }); im.addEventListener('error', res, { once: true }); setTimeout(res, 4000); })));
    }).catch(() => {});
    await pg.waitForLoadState('networkidle').catch(() => {});
    await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(800);
    await pg.screenshot({ path: `${outDir}/${prefix}-${tag}.jpg`, quality: 62, type: 'jpeg', fullPage: true });
    const h = await pg.evaluate(() => document.body.scrollHeight);
    console.log('captured', tag, 'height', h);
  } catch (e) { console.log('ERR', tag, e.message.slice(0, 80)); }
  await ctx.close();
}
await b.close();
