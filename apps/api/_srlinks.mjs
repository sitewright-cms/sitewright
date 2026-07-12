import { chromium } from '@playwright/test';
const b = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const pg = await ctx.newPage();
await pg.goto('https://www.rbs.com.na/social-responsibility/', { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{});
await pg.waitForTimeout(2000);
const links = await pg.evaluate(() => {
  const out = new Set();
  document.querySelectorAll('a[href]').forEach(a => { const h=a.getAttribute('href'); if(h && /social-responsibility\/[a-z]/i.test(h)) out.add(h); });
  // also any 'read more' anchors
  const rm = [...document.querySelectorAll('a')].filter(a=>/read more/i.test(a.textContent)).map(a=>a.getAttribute('href'));
  return { subLinks:[...out], readMore: rm };
});
console.log(JSON.stringify(links, null, 2));
await b.close();
