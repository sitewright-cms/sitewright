import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
// args: SP outDir prefix [routesFile] [onlySlug]
const [SP, outDir, prefix, routesFile, onlySlug] = process.argv.slice(2);
const BASE = 'http://dind.local:2003';
const PB = readFileSync(SP + '/prevbase.txt', 'utf8').trim();
let list = JSON.parse(readFileSync(routesFile || (SP + '/routes.json'), 'utf8'));
if (onlySlug) list = list.filter(x => x.slug === onlySlug);
const BPS = [[1440, 'd'], [768, 't'], [390, 'm']];
const jar = readFileSync(SP + '/../sw-cookies.txt', 'utf8').split(/\n/).filter(l => l && !l.startsWith('#'));
const cookies = jar.map(l => l.split(/\t/)).filter(a => a.length >= 7).map(a => ({ name: a[5], value: a[6], domain: 'dind.local', path: a[2], httpOnly: a[0].includes('HttpOnly'), secure: a[3] === 'TRUE' }));
const b = await chromium.launch({ args: ['--no-sandbox'] });
for (const it of list) {
  for (const [w, tag] of BPS) {
    const ctx = await b.newContext({ viewport: { width: w, height: 1000 }, deviceScaleFactor: 1 });
    await ctx.addCookies(cookies);
    const pg = await ctx.newPage();
    try {
      const target = BASE + PB + (it.route ? it.route.replace(/\/?$/, '/') : '');
      let resp = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        resp = await pg.goto(target, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => null);
        if (resp && resp.status() < 400) break;
        await pg.waitForTimeout(8000 + attempt * 6000); // back off on 429/5xx and retry (shared 200/min budget)
      }
      if (!resp || resp.status() >= 400) console.log('WARN', it.slug, tag, 'status', resp ? resp.status() : 'none');
      await pg.evaluate(async () => { await new Promise(r => { let y = 0; const t = setInterval(() => { scrollTo(0, y += 600); if (y > document.body.scrollHeight + 800) { clearInterval(t); r(); } }, 25); }); }).catch(() => {});
      await pg.waitForTimeout(700); await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(250);
      await pg.screenshot({ path: `${outDir}/${prefix}${it.slug}-${tag}.jpg`, quality: 58, type: 'jpeg', fullPage: true });
    } catch (e) { console.log('ERR', it.slug, tag, e.message.slice(0, 45)); }
    await ctx.close();
  }
  console.log('rendered', it.slug);
}
await b.close();
