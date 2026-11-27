// Loads each showcase route at 390px and reports horizontal overflow + the widest offenders.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/workspace/sitewright/apps/editor/package.json');
const { chromium } = require('@playwright/test');
const SITE = '/tmp/claude-1000/-workspace-sitewright/ec7958e0-e951-4975-95e7-a51a6bdd4286/scratchpad/site';
const BASE = 'http://dind.local:2003';
const cookie = readFileSync(`${SITE}/../sw2003.cookie`, 'utf8').trim();
const pages = await (await fetch(`${BASE}/projects/eEb21YIuV4qF/content/page`, { headers: { cookie } })).json();
const previewBase = pages.items.find((p) => p.previewUrl)?.previewUrl;
const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell` });
for (const r of process.argv.slice(2)) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}${previewBase}showcase/${r}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const res = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const wide = [];
    for (const el of document.querySelectorAll('main *')) {
      const rc = el.getBoundingClientRect();
      if (rc.right > vw + 1 && rc.width > 0) {
        // skip things clipped by an overflow ancestor
        let a = el.parentElement, clipped = false;
        while (a && a !== document.body) { const o = getComputedStyle(a); if (/(hidden|auto|scroll|clip)/.test(o.overflowX)) { clipped = true; break; } a = a.parentElement; }
        if (!clipped) wide.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} r=${Math.round(rc.right)}`);
      }
    }
    return { scrollW: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), vw, wide: wide.slice(0, 4) };
  });
  console.log(r, JSON.stringify(res), errors.length ? 'ERR ' + errors[0] : '');
  await page.close();
}
await browser.close();
