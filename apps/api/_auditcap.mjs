// Full-page audit capture: clone vs live original, desktop + mobile.
// Waits for network idle + fonts.ready + a settle, screenshots fullPage.
// Usage: node _auditcap.mjs @manifest.json   (manifest = [{label,url,vw,vh,out}])
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = process.argv[2];
const manifest = JSON.parse(readFileSync(arg.startsWith('@') ? arg.slice(1) : arg, 'utf8'));

const browser = await chromium.launch({
  channel: 'chromium-headless-shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

for (const job of manifest) {
  const ctx = await browser.newContext({
    viewport: { width: job.vw, height: job.vh },
    deviceScaleFactor: 1,
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  });
  const page = await ctx.newPage();
  try {
    await page.goto(job.url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    mkdirSync(dirname(job.out), { recursive: true });
    await page.screenshot({ path: job.out, fullPage: true, type: 'jpeg', quality: 72 });
    const h = await page.evaluate(() => document.body.scrollHeight);
    console.log(`ok  ${job.label.padEnd(22)} ${String(h).padStart(6)}px  ${job.out}`);
  } catch (e) {
    console.log(`ERR ${job.label.padEnd(22)} ${job.url}  :: ${String(e).slice(0, 120)}`);
  }
  await ctx.close();
}
await browser.close();
console.log('[done]');
