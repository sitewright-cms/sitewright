import { launch, signedIn, OUT } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const browser = await launch();
const ctx = await signedIn(browser, 'lena@northwind.example', 'Pw-secret-1', { scale: 1, width: 1600, height: 1000, reducedMotion: 'reduce' });
const page = await ctx.newPage();
await page.goto('/');
await page.getByRole('button', { name: /Example Project/ }).first().click();
await page.getByRole('button', { name: /^About/ }).first().click();
await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
const pv = page.frameLocator('iframe[title="Preview"]');
await pv.locator('[data-sw-translate="about.headline"]').waitFor();
await page.waitForTimeout(2000);
const marks = await pv.locator('body').evaluate((b) => [...b.querySelectorAll('[data-sw-src],[data-sw-entry],[data-sw-item],[data-sw-text],[data-sw-href],img')].slice(0, 40).map((e) => `${e.tagName} ${[...e.attributes].filter((a) => a.name.startsWith('data-sw')).map((a) => a.name + '=' + a.value.slice(0, 40)).join(' ')}`));
console.log(marks.join('\n'));
const img = pv.locator('[data-sw-src]').first();
if (await img.count()) { await img.click(); await page.waitForTimeout(1500); await page.screenshot({ path: `${OUT}/x-img-click.png` }); writeFileSync(`${OUT}/x-img-click.aria.txt`, await page.locator('body').ariaSnapshot()); }
await browser.close();
