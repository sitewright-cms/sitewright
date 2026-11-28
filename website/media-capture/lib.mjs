// Shared helpers for the media capture: the browser, screenshots, and screen videos with a visible cursor.
//
// Videos are Chrome's screencast frames (JPEG, with timestamps), resampled to a constant 25 fps and encoded to VP9
// WebM by the ffmpeg Playwright ships (it has libvpx-vp9 and an MJPEG decoder, which is all this needs). Headless
// Chrome draws no pointer, so a cursor is painted into the page and moved by `glide()`, together with the real mouse.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/workspace/sitewright/apps/editor/package.json');
const { chromium, request } = require('@playwright/test');

export const here = dirname(fileURLToPath(import.meta.url));
export const BASE = process.env.CAPTURE_BASE ?? 'http://dind.local:2009';
export const SITES_DOMAIN = new URL(BASE).hostname;
export const OUT = process.env.CAPTURE_OUT ?? join(here, 'out');
export const W = 1440;
export const H = 900;
const FFMPEG = `${process.env.HOME}/.cache/ms-playwright/ffmpeg-1013/ffmpeg-linux`;
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`;

mkdirSync(OUT, { recursive: true });

export async function launch() {
  return chromium.launch({
    ...(existsSync(CHROME) ? { executablePath: CHROME } : {}),
    // Sites are served at `<slug>.<sites domain>`; the DinD host has no wildcard DNS.
    args: [`--host-resolver-rules=MAP *.${SITES_DOMAIN} ${SITES_DOMAIN}`, '--hide-scrollbars', '--font-render-hinting=none'],
  });
}

/** A browser context signed in as `email` (a login, so the account must exist). */
export async function signedIn(browser, email, password, opts = {}) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: opts.width ?? W, height: opts.height ?? H },
    deviceScaleFactor: opts.scale ?? 2,
    colorScheme: opts.colorScheme ?? 'light',
    reducedMotion: opts.reducedMotion ?? 'no-preference',
  });
  const res = await context.request.post('/auth/login', { data: { email, password } });
  if (res.status() !== 200) throw new Error(`login ${email}: ${res.status()} ${await res.text()}`);
  return context;
}

/** An API request context signed in as `email`. */
export async function api(email, password) {
  const ctx = await request.newContext({ baseURL: BASE });
  const res = await ctx.post('/auth/login', { data: { email, password } });
  if (res.status() !== 200) throw new Error(`login ${email}: ${res.status()} ${await res.text()}`);
  return ctx;
}

/** Fails loudly on an unexpected status, with the body, so a seed never half-succeeds silently. */
export async function ok(resPromise, what, expected = [200, 201, 204]) {
  const res = await resPromise;
  if (!expected.includes(res.status())) throw new Error(`${what}: HTTP ${res.status()} ${(await res.text()).slice(0, 400)}`);
  const type = res.headers()['content-type'] ?? '';
  return type.includes('json') ? res.json() : res.text();
}

// ── the cursor ───────────────────────────────────────────────────────────────────────────────────
// The cursor and its click ripple are POPOVERS, so they live in the browser's top layer: the editor's modals are
// `<dialog>`s, which paint above any z-index. A newer dialog stacks above an older popover, so `raise()` re-shows
// them before each move to put them back on top.
const CURSOR_JS = `(() => {
  if (window !== window.top || document.getElementById('__cap_cursor')) return;
  const base = 'position:fixed;inset:auto;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;';
  const add = () => {
    const c = document.createElement('div');
    c.id = '__cap_cursor';
    c.setAttribute('popover', 'manual');
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l14 9-6.2 1.4L15.6 20l-3 1.4-3.7-7.6L4 18z" fill="#0F172A" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    c.style.cssText = base + 'left:-40px;top:-40px;width:22px;height:22px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))';
    const r = document.createElement('div');
    r.id = '__cap_ripple';
    r.setAttribute('popover', 'manual');
    r.style.cssText = base + 'left:-60px;top:-60px;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(79,45,216,.35);opacity:0;transform:scale(.4);transition:opacity .35s, transform .35s';
    document.body.append(r, c);
    window.__capRaise = () => { for (const el of [r, c]) { try { el.hidePopover(); } catch {} try { el.showPopover(); } catch {} } };
    window.__capRaise();
  };
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
})();`;

export async function withCursor(context) {
  await context.addInitScript(CURSOR_JS);
}

let pointer = { x: W / 2, y: H / 2 };

/**
 * Moves the painted cursor (animated in the page, on animation frames) and the real mouse (a few steps, so hover
 * effects fire along the way) together, eased, to a point or to the middle of a locator.
 */
export async function glide(page, target, ms = 650) {
  let x, y;
  if (typeof target === 'object' && 'boundingBox' in target) {
    await target.scrollIntoViewIfNeeded().catch(() => {});
    const b = await target.boundingBox();
    if (!b) throw new Error('glide: the target has no box');
    x = b.x + b.width / 2;
    y = b.y + b.height / 2;
  } else {
    ({ x, y } = target);
  }
  const from = { ...pointer };
  await page.evaluate(() => window.__capRaise?.()).catch(() => {});
  const painted = page
    .evaluate(
      ([fx, fy, tx, ty, dur]) =>
        new Promise((resolve) => {
          const c = document.getElementById('__cap_cursor');
          if (!c) return resolve();
          const t0 = performance.now();
          const step = (now) => {
            const t = Math.min(1, (now - t0) / dur);
            const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
            c.style.left = `${fx + (tx - fx) * e - 3}px`;
            c.style.top = `${fy + (ty - fy) * e - 2}px`;
            if (t < 1) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        }),
      [from.x, from.y, x, y, ms],
    )
    .catch(() => {});
  const steps = Math.max(6, Math.round(ms / 45));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await page.waitForTimeout(ms / steps);
  }
  await painted;
  pointer = { x, y };
  return { x, y };
}

/** Glides to the target and clicks it, with a ripple. */
export async function tap(page, target, opts = {}) {
  const at = await glide(page, target, opts.ms);
  await page.evaluate(([px, py]) => {
    const r = document.getElementById('__cap_ripple');
    if (!r) return;
    r.style.transition = 'none'; r.style.left = `${px}px`; r.style.top = `${py}px`; r.style.opacity = '1'; r.style.transform = 'scale(.4)';
    requestAnimationFrame(() => { r.style.transition = 'opacity .45s, transform .45s'; r.style.opacity = '0'; r.style.transform = 'scale(1.6)'; });
  }, [at.x, at.y]).catch(() => {});
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(opts.after ?? 350);
}

/** Types like a person: a steady pace with a little jitter. */
export async function typeSlowly(page, text, delay = 55) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(delay + Math.round(Math.random() * 30));
  }
}

// ── screenshots ──────────────────────────────────────────────────────────────────────────────────
// The slots' aspect ratios, from the media_slots dataset files: a shot is framed at its slot's ratio, because the site
// shows each one `object-cover` in a box of that ratio and would crop anything else.
const RATIOS = {};
for (const f of ['media_slots.json', 'media_slots-features.json', 'media_slots-docs-a.json', 'media_slots-docs-b.json']) {
  const file = join(here, '..', 'datasets', f);
  if (!existsSync(file)) continue;
  for (const e of JSON.parse(readFileSync(file, 'utf8')).entries) {
    const [w, h] = String(e.values.ratio ?? '16x10').split('x').map(Number);
    RATIOS[e.id] = w / h;
  }
}
export const ratioOf = (slot) => RATIOS[slot] ?? 16 / 10;

/**
 * A clip (CSS px) around the union of `boxes`, padded, then widened or heightened about its centre to `ratio`, and kept
 * inside the viewport.
 */
export function frameAround(boxes, ratio, pad = 24, viewport = { width: 1600, height: 1000 }) {
  const x0 = Math.min(...boxes.map((b) => b.x)) - pad;
  const y0 = Math.min(...boxes.map((b) => b.y)) - pad;
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
  const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  let w = x1 - x0;
  let h = y1 - y0;
  if (w / h < ratio) w = h * ratio;
  else h = w / ratio;
  if (w > viewport.width) { w = viewport.width; h = w / ratio; }
  if (h > viewport.height) { h = viewport.height; w = h * ratio; }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const x = Math.max(0, Math.min(viewport.width - w, cx - w / 2));
  const y = Math.max(0, Math.min(viewport.height - h, cy - h / 2));
  return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
}

/** A PNG of the viewport (or of `clip`, in CSS px) into OUT/<slot>.png. */
export async function shot(page, slot, opts = {}) {
  // `around`: locators to frame, at the slot's ratio (`pad` px of margin).
  if (opts.around) {
    const boxes = [];
    for (const l of opts.around) { const b = await l.boundingBox(); if (b) boxes.push(b); }
    if (!boxes.length) throw new Error(`${slot}: nothing to frame`);
    opts = { ...opts, clip: frameAround(boxes, ratioOf(slot), opts.pad ?? 24, page.viewportSize()) };
  }
  await page.evaluate(() => { const c = document.getElementById('__cap_cursor'); if (c) c.style.display = 'none'; }).catch(() => {});
  const path = join(OUT, `${slot}.png`);
  await page.screenshot({ path, type: 'png', ...(opts.clip ? { clip: opts.clip } : {}), ...(opts.fullPage ? { fullPage: true } : {}) });
  await page.evaluate(() => { const c = document.getElementById('__cap_cursor'); if (c) c.style.display = ''; }).catch(() => {});
  console.log(`  ✓ ${slot}.png`);
  return path;
}

// ── screen videos ────────────────────────────────────────────────────────────────────────────────
/**
 * Starts recording the page. Returns `stop()`, which encodes OUT/<slot>.webm (25 fps, VP9) and OUT/<slot>-poster.jpg.
 * `size` is the frame size in px; frames are taken at the viewport's CSS size, scaled to it.
 */
export async function record(page, slot, size = { width: W, height: H }) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    frames.push({ t: metadata.timestamp, data: Buffer.from(data, 'base64') });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: size.width, maxHeight: size.height, everyNthFrame: 1 });
  const started = Date.now() / 1000;
  return async function stop(opts = {}) {
    // Hold the last frame a moment, so the loop's seam is not an abrupt cut.
    await page.waitForTimeout(opts.hold ?? 600);
    await cdp.send('Page.stopScreencast').catch(() => {});
    await cdp.detach().catch(() => {});
    if (frames.length === 0) throw new Error(`${slot}: no frames`);
    const t0 = Math.max(started, frames[0].t);
    const t1 = Date.now() / 1000;
    const fps = 25;
    const path = join(OUT, `${slot}.webm`);
    const ff = spawn(FFMPEG, [
      '-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0',
      '-vf', `scale=${size.width}:${size.height}:flags=lanczos,format=yuv420p`,
      '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(opts.crf ?? 31), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-an', path,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((resolve, reject) => ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)))));
    let i = 0;
    for (let t = t0; t <= t1; t += 1 / fps) {
      while (i + 1 < frames.length && frames[i + 1].t <= t) i++;
      if (!ff.stdin.write(frames[i].data)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    await done;
    const poster = join(OUT, `${slot}-poster.jpg`);
    writeFileSync(poster, frames[Math.min(frames.length - 1, opts.posterFrame ?? frames.length - 1)].data);
    console.log(`  ✓ ${slot}.webm  ${(t1 - t0).toFixed(1)} s, ${frames.length} frames`);
    return { path, poster };
  };
}
