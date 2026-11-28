// Screenshots a page of the Sitewright project's draft preview on :2003, in light and dark, at desktop and mobile
// width. Scrolls through first so the entrance animations and lazy media have run. Reports page errors.
//
//   node shoot.mjs <route> <out-prefix> [--desktop-only]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/workspace/sitewright/apps/editor/package.json');
const { chromium } = require('@playwright/test');
const here = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://dind.local:2003';
const PROJECT = 'eEb21YIuV4qF';
const cookie = readFileSync(process.env.SW2003_COOKIE ?? '/tmp/claude-1000/-workspace-sitewright/ec7958e0-e951-4975-95e7-a51a6bdd4286/scratchpad/sw2003.cookie', 'utf8').trim();

const [route = '', prefix = join(here, 'shots', 'page'), flag] = process.argv.slice(2);
// The signed preview root (a page's own previewUrl now carries its path, which doubled the slash here).
const previewBase = (await (await fetch(`${BASE}/projects/${PROJECT}/preview-url`, { headers: { cookie } })).json()).base;
if (!previewBase) throw new Error('no preview URL');
const url = `${BASE}${previewBase}${route ? `${route.replace(/^\/|\/$/g, '')}/` : ''}`;

const browser = await chromium.launch({
  executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`,
});
const viewports = flag === '--desktop-only' ? [['desktop', 1440, 900]] : [['desktop', 1440, 900], ['mobile', 390, 844]];
for (const theme of ['light', 'dark']) {
  for (const [name, width, height] of viewports) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await page.goto(url, { waitUntil: 'networkidle' });
    // The draft preview is sandboxed (no localStorage), so switch the way a visitor does: click the toggle.
    if (theme === 'dark') {
      await page.locator('[data-sw-theme-toggle]:visible').first().click();
      await page.waitForTimeout(800);
    }
    // Scroll through so reveal animations and lazy images fire, then back to the top.
    const total = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
    for (let y = 0; y < total; y += Math.round(height * 0.6)) {
      await page.evaluate((top) => { window.scrollTo(0, top); document.body.scrollTo(0, top); }, y);
      await page.waitForTimeout(120);
    }
    await page.evaluate(() => { window.scrollTo(0, 0); document.body.scrollTo(0, 0); });
    await page.waitForTimeout(900);
    const out = `${prefix}-${theme}-${name}.jpg`;
    // The site scrolls the BODY, which is one viewport tall, so a fullPage capture paints only the first screen.
    // Grow the viewport to the whole page instead, so everything is laid out and in view at once.
    await page.setViewportSize({ width, height: total });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: out, type: 'jpeg', quality: 80 });
    console.log(`${out}  ${width}x${total}  errors: ${errors.length}${errors.length ? ` — ${errors.slice(0, 4).join(' | ')}` : ''}`);
    await page.close();
  }
}
await browser.close();
