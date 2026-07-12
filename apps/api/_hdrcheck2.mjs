import { chromium } from '@playwright/test';
const [url, w] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: Number(w), height: 900 } });
const pg = await ctx.newPage();
await pg.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{});
await pg.waitForTimeout(700);
const r = await pg.evaluate(() => {
  const nav = document.getElementById('main-nav');
  const navBottom = nav ? Math.round(nav.getBoundingClientRect().bottom) : -1;
  const el = document.querySelector('#page-content h1, #page-content h2, #page-content img, main h1, main h2, main img');
  const contentTop = el ? Math.round(el.getBoundingClientRect().top) : -1;
  return { navBottom, contentTop, clearsBy: contentTop - navBottom };
});
console.log(`w=${w}`, JSON.stringify(r));
await b.close();
