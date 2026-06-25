// Fetch-based site crawler: BFS over same-origin links from a seed URL, producing the CapturedSite the
// site-import engine consumes. Every outbound request goes through an injected SSRF guard + fetcher
// (so the BFS logic is unit-testable without the network). Stylesheets are fetched as CSS assets;
// images stay as remote refs for the engine's MediaPort to fetch + optimize. A page that looks
// client-rendered (SPA shell) is re-rendered via the injected `render` (headless browser) so its
// runtime-built content + links are captured.
import { looksClientRendered, normalizePageUrl, sameOrigin, type CapturedAsset, type CapturedPage, type CapturedSite } from '@sitewright/site-import';

/** A fetched resource the crawler received (already SSRF-checked + size-bounded by the fetcher). */
export interface FetchedResource {
  /** The REQUESTED URL (the fetcher follows redirects internally + re-pins each hop; links on the page are
   *  resolved against this — fine for the common trailing-slash redirect). */
  url: string;
  status: number;
  contentType: string;
  bytes: Uint8Array;
}

export interface CrawlDeps {
  /** SSRF-guarded fetch. Returns null when blocked, non-OK, or oversized. */
  fetchResource: (url: string) => Promise<FetchedResource | null>;
  /** SSRF predicate. Checked before every fetch (the fetcher is the binding guard). */
  isAllowed: (url: string) => Promise<boolean>;
  /** Optional headless render of a client-rendered page → post-JS HTML (null if it can't render). */
  render?: (url: string, opts?: { signal?: AbortSignal }) => Promise<string | null>;
  onProgress?: (e: { fetched: number; queued: number; url: string }) => void;
  signal?: AbortSignal;
}

export interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
  sameOriginOnly: boolean;
  maxBytesTotal: number;
  maxStylesheets: number;
}

export interface CrawlResult {
  site: CapturedSite;
  truncated: boolean;
  warnings: string[];
}

const HTML_RE = /text\/html|application\/xhtml/i;
const CSS_RE = /text\/css/i;
const decoder = new TextDecoder('utf-8');
// Fetch this many resources at once per BFS level. Network-bound, so concurrency is the big win; kept
// modest to stay polite to the origin (no hammering / rate-limit trips).
const CRAWL_CONCURRENCY = 6;

/** Run `fn` over `items` with at most `limit` promises in flight. */
async function runPool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function resolveAbs(href: string, base: string): string | null {
  const h = href.trim();
  if (!h || h.startsWith('#')) return null;
  try {
    return new URL(h, base).href;
  } catch {
    return null;
  }
}

/** Drop HTML comments so commented-out markup isn't mistaken for live links (discovery only). */
function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, ' ');
}

/** Extract anchor hrefs (attribute-order-tolerant; discovery only — the engine re-parses for real). */
export function extractLinks(html: string): string[] {
  const out: string[] = [];
  const src = stripComments(html);
  const re = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

/** Extract stylesheet hrefs from <link rel="...stylesheet..."> tags. */
export function extractStylesheets(html: string): string[] {
  const out: string[] = [];
  const src = stripComments(html);
  const re = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const tag = m[0];
    if (!/\brel\s*=\s*("[^"]*stylesheet[^"]*"|'[^']*stylesheet[^']*'|[^\s">]*stylesheet)/i.test(tag)) continue;
    const h = tag.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/i);
    if (h) out.push(h[2] ?? h[3] ?? h[4] ?? '');
  }
  return out;
}

export async function crawlSite(seedUrl: string, opts: CrawlOptions, deps: CrawlDeps): Promise<CrawlResult> {
  const base = `${new URL(seedUrl).origin}/`;
  const label = new URL(seedUrl).hostname;
  const pages: CapturedPage[] = [];
  const assets = new Map<string, CapturedAsset>();
  const warnings: string[] = [];
  let bytesTotal = 0;
  let truncated = false;

  const seedNorm = normalizePageUrl(seedUrl) ?? seedUrl;
  const seen = new Set<string>([seedNorm]);
  // Dedupe by the NORMALIZED url, but fetch the ORIGINAL url — a server that keeps a trailing slash or
  // `index.html` would 30x the stripped form, which the `redirect: 'error'` fetcher rejects.
  type Item = { url: string; fetchUrl: string; depth: number };
  let current: Item[] = [{ url: seedNorm, fetchUrl: seedUrl, depth: 0 }];

  // BFS one depth LEVEL at a time. Within a level, page fetches (the dominant, network-bound cost) run
  // CONCURRENTLY; results are then applied IN ORDER so the output (page order, dedup, byte budget,
  // truncation) is identical to the old serial crawl — only faster.
  while (current.length > 0 && pages.length < opts.maxPages) {
    if (deps.signal?.aborted) { truncated = true; break; }

    // PHASE 1 — fetch this level concurrently; keep results indexed for deterministic in-order processing.
    const fetched: ({ res: FetchedResource; html: string; depth: number } | null)[] = new Array(current.length).fill(null);
    await runPool(current.map((_, i) => i), CRAWL_CONCURRENCY, async (i) => {
      if (deps.signal?.aborted) return;
      const it = current[i]!;
      if (!(await deps.isAllowed(it.fetchUrl))) { warnings.push(`blocked (SSRF): ${it.fetchUrl}`); return; }
      const res = await deps.fetchResource(it.fetchUrl);
      if (!res) { warnings.push(`fetch failed: ${it.fetchUrl}`); return; }
      let html = '';
      if (HTML_RE.test(res.contentType)) {
        html = decoder.decode(res.bytes);
        // A client-rendered shell has no real content when fetched — re-render it (headless) so its
        // runtime-built DOM + links are captured.
        if (deps.render && looksClientRendered(html)) {
          const rendered = await deps.render(res.url, { signal: deps.signal });
          if (rendered) html = rendered;
        }
      }
      fetched[i] = { res, html, depth: it.depth };
    });

    // PHASE 2 — apply the byte budget, record pages, and discover the next level, all IN ORDER.
    const next: Item[] = [];
    const pendingCss: string[] = [];
    let stop = false;
    for (const f of fetched) {
      if (!f) continue;
      if (pages.length >= opts.maxPages) { truncated = true; stop = true; break; }
      bytesTotal += f.res.bytes.length;
      if (bytesTotal > opts.maxBytesTotal) { truncated = true; stop = true; break; }
      if (!HTML_RE.test(f.res.contentType) || !f.html) continue;
      pages.push({ sourceUrl: f.res.url, html: f.html, statusCode: f.res.status });
      deps.onProgress?.({ fetched: pages.length, queued: next.length, url: f.res.url });
      for (const href of extractStylesheets(f.html)) {
        const abs = resolveAbs(href, f.res.url);
        if (!abs || assets.has(abs) || pendingCss.includes(abs) || !/^https:\/\//i.test(abs)) continue;
        pendingCss.push(abs);
      }
      if (f.depth < opts.maxDepth) {
        for (const href of extractLinks(f.html)) {
          const abs = resolveAbs(href, f.res.url);
          if (!abs || !/^https:\/\//i.test(abs)) continue;
          if (opts.sameOriginOnly && !sameOrigin(abs, base)) continue;
          const norm = normalizePageUrl(abs);
          if (!norm || seen.has(norm)) continue;
          seen.add(norm);
          next.push({ url: norm, fetchUrl: abs, depth: f.depth + 1 });
        }
      }
    }

    // PHASE 3 — fetch this level's NEW stylesheets concurrently (bounded by maxStylesheets; mostly the
    // home's, fetched once then shared/deduped across pages). Like before, the css cap doesn't truncate.
    const cssBudget = pendingCss.slice(0, Math.max(0, opts.maxStylesheets - assets.size));
    await runPool(cssBudget, CRAWL_CONCURRENCY, async (abs) => {
      if (deps.signal?.aborted || assets.size >= opts.maxStylesheets || assets.has(abs)) return;
      if (!(await deps.isAllowed(abs))) return;
      const css = await deps.fetchResource(abs);
      if (css && CSS_RE.test(css.contentType)) {
        bytesTotal += css.bytes.length;
        assets.set(abs, { sourceRef: abs, kind: 'css', bytes: css.bytes, contentType: css.contentType });
      }
    });

    if (stop) break;
    current = next;
  }
  if (current.length > 0 && pages.length >= opts.maxPages) truncated = true;

  return {
    site: { baseUrl: base, pages, assets, origin: { kind: 'crawl', label } },
    truncated,
    warnings,
  };
}
