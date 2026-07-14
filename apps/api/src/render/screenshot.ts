// Server-side screenshots of a preview document, so an MCP agent can SEE its rendered page (not just
// read the HTML). We render the exact HTML the preview endpoint already builds, in a headless Chromium
// bundled into the API image. Best-effort: any failure leaves the caller to return HTML without images.
import { chromium, type Browser, type Route, type Request as PwRequest, type Page } from 'playwright-core';
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

const JPEG_QUALITY = 78;
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
    if (a >= 240) return true; // class E / reserved (240.0.0.0/4) — not publicly routable
    return false;
  }
  if (v === 6) {
    const ip6 = bare.toLowerCase().split('%')[0]!; // drop any %zone-id
    if (ip6 === '::1' || ip6 === '::') return true; // loopback / unspecified
    // IPv4-mapped, dotted-decimal form (::ffff:a.b.c.d) → judge by the embedded v4.
    const mapped = ip6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isPrivateIp(mapped[1]);
    // IPv4-mapped, hex-group form (::ffff:7f00:1 === 127.0.0.1) → expand + judge by the embedded v4.
    const hex = ip6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1]!, 16);
      const lo = parseInt(hex[2]!, 16);
      return isPrivateIp(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
    }
    if (ip6.startsWith('fc') || ip6.startsWith('fd')) return true; // unique-local fc00::/7
    if (/^fe[89ab]/.test(ip6)) return true; // link-local fe80::/10
    return false;
  }
  return true; // not a literal IP that we recognise → caller resolves the host; bare unknown → block
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

/** The shared headless Chromium singleton (reused by screenshots + the import SPA renderer). */
export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      // `chromium-headless-shell`: the purpose-built headless Chromium (no headed/GUI code path) — the
      // right tool for server-side screenshots, and ~380MB smaller in the image than the full browser
      // (we install ONLY the shell; see apps/api/Dockerfile). It is inherently headless, so no `headless`.
      // --no-sandbox: we run as a non-root user in a container with no SUID sandbox helper. The trust
      // boundary is the SSRF guard + the fact that the rendered HTML is the agent's OWN scoped content;
      // a renderer-exploit breakout would have container-level reach (accepted, standard for headless
      // Chrome services). --disable-dev-shm-usage avoids /dev/shm exhaustion in small containers.
      .launch({ channel: 'chromium-headless-shell', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
      .then((b) => {
        // If the browser crashes/disconnects post-launch, drop the singleton so the next call relaunches
        // (otherwise getBrowser() would keep handing back a dead Browser and every newContext() throws).
        b.on('disconnected', () => {
          browserPromise = null;
        });
        return b;
      })
      .catch((err) => {
        browserPromise = null; // let a later call retry a fresh launch
        throw err;
      });
  }
  return browserPromise;
}

/** Close the shared browser (call on server shutdown). */
export async function closeScreenshotBrowser(): Promise<void> {
  const p = browserPromise;
  browserPromise = null;
  if (p) await (await p).close().catch(() => {});
}

// Cap concurrent renders so a burst can't exhaust container memory (each context ~a tab). A queued
// request waits at most ACQUIRE_TIMEOUT_MS so a slow render can't pin the queue indefinitely.
let active = 0;
const MAX_CONCURRENT = 2;
const ACQUIRE_TIMEOUT_MS = 12_000;
const waiters: Array<() => void> = [];
async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const onFree = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      active++; // take the slot the releaser just freed
      resolve();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const i = waiters.indexOf(onFree);
      if (i >= 0) waiters.splice(i, 1);
      reject(new Error('screenshot render queue is busy'));
    }, ACQUIRE_TIMEOUT_MS);
    waiters.push(onFree);
  });
}
function release(): void {
  active--;
  waiters.shift()?.();
}

/**
 * Run `fn` while holding a headless-render slot — shares the same concurrency cap as screenshots so a
 * nativize capture + a burst of agent screenshots can't together exhaust container memory.
 */
export async function withRenderSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

const EMBED_SETTLE_MS = 2200;

/**
 * Bring a freshly-navigated page to a STABLE, fully-loaded state before a screenshot / element extract, so a
 * capture is never corrupted by lazy content or a mid-animation frame. Applied IDENTICALLY to the BUILD and
 * the LIVE ORIGINAL so the side-by-side stays fair. Order matters:
 *  1. scroll top→bottom (triggers scroll-reveal + lazy `<img>`/IntersectionObserver content + lazy iframes),
 *     back to top, and release any preloader scroll-lock so a fullPage shot isn't clipped.
 *  2. re-settle the network after the lazy fetches the scroll kicked off.
 *  3. wait for web fonts (a computed font-family LIES — reports the requested name even if the file never
 *     loaded; the shot must show the REAL glyphs).
 *  4. IFRAME/EMBED settle — the fix for "maps read as a slider": cross-origin embeds (Google-Maps tiles, video
 *     players) fetch AFTER networkidle and never re-settle it, so a fullPage shot catches them mid-load as a
 *     grey/loading box. Wait each child frame's own `load`, THEN a fixed beat for tiles to paint. Only when the
 *     page actually has an iframe (free for the rest).
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
  // 3 — fonts ready
  await page
    .evaluate(async () => { const g = globalThis as unknown as { document?: { fonts?: { ready?: Promise<unknown> } } }; if (g.document?.fonts?.ready) { try { await g.document.fonts.ready; } catch { /* fonts optional */ } } })
    .catch(() => {});
  // 4 — iframe/embed paint (maps tiles, video players): wait each child frame's load, then a tile-paint beat.
  const hasEmbed = await page
    .evaluate(() => (globalThis as unknown as { document: { querySelector(s: string): unknown } }).document.querySelector('iframe') != null)
    .catch(() => false);
  if (hasEmbed) {
    await Promise.all(page.frames().map((f) => f.waitForLoadState('load', { timeout: 3000 }).catch(() => {}))).catch(() => {});
    await page.waitForTimeout(EMBED_SETTLE_MS).catch(() => {});
  }
  // 5 — freeze animations to a settled end-state (unless a live probe needs them running).
  if (opts?.freeze !== false) {
    await page
      .evaluate(() => {
        const g = globalThis as unknown as { document: { getAnimations?: () => Array<{ finish: () => void }>; createElement: (t: string) => { textContent: string }; head?: { appendChild: (n: unknown) => void } } };
        try { g.document.getAnimations?.().forEach((a) => { try { a.finish(); } catch { /* running/infinite */ } }); } catch { /* not supported */ }
        const s = g.document.createElement('style');
        s.textContent = '*,*::before,*::after{animation-play-state:paused !important;transition:none !important;scroll-behavior:auto !important}';
        g.document.head?.appendChild(s);
      })
      .catch(() => {});
    await page.waitForTimeout(400).catch(() => {});
  }
}

/**
 * Capture `viewports` of the given preview HTML. Returns one Shot per viewport that rendered; throws
 * only if the browser itself is unavailable (the caller treats screenshots as best-effort).
 */
export async function captureScreenshots(
  html: string,
  opts: { originHostPort: string; viewports?: ViewportName[]; timeoutMs?: number; scale?: number },
): Promise<Partial<Record<ViewportName, Shot>>> {
  const wanted = opts.viewports ?? DEFAULT_SCREENSHOT_VIEWPORTS;
  // `scale` = the raster deviceScaleFactor. The page still LAYS OUT at each viewport's CSS width (so the
  // desktop/mobile layout is unchanged), but the emitted image is scaled — preview_page passes < 1 to
  // roughly halve the pixel count (≈ half the vision tokens). compare_to_source doesn't use this path.
  const scale = opts.scale && opts.scale > 0 ? opts.scale : 1;
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doc = injectBaseHref(html, opts.originHostPort);
  const browser = await getBrowser();
  const plan = (Object.entries(VIEWPORTS) as Array<[ViewportName, (typeof VIEWPORTS)[ViewportName]]>).filter(
    ([name]) => wanted.includes(name),
  );
  const out: Array<[ViewportName, Shot]> = [];

  for (const [name, vp] of plan) {
    await acquire();
    // newContext() is INSIDE the try so release() runs even if it throws (a crashed browser) — otherwise
    // the slot would leak and, after MAX_CONCURRENT failures, deadlock every future render.
    let context: Awaited<ReturnType<Browser['newContext']>> | undefined;
    try {
      context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: scale,
        isMobile: vp.isMobile,
        // Honour reduced-motion so reveal animations settle to their final state for the shot.
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      page.setDefaultTimeout(timeout); // bound evaluate()/screenshot()/etc. — not Playwright's 30s default
      await page.route('**/*', async (route: Route, request: PwRequest) => {
        const allowed = await isRequestAllowed(request.url(), opts.originHostPort).catch(() => false);
        if (allowed) await route.continue();
        else await route.abort('blockedbyclient');
      });
      await page.setContent(doc, { waitUntil: 'load', timeout });
      // Scroll-load + fonts + iframe/embed paint + animation freeze — shared with compare.ts so the agent's
      // own preview and the fidelity side-by-sides settle identically (maps paint, lower sections load).
      await settlePage(page, { freeze: true });
      const fullHeight = await page
        .evaluate(() => (globalThis as unknown as { document: { documentElement: { scrollHeight: number } } }).document.documentElement.scrollHeight)
        .catch(() => vp.height);
      // Capture the WHOLE page. Use Playwright `fullPage` (Chromium captures beyond the viewport WITHOUT
      // resizing the layout viewport) so below-the-fold is included AND `vh`-based sections keep their real
      // height — resizing the viewport would make a `100vh`/`80vh` hero grow with it, inflating the page
      // toward the cap. Only a PATHOLOGICALLY tall page (over the DoS cap) falls back to a capped capture.
      const height = Math.min(Math.max(fullHeight, vp.height), vp.capHeight);
      let buf: Buffer;
      if (fullHeight <= vp.capHeight) {
        buf = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY, fullPage: true });
      } else {
        await page.setViewportSize({ width: vp.width, height: vp.capHeight }).catch(() => {});
        await page.waitForTimeout(150).catch(() => {});
        buf = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY });
      }
      out.push([name, { base64: buf.toString('base64'), mimeType: 'image/jpeg', width: vp.width, height }]);
    } finally {
      await context?.close().catch(() => {});
      release();
    }
  }
  return Object.fromEntries(out);
}
/* v8 ignore stop */
