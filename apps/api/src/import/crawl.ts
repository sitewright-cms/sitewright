// Fetch-based site crawler: BFS over same-origin links from a seed URL, producing the CapturedSite the
// site-import engine consumes. Every outbound request goes through an injected SSRF guard + fetcher
// (so the BFS logic is unit-testable without the network). Stylesheets are fetched as CSS assets;
// images stay as remote refs for the engine's MediaPort to fetch + optimize. A page that looks
// client-rendered (SPA shell) is re-rendered via the injected `render` (headless browser) so its
// runtime-built content + links are captured.
import { looksClientRendered, normalizePageUrl, sameOrigin, type CapturedAsset, type CapturedPage, type CapturedSite } from '@sitewright/site-import';

/** A fetched resource the crawler received (already SSRF-checked + size-bounded by the fetcher). */
export interface FetchedResource {
  /** The final URL (the fetcher must reject redirects, so this equals the request URL). */
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
  const queue: { url: string; fetchUrl: string; depth: number }[] = [{ url: seedNorm, fetchUrl: seedUrl, depth: 0 }];

  while (queue.length > 0 && pages.length < opts.maxPages) {
    if (deps.signal?.aborted) {
      truncated = true;
      break;
    }
    const { fetchUrl, depth } = queue.shift()!;
    if (!(await deps.isAllowed(fetchUrl))) {
      warnings.push(`blocked (SSRF): ${fetchUrl}`);
      continue;
    }
    const res = await deps.fetchResource(fetchUrl);
    if (!res) {
      warnings.push(`fetch failed: ${fetchUrl}`);
      continue;
    }
    bytesTotal += res.bytes.length;
    if (bytesTotal > opts.maxBytesTotal) {
      truncated = true;
      break;
    }
    if (!HTML_RE.test(res.contentType)) continue;

    let html = decoder.decode(res.bytes);
    // A client-rendered shell has no real content when fetched — re-render it (headless) so its
    // runtime-built DOM + links are captured. Discovery below then reads the rendered HTML.
    if (deps.render && looksClientRendered(html)) {
      const rendered = await deps.render(res.url, { signal: deps.signal });
      if (rendered) html = rendered;
    }
    pages.push({ sourceUrl: res.url, html, statusCode: res.status });
    deps.onProgress?.({ fetched: pages.length, queued: queue.length, url: res.url });

    // Fetch stylesheets as CSS assets (bounded), for the engine to inline.
    for (const href of extractStylesheets(html)) {
      if (assets.size >= opts.maxStylesheets) break;
      const abs = resolveAbs(href, res.url);
      if (!abs || assets.has(abs) || !/^https:\/\//i.test(abs)) continue;
      if (!(await deps.isAllowed(abs))) continue;
      const css = await deps.fetchResource(abs);
      if (css && CSS_RE.test(css.contentType)) {
        bytesTotal += css.bytes.length;
        assets.set(abs, { sourceRef: abs, kind: 'css', bytes: css.bytes, contentType: css.contentType });
      }
    }

    // Discover same-origin links for the next depth level.
    if (depth < opts.maxDepth) {
      for (const href of extractLinks(html)) {
        const abs = resolveAbs(href, res.url);
        if (!abs || !/^https:\/\//i.test(abs)) continue;
        if (opts.sameOriginOnly && !sameOrigin(abs, base)) continue;
        const norm = normalizePageUrl(abs);
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        queue.push({ url: norm, fetchUrl: abs, depth: depth + 1 });
      }
    }
  }
  if (queue.length > 0 && pages.length >= opts.maxPages) truncated = true;

  return {
    site: { baseUrl: base, pages, assets, origin: { kind: 'crawl', label } },
    truncated,
    warnings,
  };
}
