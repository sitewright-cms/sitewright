// Server-side screenshots of a preview document, so an MCP agent can SEE its rendered page (not just
// read the HTML). We render the exact HTML the preview endpoint already builds, in a headless Chromium
// bundled into the API image. Best-effort: any failure leaves the caller to return HTML without images.
import { sharedMemoryBudget, type Reservation } from '../runtime/memory-budget.js';
import { unfixChromeForCapture } from './capture-chrome.js';
import {
  captureLegacyShot,
  capturePreviewViewport,
  cdpDriver,
  type CaptureNote,
  type CaptureRequest,
  type PreviewCapture,
} from './preview-capture.js';
import { createSlotPool, RenderQueueBusyError } from './render-slots.js';
import { chromium, type Browser, type CDPSession, type Route, type Request as PwRequest, type Page } from 'playwright-core';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  SCREENSHOT_VIEWPORTS,
  DEFAULT_SCREENSHOT_VIEWPORTS,
  type ScreenshotViewportName,
} from '@sitewright/schema';

export interface Shot {
  /** PNG/JPEG bytes, base64 (for an MCP image content block). */
  base64: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}

// The named breakpoints + their dimensions/caps live in @sitewright/schema (SCREENSHOT_VIEWPORTS) so the
// MCP `viewports` enum and this renderer can't drift. wqhd / fullhd / laptop / tablet / mobile.
export type ViewportName = ScreenshotViewportName;
const VIEWPORTS = SCREENSHOT_VIEWPORTS;

const DEFAULT_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------- SSRF guard (pure, unit-tested)

/**
 * Is `ip` in a loopback / private / link-local / reserved range? The screenshot browser runs INSIDE the
 * API container, so without this an agent could embed <img src="http://169.254.169.254/…"> (cloud
 * metadata) or an internal host and make the server fetch it. We block those — except the API's own
 * origin, which is whitelisted separately (it serves the page's self-hosted media on loopback).
 */
export function isPrivateIp(ip: string): boolean {
  const bare = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip; // tolerate bracketed IPv6
  const v = isIP(bare);
  if (v === 4) {
    const p = bare.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → block
    const [a, b] = p as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return true; // this-host, private, loopback
    if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata 169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0 && p[2] === 0) return true; // IETF protocol assignments (192.0.0.0/24)
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking (198.18.0.0/15), used inside some networks
    if (a >= 224) return true; // multicast (224.0.0.0/4) and class E / reserved (240.0.0.0/4) — never a web host
    return false;
  }
  if (v === 6) {
    const ip6 = bare.toLowerCase().split('%')[0]!; // drop any %zone-id
    if (ip6 === '::1' || ip6 === '::') return true; // loopback / unspecified
    // Several IPv6 forms EMBED an IPv4 address, so a private v4 can ride inside a v6 literal that none
    // of the textual prefix checks below would catch. Expand to the 8 groups once and judge the embedded
    // address by the v4 rules — this covers IPv4-mapped (both the dotted and hex-group spellings),
    // the deprecated IPv4-compatible `::a.b.c.d`, 6to4, and NAT64.
    const g = ipv6Groups(ip6);
    if (g) {
      const embedded = (hi: number, lo: number): string => `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      // 6to4 (2002::/16) — the IPv4 sits in groups 1-2 and is what the tunnel actually reaches.
      if (g[0] === 0x2002) return isPrivateIp(embedded(g[1]!, g[2]!));
      // NAT64: the well-known 64:ff9b::/96 and the RFC 8215 local-use 64:ff9b:1::/48 both put the
      // translated IPv4 in the LAST 32 bits — on a NAT64 network this reaches that v4 directly.
      if (g[0] === 0x0064 && g[1] === 0xff9b) return isPrivateIp(embedded(g[6]!, g[7]!));
      // IPv4-mapped ::ffff:0:0/96 and IPv4-compatible ::/96 (deprecated but still routed by some stacks).
      if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && (g[5] === 0xffff || g[5] === 0)) {
        return isPrivateIp(embedded(g[6]!, g[7]!));
      }
    }
    if (ip6.startsWith('fc') || ip6.startsWith('fd')) return true; // unique-local fc00::/7
    if (/^fe[89ab]/.test(ip6)) return true; // link-local fe80::/10
    if (g) {
      if ((g[0]! & 0xffc0) === 0xfec0) return true; // site-local fec0::/10 (deprecated, still routed inside)
      if ((g[0]! & 0xff00) === 0xff00) return true; // multicast ff00::/8
      if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard-only 100::/64
    }
    return false;
  }
  return true; // not a literal IP that we recognise → caller resolves the host; bare unknown → block
}

/**
 * Expand an IPv6 literal to its 8 16-bit groups, resolving `::` compression and a trailing dotted-quad
 * tail (`::ffff:127.0.0.1`, `64:ff9b::10.0.0.1`). Returns null if it does not parse — callers treat that
 * as "no embedded IPv4 to judge" and fall through to the textual prefix checks.
 */
function ipv6Groups(ip6: string): number[] | null {
  let s = ip6;
  // Unrolled (no nested quantifier) so the match is plainly linear; octet RANGES are checked below.
  const dotted = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (dotted) {
    const q = dotted[1]!.split('.').map(Number);
    if (q.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    s = s.slice(0, dotted.index) + `${(((q[0]! << 8) | q[1]!) >>> 0).toString(16)}:${(((q[2]! << 8) | q[3]!) >>> 0).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null; // more than one '::' is not a valid literal
  const parse = (part: string): number[] => (part === '' ? [] : part.split(':').map((h) => parseInt(h, 16)));
  const head = parse(halves[0] ?? '');
  const groups =
    halves.length === 2
      ? [...head, ...new Array<number>(Math.max(0, 8 - head.length - parse(halves[1] ?? '').length)).fill(0), ...parse(halves[1] ?? '')]
      : head;
  if (groups.length !== 8 || groups.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
  return groups;
}

/** Decide whether the headless browser may issue `url`. `allowHostPort` is the API's own loopback origin. */
export async function isRequestAllowed(
  url: string,
  allowHostPort: string,
  resolve: (host: string) => Promise<string[]> = defaultResolve,
): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'data:' || u.protocol === 'blob:') return true; // inline, no network
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false; // no file:, ftp:, etc.
  // The page's own self-hosted media is served by the API itself on loopback — explicitly allowed.
  // Normalise the default port (URL drops :80/:443) so "127.0.0.1:80" matches http://127.0.0.1/.
  const reqHostPort = `${u.hostname}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`;
  if (reqHostPort === allowHostPort) return true;
  const host = u.hostname.replace(/^\[|\]$/g, ''); // unbracket IPv6 literals
  if (isIP(host)) return !isPrivateIp(host);
  let ips: string[];
  try {
    ips = await resolve(host);
  } catch {
    return false; // unresolvable → block
  }
  if (ips.length === 0) return false;
  // Block if ANY resolved IP is private. This is rebinding-RESISTANT but not rebinding-proof: Chromium
  // re-resolves DNS independently (TOCTOU). The exposure is bounded — only rendered pixels are returned
  // to the agent, never response bytes — so the residual risk is a blind/timing side-channel, not data
  // exfiltration. A forced single-resolution proxy would close it fully if the threat model tightens.
  return ips.every((ip) => !isPrivateIp(ip));
}

/* v8 ignore start -- real DNS lookup; the guard decision logic is unit-tested via an injected resolver */
async function defaultResolve(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true });
  return records.map((r) => r.address);
}
/* v8 ignore stop */

/** Inject a `<base>` so the document's RELATIVE media URLs resolve to the API's own origin (loopback). */
export function injectBaseHref(html: string, originHostPort: string): string {
  const tag = `<base href="http://${originHostPort}/">`;
  // `<head>` or `<head …attrs…>` but NOT `<header>` (\b stops `head` matching inside a longer word).
  const headOpen = html.match(/<head\b[^>]*>/i);
  if (headOpen?.index !== undefined) {
    const end = headOpen.index + headOpen[0].length;
    return html.slice(0, end) + tag + html.slice(end); // slice (not replace) — no $-substitution surprises
  }
  return `${tag}${html}`; // no <head> (shouldn't happen for a full document) — best effort
}

// ---------------------------------------------------------------- the browser (lazy singleton)
// Everything below drives a real headless Chromium, so it can't run in unit tests (no browser in the
// test env); it's exercised by the deploy-time end-to-end check instead. The testable parts are above.
/* v8 ignore start */

let browserPromise: Promise<Browser> | null = null;
let browserReservation: Reservation | null = null;
let lastBrowserUseAt = 0;
let idleSweep: NodeJS.Timeout | null = null;

/**
 * How long the browser may sit unused before it is closed.
 *
 * Measured: the first screenshot adds ~123 MB to the container and leaves FIVE Chrome processes
 * holding ~334 MB RSS, and until now they lived until server shutdown — so any instance that ever
 * took one screenshot carried ~147 MB for the rest of its life. On a 1 GiB container that is 14% of
 * the budget rented permanently for a one-off preview. Relaunch costs ~8s, which is the right trade
 * for an instance that screenshots rarely; a busy one never goes idle long enough to pay it.
 */
const BROWSER_IDLE_MS = (() => {
  // A non-numeric env value yielded NaN, and `Date.now() - last < NaN` is always false — so the sweep
  // would try to close the browser on EVERY tick regardless of idleness. Fall back rather than
  // silently changing behaviour on a typo.
  const raw = Number(process.env.SW_BROWSER_IDLE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 120_000;
})();

/**
 * What a running headless browser is assumed to occupy. Measured on a container: the first capture
 * added ~123MB and left five Chrome processes holding ~334MB RSS / ~147MB resident. Reserved at the
 * higher end deliberately — under-reserving this is what let a preview burst OOM a 1GiB container
 * even with per-capture admission in place.
 */
const BROWSER_RESERVE_BYTES = 256 * 1024 * 1024;
const IDLE_SWEEP_MS = 15_000;

/**
 * What a preview capture adds at its peak, by whether it has to LAUNCH the browser — turned into a
 * ledger reservation by `reservationForPeak`, so a capture is admitted exactly when it fits under the
 * hard limit.
 *
 * Launching: measured ~123MB for the launch plus its first capture. Reused: the browser's own memory is
 * already in the ledger — in the cgroup reading, and in its own 256MB reservation — so only the capture
 * needs room. MEASURED on a 13,000px page at 1920 wide, half scale: the two segments a call returns add
 * ~46MB to Chromium, all five ~74MB. It used to reserve the launch figure, 128MB, against the ledger's
 * 80% line every time — on a 768MB instance that refused any preview above ~486MB in use, where the
 * shared instance sits whenever its browser is warm: "the screenshot was skipped because the instance is
 * temporarily out of memory", on captures that fit with 100MB+ to spare.
 */
const LAUNCH_PEAK_BYTES = 128 * 1024 * 1024;
const CAPTURE_PEAK_BYTES = 80 * 1024 * 1024;
const SHOT_SAFETY_BYTES = 32 * 1024 * 1024;
const SHOT_MIN_RESERVE_BYTES = 64 * 1024 * 1024;

/** Bytes to reserve for one preview capture right now. */
export function screenshotReserveBytes(): number {
  // A warm browser that has sat unused for nearly the release window may be closed (by an audit making
  // room) before this capture reaches it — reserve for the relaunch then, not for a capture alone.
  const warm = browserPromise !== null && Date.now() - lastBrowserUseAt < releaseQuietMs() - 5_000;
  return sharedMemoryBudget.reservationForPeak(warm ? CAPTURE_PEAK_BYTES : LAUNCH_PEAK_BYTES, SHOT_SAFETY_BYTES, SHOT_MIN_RESERVE_BYTES);
}

/**
 * Close the browser if it has no open contexts and has not been handed out for `quietMs`. A context is
 * an in-flight capture; closing under one would fail a live request. Returns whether it closed.
 */
async function closeIfIdle(quietMs: number): Promise<boolean> {
  const p = browserPromise;
  if (!p) return false;
  if (Date.now() - lastBrowserUseAt < quietMs) return false;
  let browser: Browser;
  try {
    browser = await p;
  } catch {
    return false; // a failed launch already cleared the singleton
  }
  if (browser.contexts().length > 0) return false; // busy
  if (browserPromise !== p) return false; // replaced while we awaited
  if (Date.now() - lastBrowserUseAt < quietMs) return false; // handed out while we awaited
  browserPromise = null;
  browserReservation?.release();
  browserReservation = null;
  await browser.close().catch(() => {});
  return true;
}

/**
 * Close the browser once it has been unused for long enough. Sweeping (rather than closing on the last
 * context's close) also covers a caller that leaks a context and then stops using the browser entirely.
 */
function startIdleSweep(): void {
  if (idleSweep || BROWSER_IDLE_MS <= 0) return;
  idleSweep = setInterval(() => {
    void closeIfIdle(BROWSER_IDLE_MS);
  }, IDLE_SWEEP_MS);
  idleSweep.unref?.();
}

/**
 * Give the screenshot browser's memory back NOW, if nothing is using it — for work that launches a
 * browser of its own (a Lighthouse audit). MEASURED on a 768MB container: a preview followed by a
 * both-devices audit was OOM-killed, the warm screenshot browser (~150MB) still resident beside
 * Lighthouse's Chrome; that browser would otherwise idle on for two minutes.
 *
 * "Not handed out recently" is not a nicety: a capture takes the browser BEFORE it queues for a render
 * slot, and may wait up to the slot timeout holding it with no context open yet. Closing under it would
 * fail that capture, so a browser handed out within that window is left alone.
 */
export function releaseIdleBrowser(): Promise<boolean> {
  return closeIfIdle(releaseQuietMs());
}

/** How long the browser must have gone unused before {@link releaseIdleBrowser} may close it. */
function releaseQuietMs(): number {
  return ACQUIRE_TIMEOUT_MS + 3_000;
}

/**
 * Test seam: install a stand-in browser (the idle logic touches only `contexts()` and `close()`) and the
 * time it was last handed out, so the release rules can be pinned without a real Chromium.
 */
export function _setBrowserForTest(browser: Promise<Pick<Browser, 'contexts' | 'close'>> | null, lastUseAt: number): void {
  browserPromise = browser as Promise<Browser> | null;
  browserReservation = null;
  lastBrowserUseAt = lastUseAt;
}

/** The shared headless Chromium singleton (reused by screenshots + the import SPA renderer). */
export async function getBrowser(): Promise<Browser> {
  lastBrowserUseAt = Date.now();
  startIdleSweep();
  if (!browserPromise) {
    const launch: Promise<Browser> = (browserPromise = chromium
      // `chromium-headless-shell`: the purpose-built headless Chromium (no headed/GUI code path) — the
      // right tool for server-side screenshots, and ~380MB smaller in the image than the full browser
      // (we install ONLY the shell; see apps/api/Dockerfile). It is inherently headless, so no `headless`.
      // --no-sandbox: we run as a non-root user in a container with no SUID sandbox helper. The trust
      // boundary is the SSRF guard + the fact that the rendered HTML is the agent's OWN scoped content;
      // a renderer-exploit breakout would have container-level reach (accepted, standard for headless
      // Chrome services). --disable-dev-shm-usage avoids /dev/shm exhaustion in small containers.
      .launch({ channel: 'chromium-headless-shell', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
      .then((b) => {
        // The browser is a LONG-LIVED allocation nothing else accounts for: measured five Chrome
        // processes at ~334MB RSS, ~147MB of container memory that stays until it is closed. Without
        // this the ledger admits work against memory the browser has already taken, which is exactly
        // how a 1GiB container was still OOM-killed by a burst of previews. forceReserve (not
        // tryReserve): the browser is ALREADY running by this point, so the ledger must record it
        // whether or not there was room — refusing here would be a lie about what is allocated.
        const reservation = sharedMemoryBudget.forceReserve(BROWSER_RESERVE_BYTES, 'headless browser');
        browserReservation = reservation;
        // If the browser crashes/disconnects post-launch, drop the singleton so the next call relaunches
        // (otherwise getBrowser() would keep handing back a dead Browser and every newContext() throws).
        //
        // GENERATION-GUARDED. This handler is bound to ONE browser instance, but it fires whenever
        // that instance dies — including long after a newer browser replaced it (the idle sweep closes
        // A, a caller launches B, then A's own 'disconnected' arrives). Without the guard it would null
        // out B's promise — leaking B's five processes forever, the exact accumulation this work
        // removes — and release B's live 256MB reservation, letting the ledger over-admit against
        // memory that is still occupied. Only clear state that is still THIS launch's.
        b.on('disconnected', () => {
          if (browserReservation === reservation) {
            browserReservation.release();
            browserReservation = null;
          }
          if (browserPromise === launch) browserPromise = null;
        });
        return b;
      })
      .catch((err) => {
        if (browserPromise === launch) browserPromise = null; // let a later call retry a fresh launch
        throw err;
      }));
  }
  return browserPromise;
}

/** Close the shared browser (call on server shutdown). */
export async function closeScreenshotBrowser(): Promise<void> {
  if (idleSweep) {
    clearInterval(idleSweep);
    idleSweep = null;
  }
  const p = browserPromise;
  browserPromise = null;
  browserReservation?.release();
  browserReservation = null;
  if (p) await (await p).close().catch(() => {});
}

// Cap concurrent renders so a burst can't exhaust container memory (each context ~a tab). A queued
// request waits at most ACQUIRE_TIMEOUT_MS so a slow render can't pin the queue indefinitely; a wait
// that runs out is a typed RenderQueueBusyError (→ 503 + retry-after), see render-slots.ts.
const MAX_CONCURRENT = 2;
const ACQUIRE_TIMEOUT_MS = 12_000;
const renderSlots = createSlotPool({ max: MAX_CONCURRENT, acquireTimeoutMs: ACQUIRE_TIMEOUT_MS });
const acquire = (): Promise<void> => renderSlots.acquire();
const release = (): void => renderSlots.release();

/**
 * Run `fn` while holding a headless-render slot — shares the same concurrency cap as screenshots so a
 * nativize capture + a burst of agent screenshots can't together exhaust container memory. Pass the
 * request's `signal` so a caller that disconnects while QUEUED leaves the queue instead of taking a
 * slot later for nobody.
 */
export async function withRenderSlot<T>(fn: () => Promise<T>, opts?: { signal?: AbortSignal }): Promise<T> {
  return renderSlots.run(async () => {
    try {
      return await fn();
    } finally {
      // A caller may hold the browser ACROSS slots with no context open in between (compare.ts takes it
      // once, then one slot per viewport). Ending a slot counts as using the browser, so
      // releaseIdleBrowser never closes it in that gap.
      lastBrowserUseAt = Date.now();
    }
  }, opts);
}

// Fixed beat AFTER a child frame's own `load` for its async content to actually PAINT — Google-Maps tiles,
// a video poster, etc. fetch/render via JS well after `load` fires, so a shorter beat catches them as a grey
// box (the recurring "the map is empty" miss). 5s is deliberately generous: fidelity of a lazy embed beats a
// couple of saved seconds, and it's ONLY paid when the page actually HAS an iframe (embed-free pages skip it).
const EMBED_SETTLE_MS = 5000;

/**
 * Bring a freshly-navigated page to a STABLE, fully-loaded state before a screenshot / element extract, so a
 * capture is never corrupted by lazy content or a mid-animation frame. Applied IDENTICALLY to the BUILD and
 * the LIVE ORIGINAL so the side-by-side stays fair. Order matters:
 *  1. scroll top→bottom (triggers scroll-reveal + lazy `<img>`/IntersectionObserver content + lazy iframes),
 *     back to top, and release any preloader scroll-lock so a fullPage shot isn't clipped.
 *  2. re-settle the network after the lazy fetches the scroll kicked off.
 *  3. wait for web fonts (a computed font-family LIES — reports the requested name even if the file never
 *     loaded; the shot must show the REAL glyphs).
 *  4. IFRAME/EMBED settle — the fix for "the map is empty / maps read as a slider": cross-origin embeds
 *     (Google-Maps tiles, video players) are LAZY and fetch/paint AFTER networkidle via their own JS, never
 *     re-settling it, so a shot catches them as a grey/loading box (and the clone then drops the "empty" band).
 *     Step 1's scroll-through triggers the lazy loaders (incl. below-the-fold ones); here we wait each child
 *     frame's own `load`, then bring each VISIBLE embed INTO VIEW and dwell ~5s so its tiles actually paint
 *     (they defer while off-screen, so a wait taken from the top leaves them grey — the recurring miss). Only
 *     when the page has an iframe (the embed-free majority skip this entirely).
 *  5. freeze animations LAST — AFTER embeds had time to paint — so a loading spinner is caught SETTLED, not
 *     mid-spin: finish WAAPI to its end-state + pause CSS animations/transitions. `freeze:false` for the live
 *     behaviour probe, which must keep runtimes running.
 */
export async function settlePage(page: Page, opts?: { freeze?: boolean }): Promise<void> {
  // 1 — scroll to trigger lazy-load, back to top, release scroll-lock (API tsconfig has no DOM lib → globalThis).
  await page
    .evaluate(async () => {
      const g = globalThis as unknown as {
        innerHeight: number; scrollBy: (x: number, y: number) => void; scrollTo: (x: number, y: number) => void;
        setInterval: (fn: () => void, ms: number) => number; clearInterval: (id: number) => void; setTimeout: (fn: () => void, ms: number) => void;
        document: { documentElement: { scrollHeight: number; style: { setProperty(p: string, v: string, prio?: string): void } }; body: { style: { setProperty(p: string, v: string, prio?: string): void } } };
      };
      await new Promise<void>((resolve) => {
        let y = 0, steps = 0; const step = Math.max(200, g.innerHeight);
        const tick = g.setInterval(() => {
          g.scrollBy(0, step); y += step;
          if (y >= g.document.documentElement.scrollHeight || ++steps > 60) { g.clearInterval(tick); g.scrollTo(0, 0); g.setTimeout(resolve, 150); }
        }, 50);
      });
      for (const el of [g.document.documentElement, g.document.body]) {
        el.style.setProperty('overflow', 'visible', 'important');
        el.style.setProperty('height', 'auto', 'important');
      }
    })
    .catch(() => {});
  // 2 — network settle after the scroll's lazy fetches
  await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
  // 2b — platform carousels hide their track during Embla enhancement (the #718 CLS guard) and reveal it two
  // rAFs AFTER data-sw-enhanced lands — a capture in that window shows a blank band. Wait (bounded) until
  // every multi-slide carousel is enhanced AND visible. Vacuously immediate on pages without platform
  // carousels (the live ORIGINAL side), and a stalled init just burns the 1s timeout, never fails the render.
  await page
    .waitForFunction(
      `Array.from(document.querySelectorAll('[data-sw-component="carousel"]')).every((c) =>
         c.querySelectorAll('[data-sw-part="slide"]').length < 2 ||
         (c.getAttribute('data-sw-enhanced') === 'true' && c.style.visibility !== 'hidden'))`,
      { timeout: 1000 },
    )
    .catch(() => {});
  // 3 — fonts ready
  await page
    .evaluate(async () => { const g = globalThis as unknown as { document?: { fonts?: { ready?: Promise<unknown> } } }; if (g.document?.fonts?.ready) { try { await g.document.fonts.ready; } catch { /* fonts optional */ } } })
    .catch(() => {});
  // 4 — iframe/embed paint (maps tiles, video players): wait each child frame's load, then a tile-paint beat.
  const hasEmbed = await page
    .evaluate(() => (globalThis as unknown as { document: { querySelector(s: string): unknown } }).document.querySelector('iframe') != null)
    .catch(() => false);
  if (hasEmbed) {
    await Promise.all(page.frames().map((f) => f.waitForLoadState('load', { timeout: 5000 }).catch(() => {}))).catch(() => {});
    // A lazy embed (Google-Maps tiles, a video player) only PAINTS while ~on-screen and DEFERS while off-screen,
    // so a fullPage shot taken from the top catches it as a grey box (the "the map is empty" miss). Bring each
    // VISIBLE iframe INTO VIEW and dwell so its tiles actually paint — they persist once loaded — then restore
    // the scroll for the shot. Only rendered (non-hidden, sized) iframes count, and it's capped, so a hidden
    // modal-PDF or a page full of embeds can't stall the render.
    const visibleEmbeds = await page
      .evaluate(() => {
        const g = globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ getBoundingClientRect(): { width: number; height: number } }> } };
        const out: number[] = [];
        const list = g.document.querySelectorAll('iframe');
        for (let i = 0; i < list.length; i++) { const el = list[i]; if (!el) continue; const r = el.getBoundingClientRect(); if (r.height > 40 && r.width > 40) out.push(i); }
        return out;
      })
      .catch(() => [] as number[]);
    for (const idx of visibleEmbeds.slice(0, 3)) {
      await page
        .evaluate((i) => {
          const list = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ scrollIntoView(o: { block: string }): void }> } }).document.querySelectorAll('iframe');
          list[i]?.scrollIntoView({ block: 'center' });
        }, idx)
        .catch(() => {});
      await page.waitForTimeout(EMBED_SETTLE_MS).catch(() => {});
    }
    await page.evaluate(() => (globalThis as unknown as { scrollTo(x: number, y: number): void }).scrollTo(0, 0)).catch(() => {});
  }
  // 5 — freeze animations to a settled end-state (unless a live probe needs them running).
  if (opts?.freeze !== false) {
    await page
      .evaluate(() => {
        const g = globalThis as unknown as {
          document: { getAnimations?: () => Array<{ finish: () => void; cancel?: () => void }>; createElement: (t: string) => { textContent: string }; head?: { appendChild: (n: unknown) => void } };
          setTimeout: (fn: () => void, ms: number) => number; clearTimeout: (id: number) => void; clearInterval: (id: number) => void;
        };
        // Finish finite animations to their end-state; an INFINITE one throws on finish() — CANCEL it back to
        // its base state instead of leaving it paused mid-tween (a CSS marquee/rotator paused mid-cross-fade
        // is the "garbled overlapping text" capture).
        try { g.document.getAnimations?.().forEach((a) => { try { a.finish(); } catch { try { a.cancel?.(); } catch { /* detached */ } } }); } catch { /* not supported */ }
        // JS-timer cyclers (jQuery/slick rotators, bespoke setInterval sliders) ignore every CSS/WAAPI freeze
        // and keep mutating the DOM between the freeze and the shot. The capture is terminal — nothing after
        // it needs page timers — so clear them all (ids are a monotonic counter; a fresh id bounds the sweep).
        // Sweep capped: a hostile page could pre-inflate the timer-id counter to make this loop spin.
        try { const top = Math.min(g.setTimeout(() => {}, 0), 100_000); for (let i = 1; i <= top; i++) { g.clearTimeout(i); g.clearInterval(i); } } catch { /* timers optional */ }
        const s = g.document.createElement('style');
        // Pause CSS/WAAPI animations AND force scroll-reveal libraries to their VISIBLE end-state — a
        // JS-driven reveal (Framer-Motion whileInView sets inline opacity/translate; AOS `[data-aos]`;
        // Locomotive `[data-scroll]`; the platform's own `[data-sw-animation]`) leaves a section at
        // opacity:0 once it scrolls out of view, which a full-page composite would capture as BLANK.
        // Targeted (inline-reveal + known reveal hooks) so normal layout/transforms are untouched.
        // Slick fade-rotators stack ALL slides with inline opacities mid-fade — collapse to the active one.
        s.textContent =
          '*,*::before,*::after{animation-play-state:paused !important;transition:none !important;scroll-behavior:auto !important}' +
          '[style*="opacity"],[data-aos],[data-sw-animation],[data-scroll]{opacity:1 !important;visibility:visible !important}' +
          '[style*="translate"],[data-aos],[data-sw-animation]{transform:none !important}' +
          '.slick-slide:not(.slick-active){opacity:0 !important}.slick-slide.slick-active{opacity:1 !important}' +
          // The timer sweep above may have killed a still-pending #718 fallback-reveal timer — force the
          // carousel visible for the shot (its enhancement, when done, is already awaited in step 2b).
          '[data-sw-component="carousel"]{visibility:visible !important}' +
          // Fixed/sticky ELEMENTS are handled by a computed-style pass right after this (see
          // capture-chrome.ts). background-attachment:fixed paints relative to the VIEWPORT, so
          // in a stitched shot the image lands at a different offset on each side and reads as "the
          // background is missing" — one agent lost a diagnostic detour to exactly that.
          '*{background-attachment:scroll !important}';
        g.document.head?.appendChild(s);
      })
      .catch(() => {});
    // UN-FIX THE FIXED CHROME — fixed elements pinned `absolute` where a visitor sees them, sticky ones
    // returned to the flow (never `absolute`: that moved sticky grid columns). The why, and the in-page
    // code, live in capture-chrome.ts. Both sides of every comparison get the same treatment.
    await page.evaluate(unfixChromeForCapture).catch(() => {});
    // BACK TO THE TOP — on whatever element ACTUALLY scrolls, and AFTER the two passes above.
    // Step 1 already scrolled back with `window.scrollTo(0, 0)`, but that is not enough here for two
    // compounding reasons. A preview page scrolls its BODY (`overflow:auto`), where `window.scrollTo` is a
    // no-op; and the style injected above REMOVES that overflow, so the DOCUMENT becomes the scroller and
    // inherits the offset the body was left at — while `window.scrollY` still reports 0.
    // Measured on a real preview: after the freeze, `documentElement.scrollTop` was 4228 with
    // `window.scrollY === 0`, putting the first heading at `top:-3516`. Everything above the viewport then
    // failed the extractor's `rect.bottom < 0` test and 39 elements became 1 — which `fidelity_check`
    // reported as `coverage: 0`, indistinguishable from a clone that reproduced nothing. Three of six real
    // projects scored a silent 0% on exactly this.
    // Resetting all three candidates is the only version that holds whichever element ends up scrolling.
    await page
      .evaluate(() => {
        const g = globalThis as unknown as {
          document: { scrollingElement: { scrollTop: number } | null; documentElement: { scrollTop: number }; body: { scrollTop: number } };
          scrollTo: (x: number, y: number) => void;
        };
        for (const t of [g.document.scrollingElement, g.document.documentElement, g.document.body]) {
          try { if (t) t.scrollTop = 0; } catch { /* detached */ }
        }
        try { g.scrollTo(0, 0); } catch { /* jsdom-ish */ }
      })
      .catch(() => {});
    await page.waitForTimeout(400).catch(() => {});
  }
}

/**
 * Open the preview document at one viewport, settle it, and hand the page to `fn` — inside a render
 * slot, with the SSRF guard on every request, and with the context closed however `fn` ends.
 * `deviceScaleFactor` is the raster scale the page lays out its images for (srcset picks by it).
 */
async function withPreviewPage<T>(
  doc: string,
  vp: (typeof VIEWPORTS)[ViewportName],
  opts: { originHostPort: string; timeoutMs: number; deviceScaleFactor: number },
  fn: (page: Page, cdp: CDPSession) => Promise<T>,
): Promise<T> {
  const browser = await getBrowser();
  await acquire();
  // newContext() is INSIDE the try so release() runs even if it throws (a crashed browser) — otherwise
  // the slot would leak and, after MAX_CONCURRENT failures, deadlock every future render.
  let context: Awaited<ReturnType<Browser['newContext']>> | undefined;
  try {
    context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: opts.deviceScaleFactor,
      isMobile: vp.isMobile,
      // Honour reduced-motion so reveal animations settle to their final state for the shot.
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(opts.timeoutMs); // bound evaluate()/screenshot()/etc. — not Playwright's 30s default
    await page.route('**/*', async (route: Route, request: PwRequest) => {
      const allowed = await isRequestAllowed(request.url(), opts.originHostPort).catch(() => false);
      if (allowed) await route.continue();
      else await route.abort('blockedbyclient');
    });
    await page.setContent(doc, { waitUntil: 'load', timeout: opts.timeoutMs });
    // Scroll-load + fonts + iframe/embed paint + animation freeze — shared with compare.ts so the agent's
    // own preview and the fidelity side-by-sides settle identically (maps paint, lower sections load).
    await settlePage(page, { freeze: true });
    return await fn(page, await context.newCDPSession(page));
  } finally {
    await context?.close().catch(() => {});
    lastBrowserUseAt = Date.now();
    release();
  }
}

function plannedViewports(wanted: readonly ViewportName[]): Array<[ViewportName, (typeof VIEWPORTS)[ViewportName]]> {
  return (Object.entries(VIEWPORTS) as Array<[ViewportName, (typeof VIEWPORTS)[ViewportName]]>).filter(([name]) => wanted.includes(name));
}

/**
 * The LEGACY capture: one whole-page image per viewport, fitted inside the model's many-image ceiling —
 * what a request without `segment` (an older MCP client) has always received. Dimensions are reported
 * in CSS px, as they always were. Throws only if the browser itself is unavailable (best-effort caller).
 */
export async function captureScreenshots(
  html: string,
  opts: { originHostPort: string; viewports?: ViewportName[]; timeoutMs?: number; scale?: number },
): Promise<Partial<Record<ViewportName, Shot>>> {
  // `scale` = the raster deviceScaleFactor. The page still LAYS OUT at each viewport's CSS width (so the
  // desktop/mobile layout is unchanged), but the emitted image is scaled — preview_page passes < 1 to
  // roughly halve the pixel count (≈ half the vision tokens). compare_to_source doesn't use this path.
  const scale = opts.scale && opts.scale > 0 ? opts.scale : 1;
  const doc = injectBaseHref(html, opts.originHostPort);
  const settings = { originHostPort: opts.originHostPort, timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, deviceScaleFactor: scale };
  const out: Array<[ViewportName, Shot]> = [];
  for (const [name, vp] of plannedViewports(opts.viewports ?? DEFAULT_SCREENSHOT_VIEWPORTS)) {
    out.push([name, await withPreviewPage(doc, vp, settings, (page, cdp) => captureLegacyShot(cdpDriver(page, cdp, settings.timeoutMs), vp, scale))]);
  }
  return Object.fromEntries(out);
}

/**
 * The SEGMENTED capture `preview_page` uses: per viewport, at most two readable images from
 * `request.segment` on — the page, or the first element matching `request.selector`. See
 * capture-plan.ts for the cutting rules. Throws only if the browser itself is unavailable.
 */
export async function capturePreview(
  html: string,
  opts: { originHostPort: string; viewports?: ViewportName[]; timeoutMs?: number; scale?: number; request: CaptureRequest },
): Promise<{ captures: PreviewCapture[]; notes: CaptureNote[] }> {
  const pageScale = opts.scale && opts.scale > 0 ? opts.scale : 1;
  // An element is shown sharper than the page (up to full resolution), so its images are laid out for
  // a full-resolution raster; a whole page keeps the preview's reduced one.
  const deviceScaleFactor = opts.request.selector !== undefined ? 1 : pageScale;
  const doc = injectBaseHref(html, opts.originHostPort);
  const settings = { originHostPort: opts.originHostPort, timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, deviceScaleFactor };
  const captures: PreviewCapture[] = [];
  const notes: CaptureNote[] = [];
  const failures: unknown[] = [];
  const plan = plannedViewports(opts.viewports ?? DEFAULT_SCREENSHOT_VIEWPORTS);
  for (const [name, vp] of plan) {
    try {
      const one = await withPreviewPage(doc, vp, settings, (page, cdp) =>
        capturePreviewViewport(cdpDriver(page, cdp, settings.timeoutMs), name, vp, opts.request, pageScale),
      );
      captures.push(...one.captures);
      notes.push(...one.notes);
    } catch (err) {
      // A full render queue is backpressure for the whole request — the caller says "retry". Anything
      // else is THIS viewport: say so, and keep the ones that did render.
      if (err instanceof RenderQueueBusyError) throw err;
      failures.push(err);
      notes.push({ viewport: name, message: `this viewport could not be captured: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  if (plan.length > 0 && failures.length === plan.length) throw failures[0];
  return { captures, notes };
}
/* v8 ignore stop */
