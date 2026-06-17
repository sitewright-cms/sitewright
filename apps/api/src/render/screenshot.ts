// Server-side screenshots of a preview document, so an MCP agent can SEE its rendered page (not just
// read the HTML). We render the exact HTML the preview endpoint already builds, in a headless Chromium
// bundled into the API image. Best-effort: any failure leaves the caller to return HTML without images.
import { chromium, type Browser, type Route, type Request as PwRequest } from 'playwright-core';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface Shot {
  /** PNG/JPEG bytes, base64 (for an MCP image content block). */
  base64: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}

export type ViewportName = 'desktop' | 'mobile';

const VIEWPORTS: Record<ViewportName, { width: number; height: number; capHeight: number; isMobile: boolean }> = {
  // capHeight bounds the full-page screenshot so a long page can't produce a giant image (token cost).
  desktop: { width: 1280, height: 800, capHeight: 2400, isMobile: false },
  mobile: { width: 390, height: 844, capHeight: 1800, isMobile: true },
};

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
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → block
    const [a, b] = p as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return true; // this-host, private, loopback
    if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata 169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (v === 6) {
    const ip6 = ip.toLowerCase();
    if (ip6 === '::1' || ip6 === '::') return true; // loopback / unspecified
    // IPv4-mapped (::ffff:a.b.c.d) → judge by the embedded v4.
    const mapped = ip6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isPrivateIp(mapped[1]);
    if (ip6.startsWith('fc') || ip6.startsWith('fd')) return true; // unique-local fc00::/7
    if (ip6.startsWith('fe8') || ip6.startsWith('fe9') || ip6.startsWith('fea') || ip6.startsWith('feb')) return true; // link-local fe80::/10
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
  const host = u.hostname;
  if (isIP(host)) return !isPrivateIp(host);
  let ips: string[];
  try {
    ips = await resolve(host);
  } catch {
    return false; // unresolvable → block
  }
  if (ips.length === 0) return false;
  return ips.every((ip) => !isPrivateIp(ip)); // block if ANY resolved IP is private (rebinding-safe)
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
  if (headOpen) return html.replace(headOpen[0], `${headOpen[0]}${tag}`);
  return `${tag}${html}`; // no <head> (shouldn't happen for a full document) — best effort
}

// ---------------------------------------------------------------- the browser (lazy singleton)
// Everything below drives a real headless Chromium, so it can't run in unit tests (no browser in the
// test env); it's exercised by the deploy-time end-to-end check instead. The testable parts are above.
/* v8 ignore start */

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      // --no-sandbox: we run as a non-root user in a container with no SUID sandbox helper. The SSRF
      // guard + same-container isolation are the trust boundary, not Chromium's process sandbox.
      .launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
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

// Cap concurrent renders so a burst can't exhaust container memory (each context ~a tab).
let active = 0;
const MAX_CONCURRENT = 2;
const waiters: Array<() => void> = [];
async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((res) => waiters.push(res));
  active++;
}
function release(): void {
  active--;
  waiters.shift()?.();
}

/**
 * Capture `viewports` of the given preview HTML. Returns one Shot per viewport that rendered; throws
 * only if the browser itself is unavailable (the caller treats screenshots as best-effort).
 */
export async function captureScreenshots(
  html: string,
  opts: { originHostPort: string; viewports?: ViewportName[]; timeoutMs?: number },
): Promise<Partial<Record<ViewportName, Shot>>> {
  const wanted = opts.viewports ?? ['desktop', 'mobile'];
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doc = injectBaseHref(html, opts.originHostPort);
  const browser = await getBrowser();
  const plan = (Object.entries(VIEWPORTS) as Array<[ViewportName, (typeof VIEWPORTS)[ViewportName]]>).filter(
    ([name]) => wanted.includes(name),
  );
  const out: Array<[ViewportName, Shot]> = [];

  for (const [name, vp] of plan) {
    await acquire();
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      isMobile: vp.isMobile,
      // Honour reduced-motion so reveal animations settle to their final state for the shot.
      reducedMotion: 'reduce',
    });
    try {
      const page = await context.newPage();
      await page.route('**/*', async (route: Route, request: PwRequest) => {
        const allowed = await isRequestAllowed(request.url(), opts.originHostPort).catch(() => false);
        if (allowed) await route.continue();
        else await route.abort('blockedbyclient');
      });
      await page.setContent(doc, { waitUntil: 'load', timeout });
      // Scroll through the page to trigger scroll-reveal (AOS) + lazy-load runtimes, then return to top.
      // (Runs in the browser; the API tsconfig has no DOM lib, so reach the globals via globalThis.)
      await page
        .evaluate(async () => {
          const g = globalThis as unknown as {
            innerHeight: number;
            scrollBy: (x: number, y: number) => void;
            scrollTo: (x: number, y: number) => void;
            setInterval: (fn: () => void, ms: number) => number;
            clearInterval: (id: number) => void;
            setTimeout: (fn: () => void, ms: number) => void;
            document: { body: { scrollHeight: number } };
          };
          await new Promise<void>((resolve) => {
            let y = 0;
            const step = Math.max(200, g.innerHeight);
            const tick = g.setInterval(() => {
              g.scrollBy(0, step);
              y += step;
              if (y >= g.document.body.scrollHeight) {
                g.clearInterval(tick);
                g.scrollTo(0, 0);
                g.setTimeout(resolve, 150);
              }
            }, 50);
          });
        })
        .catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
      const fullHeight = await page
        .evaluate(() => (globalThis as unknown as { document: { documentElement: { scrollHeight: number } } }).document.documentElement.scrollHeight)
        .catch(() => vp.height);
      const height = Math.min(Math.max(fullHeight, vp.height), vp.capHeight);
      const buf = await page.screenshot({
        type: 'jpeg',
        quality: JPEG_QUALITY,
        clip: { x: 0, y: 0, width: vp.width, height },
      });
      out.push([name, { base64: buf.toString('base64'), mimeType: 'image/jpeg', width: vp.width, height }]);
    } finally {
      await context.close().catch(() => {});
      release();
    }
  }
  return Object.fromEntries(out);
}
/* v8 ignore stop */
