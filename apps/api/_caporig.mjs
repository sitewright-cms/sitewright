import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const SP = process.argv[2];
const list = JSON.parse(readFileSync(SP + '/list.json', 'utf8'));
const BPS = [[1440, 'd'], [768, 't'], [390, 'm']];
const COOKIE = ['#cookie-accept', '.cookie-accept', '[aria-label*="accept" i]', 'button:has-text("Accept")', 'button:has-text("OK")'];
const b = await chromium.launch({ args: ['--no-sandbox'] });
for (const it of list) {
  for (const [w, tag] of BPS) {
    const ctx = await b.newContext({ viewport: { width: w, height: 1000 }, deviceScaleFactor: 1 });
    const pg = await ctx.newPage();
    try {
      await pg.goto(it.url, { waitUntil: 'networkidle', timeout: 45000 });
      for (const sel of COOKIE) { try { const el = await pg.$(sel); if (el) { await el.click({ timeout: 800 }); break; } } catch (e) { /* none */ } }
      await pg.evaluate(async () => { await new Promise(r => { let y = 0; const t = setInterval(() => { scrollTo(0, y += 600); if (y > document.body.scrollHeight + 800) { clearInterval(t); r(); } }, 25); }); }).catch(() => {});
      await pg.waitForTimeout(900); await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(300);
      await pg.screenshot({ path: `${SP}/orig/${it.slug}-${tag}.jpg`, quality: 58, type: 'jpeg', fullPage: true });
    } catch (e) { console.log('ERR', it.slug, tag, e.message.slice(0, 45)); }
    await ctx.close();
  }
  console.log('captured', it.slug);
}
await b.close();
