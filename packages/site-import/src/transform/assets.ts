// Collect every image-like reference across the captured pages and self-host them through the injected
// MediaPort, producing an `assetKey → hosted AssetRef` map the page/identity transforms rewrite against.
import { allByName, elements, type Document } from '../dom.js';
import { assetKey, pickFromSrcset } from '../url-util.js';
import type { CapturedAsset, CapturedSite, ImportDiagnostic, ImportLimits, ImportProgress, MediaPort } from '../types.js';

export interface ParsedDoc {
  url: string;
  doc: Document;
}

// JS lazy-loaders stash the REAL image URL in a data-* attribute and leave `src` as a placeholder
// (1×1 gif / blurred LQIP / blank). Since the importer strips the loader script, we must promote these
// to real `src`/`srcset` or the images vanish. Ordered by precedence (most common first).
const LAZY_SRC_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'data-echo', 'data-fallback-src'] as const;
const LAZY_SRCSET_ATTRS = ['data-srcset', 'data-lazy-srcset'] as const;
const LAZY_BG_ATTRS = ['data-bg', 'data-background', 'data-background-image'] as const;
/** All lazy-load attrs (for stripping after promotion). */
export const LAZY_ATTRS: readonly string[] = [...LAZY_SRC_ATTRS, ...LAZY_SRCSET_ATTRS, ...LAZY_BG_ATTRS];

const firstAttr = (attribs: Record<string, string>, names: readonly string[]): string | undefined => {
  for (const n of names) {
    const v = attribs[n]?.trim();
    if (v) return v;
  }
  return undefined;
};

/** The real image URL of an `<img>`/`<source>`: a lazy-load data-* attr wins over the placeholder `src`. */
export function effectiveSrc(attribs: Record<string, string>): string | undefined {
  return firstAttr(attribs, LAZY_SRC_ATTRS) ?? attribs.src?.trim();
}
/** The real `srcset`: a lazy-load data-* attr wins over the placeholder `srcset`. */
export function effectiveSrcset(attribs: Record<string, string>): string | undefined {
  return firstAttr(attribs, LAZY_SRCSET_ATTRS) ?? attribs.srcset?.trim();
}
/** A lazy-loaded BACKGROUND url stashed on a `data-bg`-style attr (no inline style yet). */
export function effectiveBg(attribs: Record<string, string>): string | undefined {
  return firstAttr(attribs, LAZY_BG_ATTRS);
}

/** Every image/icon URL referenced by the pages, keyed canonically; bytes pulled from the IR when present. */
export function collectImageRefs(docs: ParsedDoc[], site: CapturedSite): Map<string, CapturedAsset> {
  const refs = new Map<string, CapturedAsset>();
  const add = (raw: string | undefined, base: string): void => {
    if (!raw) return;
    // Inline data: URIs are self-contained — never collected/hosted (kept verbatim by the transform).
    if (raw.trim().toLowerCase().startsWith('data:')) return;
    const key = assetKey(raw, base);
    if (!key || refs.has(key)) return;
    const captured = site.assets.get(key);
    if (captured) refs.set(key, captured);
    else refs.set(key, { sourceRef: key, kind: 'image', remoteUrl: key });
  };

  for (const { url, doc } of docs) {
    for (const img of allByName(doc.children, 'img')) {
      // PREFER the srcset's largest variant; collect the plain `src` ONLY when there's no srcset. Collecting
      // both hosts the tiny placeholder `src` (a thumbnail) AND the full-size srcset image as two separate
      // assets — the double-capture that clutters imported/<folder> — and leaves the clone showing the low-res
      // one. The transform (page.ts) mirrors this: it promotes the largest srcset variant to `src`.
      const srcset = effectiveSrcset(img.attribs);
      if (srcset) add(pickFromSrcset(srcset), url);
      else add(effectiveSrc(img.attribs), url); // lazy-load data-src wins over a placeholder src
    }
    for (const source of allByName(doc.children, 'source')) {
      const srcset = effectiveSrcset(source.attribs);
      if (srcset) add(pickFromSrcset(srcset), url);
    }
    // Lazy-loaded backgrounds (data-bg on any element) → collected so the transform can inline them.
    for (const el of elements(doc.children)) {
      const bg = effectiveBg(el.attribs);
      if (bg) add(bg, url);
    }
    for (const video of allByName(doc.children, 'video')) add(video.attribs.poster, url);
    for (const el of allByName(doc.children, 'meta')) {
      if ((el.attribs.property ?? el.attribs.name ?? '').toLowerCase() === 'og:image') add(el.attribs.content, url);
    }
    for (const link of allByName(doc.children, 'link')) {
      if (/\bicon\b/i.test(link.attribs.rel ?? '')) add(link.attribs.href, url); // icon / shortcut icon / apple-touch-icon
    }
    for (const el of elements(doc.children)) {
      const style = el.attribs.style;
      if (style && /background(?:-image)?\s*:/i.test(style)) {
        for (const m of style.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) add(m[1], url);
      }
    }
  }
  return refs;
}

// Document downloads worth self-hosting so the imported site is self-contained (else a <a href="x.pdf">
// becomes a dead route or a hotlink to the source server). Stored download-only via the file-asset path.
const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|csv|rtf|odt|ods|odp|zip)(?:[?#]|$)/i;

/** Every same-or-cross-origin document reference — `<a href>` downloads AND `<iframe|embed src>` /
 *  `<object data>` EMBEDS (a PDF viewer in a modal) — keyed canonically (kind 'other'). Self-hosting the
 *  embed lets the transform keep the frame pointing at `/media` instead of dropping it as a non-allowlisted
 *  cross-origin iframe (the original's "Company Profile" modal is a lazy PDF `<iframe>`). */
export function collectDocumentRefs(docs: ParsedDoc[]): Map<string, CapturedAsset> {
  const refs = new Map<string, CapturedAsset>();
  const add = (raw: string | undefined, base: string): void => {
    const ref = raw?.trim();
    if (!ref || ref.toLowerCase().startsWith('data:') || !DOC_EXT.test(ref)) return;
    const key = assetKey(ref, base);
    if (!key || refs.has(key)) return;
    refs.set(key, { sourceRef: key, kind: 'other', remoteUrl: key });
  };
  for (const { url, doc } of docs) {
    for (const a of allByName(doc.children, 'a')) add(a.attribs.href, url);
    for (const f of allByName(doc.children, 'iframe')) add(f.attribs.src ?? f.attribs['data-src'], url); // lazy PDF embed
    for (const e of allByName(doc.children, 'embed')) add(e.attribs.src, url);
    for (const o of allByName(doc.children, 'object')) add(o.attribs.data, url);
  }
  return refs;
}

export interface HostResult {
  assetMap: Map<string, string>;
  /** assetKey → a responsive WebP `srcset` for the hosted image (only for image assets that have one). */
  srcsetMap: Map<string, string>;
  hosted: number;
  diagnostics: ImportDiagnostic[];
}

// Self-host this many assets at once. Each host is a network fetch + a sharp re-encode; ~8 in flight
// keeps the network busy without exhausting the libuv/sharp thread pool or container memory. (JS is
// single-threaded, so the shared Map/counter writes between awaits need no locking.)
const HOST_CONCURRENCY = 8;

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

/**
 * Host each collected image via the MediaPort, bounded by `maxImages` and run with bounded CONCURRENCY
 * (was strictly serial — the dominant cost of an import). Failures degrade gracefully to source links.
 */
export async function hostAssets(
  refs: Map<string, CapturedAsset>,
  media: MediaPort,
  limits: ImportLimits,
  onProgress?: (e: ImportProgress) => void,
): Promise<HostResult> {
  const assetMap = new Map<string, string>();
  const srcsetMap = new Map<string, string>();
  const diagnostics: ImportDiagnostic[] = [];
  let hosted = 0;
  // The maxImages budget caps how many we ATTEMPT (close enough); the overflow stays as source links.
  const entries = [...refs];
  const toHost = entries.slice(0, limits.maxImages);
  if (entries.length > toHost.length) {
    diagnostics.push({ code: 'image-budget-exceeded', message: `image limit (${limits.maxImages}) reached; ${entries.length - toHost.length} remaining image(s) left as source links` });
  }
  const total = toHost.length;
  let done = 0;

  await runPool(toHost, HOST_CONCURRENCY, async ([key, asset]) => {
    try {
      const result = await media.hostAsset(asset);
      if (result) {
        assetMap.set(key, result.ref);
        if (result.srcset) srcsetMap.set(key, result.srcset);
        hosted += 1;
      } else {
        diagnostics.push({ code: 'image-host-failed', message: `could not self-host ${key}` });
      }
    } catch {
      diagnostics.push({ code: 'image-host-failed', message: `error self-hosting ${key}` });
    }
    done += 1;
    const fname = (key.split(/[/?#]/).filter(Boolean).pop() || key).slice(0, 48);
    onProgress?.({ phase: 'host-media', done, total, detail: fname });
  });
  return { assetMap, srcsetMap, hosted, diagnostics };
}
