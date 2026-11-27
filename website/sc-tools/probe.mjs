// Interacts with a page of the draft preview and screenshots the VIEWPORT after each step.
//   node probe.mjs <route> <outprefix> '<json steps>' [--dark] [--mobile]
// steps: [{"click":"css"}, {"type":["css","text"]}, {"wait":ms}, {"shot":"name"}, {"scroll":"css"},
//         {"eval":"js expression"} , {"hover":"css"}, {"key":"Escape"}, {"wheel":[dx,dy]}]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/workspace/sitewright/apps/editor/package.json');
const { chromium } = require('@playwright/test');
const SITE = '/tmp/claude-1000/-workspace-sitewright/ec7958e0-e951-4975-95e7-a51a6bdd4286/scratchpad/site';
const BASE = 'http://dind.local:2003';
const PROJECT = 'eEb21YIuV4qF';
const cookie = readFileSync(`${SITE}/../sw2003.cookie`, 'utf8').trim();
const [route, prefix, stepsJson, ...flags] = process.argv.slice(2);
const pages = await (await fetch(`${BASE}/projects/${PROJECT}/content/page`, { headers: { cookie } })).json();
const previewBase = pages.items.find((p) => p.previewUrl)?.previewUrl;
const url = `${BASE}${previewBase}${route.replace(/^\/|\/$/g, '')}/`;
const browser = await chromium.launch({
  executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`,
});
const mobile = flags.includes('--mobile');
const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`console.${m.type()}: ${m.text()}`); });
await page.goto(url, { waitUntil: 'networkidle' });
if (flags.includes('--dark')) { await page.locator('[data-sw-theme-toggle]:visible').first().click(); await page.waitForTimeout(600); }
for (const step of JSON.parse(stepsJson)) {
  if (step.scroll) { await page.locator(step.scroll).first().scrollIntoViewIfNeeded(); await page.waitForTimeout(700); }
  if (step.click) { await page.locator(step.click).first().click(); await page.waitForTimeout(step.after ?? 900); }
  if (step.hover) { await page.locator(step.hover).first().hover(); await page.waitForTimeout(700); }
  if (step.type) { await page.locator(step.type[0]).first().fill(''); await page.locator(step.type[0]).first().type(step.type[1], { delay: 40 }); await page.waitForTimeout(1200); }
  if (step.key) { await page.keyboard.press(step.key); await page.waitForTimeout(700); }
  if (step.wheel) { await page.mouse.wheel(step.wheel[0], step.wheel[1]); await page.waitForTimeout(900); }
  if (step.wait) await page.waitForTimeout(step.wait);
  if (step.eval) console.log('eval:', JSON.stringify(await page.evaluate(step.eval)));
  if (step.shot) { const out = `${prefix}-${step.shot}.jpg`; await page.screenshot({ path: out, type: 'jpeg', quality: 75 }); console.log(out); }
}
console.log(`errors: ${errors.length}${errors.length ? ' — ' + errors.slice(0, 6).join(' | ') : ''}`);
await browser.close();
