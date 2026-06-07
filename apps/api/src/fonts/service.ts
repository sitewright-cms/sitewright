import { googleFont, isGoogleFamily, familySlug } from '@sitewright/blocks/google-fonts-catalog';
import { targetsPrivateHost, SelfHostedFontSchema, type SelfHostedFont } from '@sitewright/schema';
import type { FontStore } from './store.js';

// Self-hosting fetch for Google Fonts. The browser NEVER loads from Google on a preview/published
// page — only this server-side path contacts Google, ONCE per family, to download the woff2 into
// the instance cache. Guards mirror the stock-image downloader (apps/api/src/stock/service.ts):
// https-only, EXACT host allowlist, no redirects, a per-file size cap, and a timeout.

const CSS_HOST = 'fonts.googleapis.com';
const FONT_HOST = 'fonts.gstatic.com';
const MAX_WOFF2_BYTES = 2 * 1024 * 1024; // 2 MiB per weight (a latin woff2 is ~20–80 KiB)
const MAX_CSS_BYTES = 256 * 1024;
const TIMEOUT_MS = 10_000;
// A modern desktop UA so the css2 endpoint returns woff2 (older UAs get woff/ttf).
const WOFF2_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class FontFetchError extends Error {}

/** Rejects anything that isn't `https://<exactHost>/…` on a public host (SSRF guard). */
function assertAllowed(url: string, exactHost: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new FontFetchError('invalid font url');
  }
  if (u.protocol !== 'https:' || u.hostname !== exactHost || targetsPrivateHost(url)) {
    throw new FontFetchError(`refusing to fetch a non-allowlisted url (${u.hostname || '?'})`);
  }
}

async function fetchGuarded(url: string, host: string, accept: string, maxBytes: number): Promise<{ buffer: Buffer; contentType: string }> {
  assertAllowed(url, host);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'error', // a 3xx to a private host can't bypass the allowlist
      headers: { 'user-agent': WOFF2_UA, accept },
    });
    if (!res.ok) throw new FontFetchError(`font fetch failed (${res.status})`);
    if (Number(res.headers.get('content-length') ?? '0') > maxBytes) throw new FontFetchError('font exceeds size limit');
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) throw new FontFetchError('font exceeds size limit');
    return { buffer, contentType: (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '' };
  } finally {
    clearTimeout(timer);
  }
}

// Each css2 `@font-face { … }` block. `[^{}]*` (css2 faces have no nested braces) keeps this LINEAR —
// no catastrophic backtracking. Weight + src are read INDEPENDENTLY of their order within the block
// (Google's declaration order isn't guaranteed). The src is hard-locked to gstatic (the SSRF gate).
const BLOCK_RE = /@font-face\s*\{([^{}]*)\}/g;
const WEIGHT_RE = /font-weight:\s*(\d+)/;
// Capture the whole gstatic url (one bounded `[^\s)]+`, no `\.woff2` overlap → linear, ReDoS-free);
// the `.woff2` suffix is asserted in code below. The host is still hard-locked to gstatic (SSRF gate).
const SRC_RE = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^\s)]+)\)/;
// The `/* subset */` comment Google emits just before each block (used to PREFER the latin woff2).
const SUBSET_RE = /\/\*\s*([a-z-]+)\s*\*\/\s*$/;

interface Face {
  subset: string;
  weight: number;
  url: string;
}

function parseFaces(css: string): Face[] {
  const out: Face[] = [];
  for (const m of css.matchAll(BLOCK_RE)) {
    const body = m[1]!;
    const wm = WEIGHT_RE.exec(body);
    const sm = SRC_RE.exec(body);
    if (!wm || !sm || !sm[1]!.endsWith('.woff2')) continue;
    // Read the subset name from the short comment immediately preceding this block (if any).
    const lead = css.slice(Math.max(0, (m.index ?? 0) - 40), m.index);
    out.push({ subset: SUBSET_RE.exec(lead)?.[1] ?? '', weight: Number(wm[1]), url: sm[1]! });
  }
  return out;
}

/** Builds the keyless css2 URL for a (catalog-validated) family + weights. */
function css2Url(family: string, weights: number[]): string {
  const fam = encodeURIComponent(family).replace(/%20/g, '+'); // family is catalog-allowlisted
  return `https://${CSS_HOST}/css2?family=${fam}:wght@${weights.join(';')}&display=swap`;
}

/**
 * Downloads + self-hosts the latin woff2 for a Google family's requested weights into the instance
 * cache, and returns the project-referencable {@link SelfHostedFont} record. The family MUST be in
 * the bundled catalog (a positive allowlist); weights are intersected with what the family offers.
 */
export async function selectGoogleFont(store: FontStore, family: string, weights: readonly number[]): Promise<SelfHostedFont> {
  if (!isGoogleFamily(family)) throw new FontFetchError('unknown font family');
  const meta = googleFont(family)!;
  const wanted = [...new Set(weights)].filter((w) => meta.weights.includes(w)).sort((a, b) => a - b);
  if (wanted.length === 0) throw new FontFetchError('no available weights requested');

  const id = familySlug(family);
  const { buffer: cssBuf } = await fetchGuarded(css2Url(meta.family, wanted), CSS_HOST, 'text/css,*/*', MAX_CSS_BYTES);
  const faces = parseFaces(cssBuf.toString('utf8'));

  const stored: number[] = [];
  for (const w of wanted) {
    if (await store.has(id, `${w}.woff2`)) {
      stored.push(w);
      continue;
    }
    // Prefer the `latin` subset; fall back to the first face offered for the weight.
    const face = faces.find((f) => f.weight === w && f.subset === 'latin') ?? faces.find((f) => f.weight === w);
    if (!face) continue;
    const { buffer } = await fetchGuarded(face.url, FONT_HOST, 'font/woff2,*/*', MAX_WOFF2_BYTES);
    await store.write(id, `${w}.woff2`, buffer);
    stored.push(w);
  }
  if (stored.length === 0) throw new FontFetchError('no font files could be downloaded');
  // Validate the record at download time rather than `as`-casting the catalog-derived values — a
  // catalog that ever emits an out-of-enum fallback fails HERE (clearly) instead of on a later PUT.
  const parsed = SelfHostedFontSchema.safeParse({
    id,
    family: meta.family,
    fallback: meta.fallback,
    source: 'google',
    files: stored.map((w) => ({ weight: w, style: 'normal', format: 'woff2', file: `${w}.woff2` })),
  });
  if (!parsed.success) throw new FontFetchError('downloaded font failed validation');
  return parsed.data;
}
