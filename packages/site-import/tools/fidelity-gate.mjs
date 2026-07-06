#!/usr/bin/env node
// Clone-fidelity GATE: render ORIGINAL vs CLONE in headless Chromium, extract computed styles per
// text-anchored element, diff (tools/style-diff.mjs), and emit a per-page divergence report + PASS/FAIL
// exit code. This is the OBJECTIVE terminating condition for the nativize loop — it replaces "an agent
// eyeballed the screenshot and called it faithful" with a measured number that can FAIL.
//
// Usage:
//   SW_URL=http://dind.local:2003 SW_TOKEN=<project api key> SW_PID=<projectId> \
//   SW_PAGES='[["<pageId>","<route>","<originalUrl>"], ...]' \
//   node packages/site-import/tools/fidelity-gate.mjs
//
// The clone is rendered via the project's signed preview base (GET /projects/:id/preview-url), so no
// deploy/publish is needed. Requires a Chromium (playwright-core; honours PLAYWRIGHT_BROWSERS_PATH).
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { matchAndDiff, scorePage } from './style-diff.mjs';

// playwright-core is a TRANSITIVE dep in this pnpm monorepo — it has no top-level `node_modules/playwright-core`
// symlink, so `require('playwright-core')` fails. Find it in the `.pnpm` store instead. Tries the tool's own
// repo root, the CWD, and the canonical checkout — so the tool runs from any worktree.
function findChromium() {
  const req = createRequire(import.meta.url);
  const toolRepo = fileURLToPath(new URL('../../../../', import.meta.url)); // packages/site-import/tools -> repo root
  for (const root of [toolRepo, process.cwd(), '/workspace/sitewright']) {
    try {
      const store = `${root}/node_modules/.pnpm`;
      // pick the LATEST installed playwright-core (lexicographic version sort) so a leftover older copy in
      // the store can't shadow the one matching PLAYWRIGHT_BROWSERS_PATH.
      const dir = readdirSync(store).filter((d) => d.startsWith('playwright-core@')).sort().at(-1);
      if (!dir) continue;
      const c = req(`${store}/${dir}/node_modules/playwright-core`).chromium;
      if (c) return c;
    } catch { /* try next root */ }
  }
  return null;
}
const chromium = findChromium();
if (!chromium) { console.error('playwright-core not found in any .pnpm store (PLAYWRIGHT_BROWSERS_PATH must also point at an installed Chromium)'); process.exit(2); }

const BASE = process.env.SW_URL || 'http://dind.local:2003';
const TOKEN = process.env.SW_TOKEN;
const PID = process.env.SW_PID;
const PAGES = JSON.parse(process.env.SW_PAGES || '[]');
const VP = { width: Number(process.env.SW_VP_W || 1920), height: Number(process.env.SW_VP_H || 1080) };
if (!TOKEN || !PID || !PAGES.length) { console.error('set SW_TOKEN, SW_PID, SW_PAGES=[["id","route","origUrl"],…]'); process.exit(2); }

// In-page: meaningful elements (headings, buttons/links-with-fill, paragraphs, list items) + computed styles.
const EXTRACT = () => {
  const n = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const out = [];
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,a,button,p,li,[class*="btn"]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
    const text = n(el.textContent).slice(0, 60);
    if (!text || text.length < 2) continue;
    const tag = el.tagName.toLowerCase();
    const heading = /^h[1-6]$/.test(tag);
    const btn = tag === 'button' || (tag === 'a' && (/btn|button/i.test(el.className) || cs.backgroundImage !== 'none' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)'));
    const role = heading ? 'heading' : btn ? 'button' : (tag === 'p' || tag === 'li') ? 'text' : 'other';
    if (role === 'other') continue;
    out.push({ role, tag, text, font: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight, color: cs.color, bg: cs.backgroundColor, bgImage: cs.backgroundImage.slice(0, 240), shadow: cs.boxShadow.slice(0, 140), transform: cs.transform, radius: cs.borderRadius });
  }
  return out;
};

async function capture(browser, url) {
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  try {
    const page = await ctx.newPage();
    page.setDefaultTimeout(25000);
    // Surface load/extract failures as warnings (don't crash the run) — otherwise a network fluke reports
    // as cov=0% and is indistinguishable from a real style regression.
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 }).catch((e) => console.warn(`  WARN goto ${url}: ${e.message}`));
    await page.evaluate(async () => {
      await new Promise((res) => { let y = 0; const t = setInterval(() => { scrollBy(0, 600); y += 600; if (y > document.documentElement.scrollHeight || y > 40000) { clearInterval(t); scrollTo(0, 0); setTimeout(res, 300); } }, 40); });
      if (document.fonts?.ready) { try { await document.fonts.ready; } catch {} }
    }).catch(() => {});
    await page.waitForTimeout(400);
    return await page.evaluate(EXTRACT).catch((e) => { console.warn(`  WARN extract ${url}: ${e.message}`); return []; });
  } finally { await ctx.close().catch(() => {}); }
}

async function main() {
  const res = await fetch(`${BASE}/projects/${PID}/preview-url`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const { base } = await res.json();
  if (!base) { console.error('could not mint preview-url (auth?)'); process.exit(2); }
  const browser = await chromium.launch({ headless: true });
  const rows = [];
  try {
    for (const [id, route, src] of PAGES) {
      const cloneUrl = `${BASE}${base}${route}${route && !route.endsWith('/') ? '/' : ''}`;
      const orig = await capture(browser, src);
      const clone = await capture(browser, cloneUrl);
      const m = matchAndDiff(orig, clone);
      const s = scorePage(m);
      rows.push({ id, s, m });
      console.log(`\n### ${id}  ${s.pass ? 'PASS ✓' : 'FAIL ✗'}  coverage=${(s.coverage * 100).toFixed(0)}% (${s.matched}/${s.origCount})  font=${s.fontMiss} grad=${s.gradFail} skew=${s.skewMiss}  score=${s.score.toFixed(2)}`);
      for (const d of m.diffs.slice(0, 14)) console.log(`   [${d.role}] "${d.text.slice(0, 42)}"  ${d.props.join('  ')}`);
      if (m.unmatched.length) console.log(`   UNMATCHED in original (missing/renamed in clone): ${m.unmatched.slice(0, 8).map((u) => `[${u.role}]"${u.text.slice(0, 22)}"`).join(' ')}${m.unmatched.length > 8 ? ` +${m.unmatched.length - 8}` : ''}`);
    }
  } finally { await browser.close(); }
  console.log('\n===== FIDELITY SUMMARY =====');
  for (const { id, s } of rows) console.log(`  ${s.pass ? 'PASS' : 'FAIL'}  ${id.padEnd(38)} cov=${(s.coverage * 100).toFixed(0)}% font=${s.fontMiss} grad=${s.gradFail} skew=${s.skewMiss} score=${s.score.toFixed(2)}`);
  const failed = rows.filter((r) => !r.s.pass).length;
  console.log(`\n${failed} of ${rows.length} pages FAIL the fidelity gate.`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
