import { launch, signedIn } from './lib.mjs';
const browser = await launch();
const css = {
  asis: '',
  noblur: '*,*::before,*::after{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}',
  lightblur: '*,*::before,*::after{--tw-backdrop-blur:blur(3px)!important}',
};
for (const [name, rule] of Object.entries(css)) {
  const ctx = await signedIn(browser, 'lena@northwind.example', 'Pw-secret-1', { scale: 1, width: 1600, height: 1000, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: /Example Project/ }).first().click();
  await page.getByRole('button', { name: /^FAQ/ }).first().click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.waitForTimeout(2500);
  if (rule) await page.addStyleTag({ content: rule });
  await page.evaluate(() => { const el = document.querySelector('.cm-content'); const v = el.cmView?.view ?? el.cmTile?.view; v.dispatch({ selection: { anchor: 0 } }); v.focus(); });
  const cdp = await ctx.newCDPSession(page);
  let n = 0;
  cdp.on('Page.screencastFrame', async ({ sessionId }) => { n++; await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1600, maxHeight: 1000 });
  const t = Date.now();
  let k = 0;
  while (Date.now() - t < 4000) { await page.keyboard.type('a'); k++; }
  await cdp.send('Page.stopScreencast');
  console.log(name.padEnd(10), 'frames/s', (n / 4).toFixed(1), 'keys/s', (k / 4).toFixed(1));
  await ctx.close();
}
await browser.close();
