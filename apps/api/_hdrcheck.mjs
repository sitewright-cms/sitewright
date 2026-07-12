import { chromium } from '@playwright/test';
const [url, w] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: Number(w), height: 900 } });
const pg = await ctx.newPage();
await pg.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{});
await pg.waitForTimeout(600);
const r = await pg.evaluate(() => {
  const nav = document.getElementById('main-nav');
  const navH = nav ? Math.round(nav.getBoundingClientRect().height) : -1;
  // first visible content section top (skip the nav)
  const first = document.querySelector('main section, #page-content section, section');
  const firstTop = first ? Math.round(first.getBoundingClientRect().top) : -1;
  const headerH = getComputedStyle(document.documentElement).getPropertyValue('--sw-header-h').trim();
  return { navH, firstTop, headerH, clipped: navH > firstTop };
});
console.log(`w=${w}`, JSON.stringify(r));
await b.close();
