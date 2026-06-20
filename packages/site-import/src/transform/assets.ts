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
      add(effectiveSrc(img.attribs), url); // lazy-load data-src wins over a placeholder src
      const srcset = effectiveSrcset(img.attribs);
      if (srcset) add(pickFromSrcset(srcset), url);
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

export interface HostResult {
  assetMap: Map<string, string>;
  hosted: number;
  diagnostics: ImportDiagnostic[];
}

/** Host each collected image via the MediaPort, bounded by `maxImages`. Failures degrade gracefully. */
export async function hostAssets(
  refs: Map<string, CapturedAsset>,
  media: MediaPort,
  limits: ImportLimits,
  onProgress?: (e: ImportProgress) => void,
): Promise<HostResult> {
  const assetMap = new Map<string, string>();
  const diagnostics: ImportDiagnostic[] = [];
  let hosted = 0;
  let budgetWarned = false;
  const total = refs.size;
  let done = 0;

  for (const [key, asset] of refs) {
    done += 1;
    if (hosted >= limits.maxImages) {
      if (!budgetWarned) {
        diagnostics.push({ code: 'image-budget-exceeded', message: `image limit (${limits.maxImages}) reached; remaining images left as source links` });
        budgetWarned = true;
      }
      continue;
    }
    try {
      const result = await media.hostAsset(asset);
      if (result) {
        assetMap.set(key, result.ref);
        hosted += 1;
      } else {
        diagnostics.push({ code: 'image-host-failed', message: `could not self-host ${key}` });
      }
    } catch {
      diagnostics.push({ code: 'image-host-failed', message: `error self-hosting ${key}` });
    }
    onProgress?.({ phase: 'host-media', done, total });
  }
  return { assetMap, hosted, diagnostics };
}
