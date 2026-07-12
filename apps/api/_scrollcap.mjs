import { chromium } from '@playwright/test';
// args: url outDir prefix scrollY — capture the top viewport AFTER scrolling (to see sticky/shrink header)
const [url, outDir, prefix, scrollY = '700'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const pg = await ctx.newPage();
await pg.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await pg.evaluate((y) => window.scrollTo(0, Number(y)), scrollY);
await pg.waitForTimeout(1200);
await pg.screenshot({ path: `${outDir}/${prefix}.jpg`, quality: 70, type: 'jpeg' });
const cls = await pg.evaluate(() => { const n = document.getElementById('main-nav'); return { navClass: n ? n.className : 'no #main-nav', htmlClass: document.documentElement.className, headerH: getComputedStyle(document.documentElement).getPropertyValue('--sw-header-h') }; });
console.log(JSON.stringify(cls));
await b.close();
