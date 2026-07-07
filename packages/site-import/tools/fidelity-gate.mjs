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
import { matchChrome, scoreChrome, scoreChromeMeta } from './chrome-diff.mjs';
import { cloneUrlFor } from './preview-url.mjs';

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

// Above this the clone's on-screen nav/header can only be unstyled: a styled chrome nav is ~60-160px, an
// unstyled one (stylesheet failed to apply) balloons to >1000px as skew collapses and icons grow.
const UNSTYLED_NAV_H = 400;

// In-page: meaningful elements + computed styles + region (header/footer/body) + layout box. BODY keeps
// text-bearing headings/buttons/text; CHROME (header/footer) also keeps the text-less logo img + icon-only
// buttons/links (matched by order). Font/size read from the deepest element that holds the full text (the
// LEAF), since a nav <a>/button often wraps its label in an inner <span class="font-heading"> — reading the
// outer element's font would over-report a mismatch.
const EXTRACT = () => {
  const n = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const H = 95;
  const vpW = document.documentElement.clientWidth || 1920;
  const sy = window.scrollY || 0;
  // Real content height = the max element bottom. document.scrollHeight is WRONG when the page renders inside
  // a scroll container (e.g. the preview-site shell reports scrollHeight = viewport), which would drop every
  // body element into the footer bucket.
  let pageH = document.documentElement.scrollHeight;
  for (const e of document.querySelectorAll('body *')) { const b = e.getBoundingClientRect().bottom + sy; if (b > pageH) pageH = b; }
  const footTop = pageH - 650;
  const out = [];
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,a,button,p,li,img,[class*="btn"]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.right < 4 || r.left > vpW - 4 || r.bottom < 0) continue; // skip off-screen (hidden mobile-nav variants at x:-236)
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
    const absY = r.top + (window.scrollY || 0);
    const region = absY < H ? 'header' : absY > footTop ? 'footer' : 'body';
    const tag = el.tagName.toLowerCase();
    const text = tag === 'img' ? '' : n(el.textContent).slice(0, 60);
    const heading = /^h[1-6]$/.test(tag);
    const btn = tag === 'button' || (tag === 'a' && (/btn|button/i.test(el.className) || cs.backgroundImage !== 'none' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)'));
    let role = heading ? 'heading' : btn ? 'button' : (tag === 'p' || tag === 'li') ? 'text' : tag === 'img' ? 'img' : 'other';
    if (region === 'body') {
      if (role === 'other' || role === 'img' || !text || text.length < 2) continue; // body: text-bearing meaningful only
    } else {
      if (role === 'other' && !(tag === 'a' || tag === 'button')) continue; // chrome: keep imgs + icon-only a/button
      if (role === 'other') role = 'button';
    }
    const textFull = n(el.textContent);
    // Skip a nested LABEL / counter-skew wrapper inside an <a>/<button> with the SAME text — the enclosing
    // interactive element already represents it (mirrors FIDELITY_EXTRACT in apps/api render).
    const wrap = el.closest('a,button');
    if (wrap && wrap !== el && n(wrap.textContent) === textFull) continue;
    let leaf = el;
    while (true) { const k = [...leaf.children].filter((c) => n(c.textContent)); if (k.length === 1 && n(k[0].textContent) === textFull) leaf = k[0]; else break; }
    const lcs = getComputedStyle(leaf);
    // w/h from OFFSET dims (untransformed border-box, STABLE across skew) not the rect (which inflates with
    // the transform → run-to-run height jitter). x/y stay viewport-relative.
    out.push({ role, tag, text, region, x: Math.round(r.left), y: Math.round(absY), w: el.offsetWidth || Math.round(r.width), h: el.offsetHeight || Math.round(r.height), font: lcs.fontFamily, size: lcs.fontSize, weight: lcs.fontWeight, ls: lcs.letterSpacing, color: lcs.color, bg: cs.backgroundColor, bgImage: cs.backgroundImage.slice(0, 240), shadow: cs.boxShadow.slice(0, 140), transform: cs.transform, radius: cs.borderRadius });
  }
  return out;
};

// Whole-bar / behavioural CHROME facts the per-element diff can't see: is the header pinned (fixed/sticky),
// does the chrome fire click ripple, and does the nav open modals. Counted across header + footer. The SW
// ripple runtime uses the SAME `waves-effect` class protocol as the source, so one selector covers both.
const CHROME_META = () => {
  const header = document.querySelector('#main-nav, header, nav');
  const roots = [header, document.querySelector('#footer, footer')].filter(Boolean);
  // A candidate counts as a MODAL trigger only if the element it targets is ACTUALLY a modal — resolving the
  // id and checking that the TARGET's class or id carries "modal" (Materialize `.modal`, custom `cb-modal` /
  // `modal-lg`, a `#…-modal` id) or is an SW modal. This catches real modals while still excluding a Bootstrap
  // dropdown/tab/collapse `data-target` (→ `.dropdown-menu`, no "modal") or a plain in-page `#anchor` link.
  const isModal = (el) => Boolean(el) && (el.getAttribute('data-sw-component') === 'modal' || /modal/i.test(el.className || '') || /modal/i.test(el.id || ''));
  const targetOf = (el) => { const raw = el.getAttribute('data-target') || el.getAttribute('data-bs-target') || el.getAttribute('data-sw-open') || el.getAttribute('data-sw-modal') || el.getAttribute('data-sw-modal-open') || el.getAttribute('href') || ''; return raw ? document.getElementById(raw.replace(/^#/, '')) : null; };
  let ripple = 0, modalTriggers = 0;
  for (const root of roots) {
    // `[class~="ripple"]` = the exact `ripple` token (not `.no-ripple`/`.ripple-disabled`); waves = the shared
    // Materialize/SW ripple protocol.
    ripple += root.querySelectorAll('.waves-effect, [class~="ripple"], .sw-btn-fx-ripple, [data-sw-ripple]').length;
    for (const el of root.querySelectorAll('[data-target], [data-bs-target], [data-sw-open], [data-sw-modal], [data-sw-modal-open], .modal-trigger, a[href^="#"]')) {
      if (el.classList.contains('modal-trigger') || isModal(targetOf(el))) modalTriggers++;
    }
  }
  return { position: header ? getComputedStyle(header).position : 'static', ripple, modalTriggers };
};

// Read the computed bg/gradient/colour at a point (the closest a/button) — used for the hover pass.
const AT_POINT = ([x, y]) => {
  const hit = document.elementFromPoint(x, y);
  const el = hit && (hit.closest('a,button') || hit);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { bg: cs.backgroundColor, bgImage: cs.backgroundImage.slice(0, 140), color: cs.color };
};

async function capture(browser, url, label = '') {
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
    // STYLESHEET-APPLIED GUARD: if the utility sheet failed to apply (e.g. a bad relative-URL join 404'd
    // styles.css — see preview-url.mjs), the skewed nav collapses and the chrome balloons. A styled chrome
    // nav is ~60-160px; an unstyled one is thousands. Warn LOUDLY so a green score is never trusted off a
    // stylesheet-less render. `getBoundingClientRect().height` is scroll-independent, so this is reliable.
    if (label === 'clone') {
      const navH = await page.evaluate(() => {
        // First ON-SCREEN nav/header — skip off-screen mobile drawers, which can report full height even when
        // the page is correctly styled (mirrors EXTRACT's r.right/r.left on-screen filter), else the guard
        // false-positives on a fine clone.
        for (const sel of ['#main-nav', 'header', 'nav']) {
          const n = document.querySelector(sel);
          if (!n) continue;
          const r = n.getBoundingClientRect();
          if (r.right >= 4 && r.left <= document.documentElement.clientWidth - 4) return Math.round(r.height);
        }
        return 0;
      }).catch(() => 0);
      if (navH > UNSTYLED_NAV_H) console.warn(`  ⚠️  UNSTYLED CLONE at ${url} — nav/header height=${navH}px; the stylesheet likely didn't apply (check the preview URL for a double slash). Scores below are meaningless.`);
    }
    const items = await page.evaluate(EXTRACT).catch((e) => { console.warn(`  WARN extract ${url}: ${e.message}`); return []; });
    // HOVER PASS — for the header's interactive elements (visible at the top), move the real mouse over each
    // and record its hover bg/gradient/colour, so the chrome diff can tell a tab that lights up on hover from
    // one that stays flat. (Footer hover is below the fold + rarely styled; kept to the header for speed.)
    await page.evaluate(() => scrollTo(0, 0)).catch(() => {});
    for (const it of items) {
      if (it.region !== 'header' || it.role !== 'button') continue;
      const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      if (cx < 0 || cy < 0 || cx > VP.width || cy > VP.height) continue;
      try {
        await page.mouse.move(cx, cy);
        await page.waitForTimeout(70);
        it.hover = await page.evaluate(AT_POINT, [cx, cy]);
        await page.mouse.move(3, VP.height - 3);
        await page.waitForTimeout(15);
      } catch { /* skip */ }
    }
    // Whole-bar chrome facts (pinned? ripple? modals?) — attached to the array so main can diff them.
    try { items.meta = await page.evaluate(CHROME_META); } catch { items.meta = {}; }
    return items;
  } finally { await ctx.close().catch(() => {}); }
}

async function main() {
  const res = await fetch(`${BASE}/projects/${PID}/preview-url`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) { console.error(`could not mint preview-url: HTTP ${res.status} (auth? bad SW_PID?)`); process.exit(2); }
  const { base } = await res.json().catch(() => ({}));
  // `base` must be the server's RELATIVE signed path (starts with '/'). Anything else — an absolute URL, a
  // missing field — would build a malformed or unintended target; fail fast rather than point the browser at it.
  if (typeof base !== 'string' || !base.startsWith('/')) { console.error('preview-url response missing a valid relative base (auth?)'); process.exit(2); }
  const browser = await chromium.launch({ headless: true });
  const rows = [];
  try {
    for (const [id, route, src] of PAGES) {
      const cloneUrl = cloneUrlFor(BASE, base, route);
      const origAll = await capture(browser, src, 'original');
      const cloneAll = await capture(browser, cloneUrl, 'clone');
      // BODY — text-matched font/gradient diff, body region only.
      const m = matchAndDiff(origAll.filter((e) => e.region === 'body' && e.text), cloneAll.filter((e) => e.region === 'body' && e.text));
      const s = scorePage(m);
      // CHROME — per-element structural diff (pos/size/font/skew/weight/ls/radius/gradient/shadow) of
      // header + footer, PLUS whole-bar meta (pinned position, ripple, modal triggers).
      const ch = scoreChrome(matchChrome(origAll, cloneAll));
      const cm = scoreChromeMeta(origAll.meta, cloneAll.meta);
      rows.push({ id, s, ch, cm });
      const chromePass = ch.pass && cm.pass;
      const pagePass = s.pass && chromePass;
      console.log(`\n### ${id}  ${pagePass ? 'PASS ✓' : 'FAIL ✗'}`);
      console.log(`   BODY   ${s.pass ? 'pass' : 'FAIL'}  cov=${(s.coverage * 100).toFixed(0)}% (${s.matched}/${s.origCount})  font=${s.fontMiss} grad=${s.gradFail} skew=${s.skewMiss} score=${s.score.toFixed(2)}`);
      for (const d of m.diffs.slice(0, 8)) console.log(`      [${d.role}] "${d.text.slice(0, 38)}"  ${d.props.join('  ')}`);
      console.log(`   CHROME ${chromePass ? 'pass' : 'FAIL'}  cov=${(ch.coverage * 100).toFixed(0)}% (${ch.matched}/${ch.origCount})  pos=${ch.posOff} size=${ch.sizeOff} style=${ch.styleOff} meta=${cm.metaOff}`);
      for (const d of ch.diffs.slice(0, 12)) console.log(`      (${d.region}) "${d.label.slice(0, 24)}"  ${d.props.join('  ')}`);
      for (const d of cm.diffs) console.log(`      (meta) ${d}`);
      if (ch.unmatched.length) console.log(`      CHROME UNMATCHED: ${ch.unmatched.slice(0, 8).map((u) => `(${u.region})"${(u.text || '[' + u.tag + ']').slice(0, 18)}"`).join(' ')}${ch.unmatched.length > 8 ? ` +${ch.unmatched.length - 8}` : ''}`);
    }
  } finally { await browser.close(); }
  console.log('\n===== FIDELITY SUMMARY =====');
  for (const { id, s, ch, cm } of rows) console.log(`  ${s.pass && ch.pass && cm.pass ? 'PASS' : 'FAIL'}  ${id.padEnd(36)} body[${s.pass ? 'ok' : 'X'} cov${(s.coverage * 100).toFixed(0)} font${s.fontMiss} grad${s.gradFail}]  chrome[${ch.pass && cm.pass ? 'ok' : 'X'} pos${ch.posOff} size${ch.sizeOff} style${ch.styleOff} meta${cm.metaOff}]`);
  const failed = rows.filter((r) => !(r.s.pass && r.ch.pass && r.cm.pass)).length;
  console.log(`\n${failed} of ${rows.length} pages FAIL the fidelity gate (body or chrome).`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
