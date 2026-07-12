import { chromium } from '@playwright/test';
const [url, out] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--no-sandbox'] });
const pg = await b.newPage({ viewport: { width: 1440, height: 300 } });
await pg.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{});
await pg.evaluate(async()=>{await document.fonts.ready;});
await pg.waitForTimeout(1200);
const info = await pg.evaluate(() => {
  const el = document.querySelector('.rbs-brand-title');
  const cs = getComputedStyle(el);
  // which loaded face actually matches?
  return { check: document.fonts.check(`${cs.fontSize} "rbs-script"`), fam: cs.fontFamily, weight: cs.fontWeight, size: cs.fontSize };
});
console.log('AT-CAPTURE:', JSON.stringify(info));
await pg.screenshot({ path: out, clip:{x:120,y:5,width:760,height:80}, quality:92, type:'jpeg' });
await b.close();
