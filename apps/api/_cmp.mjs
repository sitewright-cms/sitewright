import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
const SP = process.argv[2];
const slugs = process.argv[3].split(',');
const b = await chromium.launch({ args: ['--no-sandbox'] });
const pg = await (await b.newContext({ deviceScaleFactor: 1 })).newPage();
for (const slug of slugs) {
  for (const tag of ['d', 't', 'm']) {
    const o = `${SP}/orig/${slug}-${tag}.jpg`, c = `${SP}/clone/M-${slug}-${tag}.jpg`;
    if (!existsSync(o) || !existsSync(c)) continue;
    const H = 1700;
    const html = `<!doctype html><body style="margin:0;background:#666;display:flex;gap:8px;align-items:flex-start">
      <div style="display:flex;flex-direction:column;align-items:center"><div style="color:#fff;font:14px sans-serif;padding:4px">ORIGINAL</div><img src="file://${o}" style="height:${H}px"></div>
      <div style="display:flex;flex-direction:column;align-items:center"><div style="color:#fff;font:14px sans-serif;padding:4px">CLONE</div><img src="file://${c}" style="height:${H}px"></div>
    </body>`;
    await pg.setContent(html, { waitUntil: 'load' });
    await pg.waitForTimeout(150);
    const el = await pg.$('body');
    await el.screenshot({ path: `${SP}/cmp/${slug}-${tag}.jpg`, quality: 60, type: 'jpeg' });
  }
  console.log('cmp', slug);
}
await b.close();
