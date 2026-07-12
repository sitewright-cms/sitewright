import { chromium } from '@playwright/test';
const [url] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const pg = await ctx.newPage();
await pg.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{});
await pg.waitForTimeout(1500);
const r = await pg.evaluate(async () => {
  await (document.fonts ? document.fonts.ready : Promise.resolve());
  const faces = [...document.fonts].map(f => `${f.family}:${f.status}`);
  const el = document.querySelector('.rbs-script, .rbs-brand-title');
  const cs = el ? getComputedStyle(el) : null;
  return {
    fontsLoaded: faces,
    checkRbsScript: document.fonts.check('30px "rbs-script"'),
    brandFontFamily: cs ? cs.fontFamily : 'no .rbs-script el',
    brandText: el ? el.textContent.slice(0,30) : '',
  };
});
console.log(JSON.stringify(r, null, 2));
await b.close();
