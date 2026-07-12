import { chromium } from '@playwright/test';
// args: url outDir prefix  — forces entrance-animated content visible, then fullPage
const [url, outDir, prefix] = process.argv.slice(2);
const KILL = `*,*::before,*::after{animation:none!important;transition:none!important}
[data-aos]{opacity:1!important;transform:none!important}
.wow,.animated,[class*="fadeIn"],[class*="fade-in"]{opacity:1!important;transform:none!important;visibility:visible!important}`;
const BPS = [[1440, 'd'], [390, 'm']];
const b = await chromium.launch({ args: ['--no-sandbox'] });
for (const [w, tag] of BPS) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1000 }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  try {
    await pg.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await pg.addStyleTag({ content: KILL }).catch(() => {});
    await pg.evaluate(async () => { await new Promise(r => { let y = 0; const t = setInterval(() => { scrollTo(0, y += 400); if (y > document.body.scrollHeight + 1200) { clearInterval(t); r(); } }, 50); }); }).catch(() => {});
    await pg.waitForTimeout(1200);
    await pg.evaluate(async () => { const imgs = Array.from(document.images); await Promise.all(imgs.map(im => im.complete ? 0 : new Promise(res => { im.onload = im.onerror = res; setTimeout(res, 3500); }))); }).catch(() => {});
    await pg.addStyleTag({ content: KILL }).catch(() => {}); // re-assert after lazy swaps
    await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(500);
    await pg.screenshot({ path: `${outDir}/${prefix}-${tag}.jpg`, quality: 62, type: 'jpeg', fullPage: true });
    console.log('captured', tag, 'height', await pg.evaluate(() => document.body.scrollHeight));
  } catch (e) { console.log('ERR', tag, e.message.slice(0, 80)); }
  await ctx.close();
}
await b.close();
