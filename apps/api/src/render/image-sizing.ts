/**
 * Oversized-image check for the page audit — the one image defect Lighthouse structurally cannot see.
 *
 * ★ WHY THIS EXISTS AT ALL. Lighthouse's image-sizing audits work from its `ImageElements` artifact,
 * which is collected from `<img>`/`<picture>` boxes. A CSS `background-image` has no such element, so
 * an oversized background is invisible to it. MEASURED against a real page whose six backgrounds were
 * delivered at 2400px to paint 550px cards — 12-19x more pixels than displayed, 257ms of main-thread
 * decode and NINE dropped frames on the first scroll: Lighthouse 13 scored `image-delivery-insight`
 * a perfect 1 with an EMPTY item list, and overall performance 90. Nothing in the report named a
 * single background. The page still stuttered.
 *
 * ★ WHY IT PRESENTS AS AN ANIMATION BUG. Decode cost scales with PIXELS, not bytes, and an element
 * that is revealed on scroll is not painted until it is revealed — so the decode lands in the same
 * frame as the reveal animation. The author sees "the animation is janky", and it disappears on a
 * second pass once the decode cache is warm, which is exactly what makes it get dismissed.
 *
 * The platform can see what Lighthouse cannot, because it named the file: the published asset carries
 * its delivery rung in its own filename (`…-md.webp`), so the delivered width is readable from the
 * built HTML with no browser, no artifact and no media lookup.
 *
 * Pure + dependency-free → unit-tested directly. Like `heading-outline.ts` this parses page HTML that
 * can be AUTHOR-CONTROLLED (Code-editor raw markup), so every scan here is linear: character-class
 * regexes only (`[^)'"]`, `[^>]`), never a lazy quantifier or a backreference across the document.
 * See the ReDoS lesson in heading-outline.ts — the same rule applies.
 */
import { SIZE_TOKENS, THUMB_SIZES, DEFAULT_SIZE, type SizeToken } from '@sitewright/image-pipeline';

/** How a page refers to an image — which decides what the author can do about its size. */
export type ImageRefKind =
  /** A CSS background (`background-image:url(…)` or the lazy `data-bg`). Cannot carry a srcset at all. */
  | 'background'
  /** An `<img>` with no `srcset` — one fixed rung for every viewport and every display density. */
  | 'img';

/** One oversized reference the page should change. */
export interface ImageSizingFinding {
  /** The published asset filename, e.g. `UiMkSY-pexels-34338597-xl.webp`. */
  file: string;
  /** How the page refers to it. */
  via: ImageRefKind;
  /** The delivery rung the filename resolves to. */
  size: SizeToken;
  /**
   * That rung's width in CSS px — the CEILING, not necessarily the delivered width: the server never
   * upscales, so a rung clamps to the source. A 800px-wide logo asked for at `xl` is delivered at
   * 800px. Phrase anything user-facing as "up to", and see `bytes` for what was actually shipped.
   */
  rungWidth: number;
  /** The published file's real transfer size, when the caller could supply it. */
  bytes?: number;
  /** How many times this page refers to it at this rung. */
  count: number;
  /** What to do about it, phrased for whoever is reading the audit. */
  recommendation: string;
}

/** The page's image-sizing report. */
export interface ImageSizingReport {
  /** Oversized references, worst (most-referenced, then widest) first. */
  findings: ImageSizingFinding[];
  /** How many image references were examined. */
  scanned: number;
  /** How many were already fine — a smaller rung, or an `<img>` carrying a `srcset`. */
  ok: number;
  /** Findings beyond the render cap, when there were more. */
  truncated?: number;
}

/** How many findings to RENDER; the rest are summarised as "…and N more". */
const MAX_FINDINGS = 12;
/**
 * Hard input bound, mirroring heading-outline.ts: the audited HTML may be author-controlled raw
 * markup, so cap the linear scan regardless of body size. Image references are spread through a page
 * rather than clustered at the top, so this is deliberately larger than the heading cap.
 */
const MAX_SCAN_BYTES = 1024 * 1024;

/** The largest delivery rung — the one a url with no explicit `?size=` resolves to. */
const LARGEST: SizeToken = DEFAULT_SIZE;

/**
 * Reads the delivery rung out of a PUBLISHED asset filename (`…-md.webp` → `md`). Publish materialises
 * every thumbnail as `<stem>-<size>.<format>` (`thumbFileName` in @sitewright/image-pipeline), so the
 * rung is in the name and no media lookup is needed. Returns undefined for an original/SVG/non-asset,
 * which is correctly NOT a sizing finding: an SVG scales natively and an original was asked for
 * explicitly with `?size=original`.
 */
export function rungOf(file: string): SizeToken | undefined {
  const dot = file.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const stem = file.slice(0, dot);
  const dash = stem.lastIndexOf('-');
  if (dash <= 0) return undefined;
  const token = stem.slice(dash + 1);
  return (SIZE_TOKENS as readonly string[]).includes(token) ? (token as SizeToken) : undefined;
}

/** The filename from a url, minus any query/fragment. `../_assets/a-b-xl.webp?v=1` → `a-b-xl.webp`. */
function fileOf(url: string): string {
  const clean = url.split(/[?#]/, 1)[0] ?? '';
  const slash = clean.lastIndexOf('/');
  return slash >= 0 ? clean.slice(slash + 1) : clean;
}

/** A reference found in the HTML, before it is judged. */
interface Ref {
  file: string;
  via: ImageRefKind;
  /** True when the reference can already adapt (an `<img>` with a srcset) — counted as ok, never flagged. */
  responsive: boolean;
}

// Linear-safe by construction: every class excludes its own terminator, so none can backtrack.
const URL_IN_CSS = /url\(\s*['"]?([^)'"\s]+)/gi; // background-image:url('…'), and any other css url()
const DATA_BG = /data-bg=["']([^"']+)["']/gi; // the platform's lazy background
const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_ATTR = /\bsrc=["']([^"']+)["']/i;
const DATA_SRC_ATTR = /\bdata-src=["']([^"']+)["']/i;
const HAS_SRCSET = /\b(?:srcset|data-srcset)=/i;

/**
 * Collect every image reference in a page's built HTML, tagged with how it is referenced. Exported so
 * the analysis and the scan can be tested apart, mirroring extractHeadings/analyzeHeadingOutline.
 */
export function extractImageRefs(html: string): Ref[] {
  const scan = html.length > MAX_SCAN_BYTES ? html.slice(0, MAX_SCAN_BYTES) : html;
  const refs: Ref[] = [];

  // <img> — a srcset (however it got there) means the browser can already pick a rung.
  IMG_TAG.lastIndex = 0;
  for (let m = IMG_TAG.exec(scan); m; m = IMG_TAG.exec(scan)) {
    const tag = m[0];
    const url = SRC_ATTR.exec(tag)?.[1] ?? DATA_SRC_ATTR.exec(tag)?.[1];
    if (!url) continue;
    refs.push({ file: fileOf(url), via: 'img', responsive: HAS_SRCSET.test(tag) });
  }

  // CSS backgrounds — inline style, <style> blocks and the lazy data-bg. None can carry a srcset.
  for (const re of [URL_IN_CSS, DATA_BG]) {
    re.lastIndex = 0;
    for (let m = re.exec(scan); m; m = re.exec(scan)) {
      const url = m[1];
      if (!url || url.startsWith('data:')) continue; // an inline LQIP is not a delivered asset
      refs.push({ file: fileOf(url), via: 'background', responsive: false });
    }
  }
  return refs;
}

/**
 * Judge the references: flag the ones delivered at the LARGEST rung through a path that cannot adapt.
 *
 * ★ Deliberately narrow. The largest rung is what a url with no `?size=` resolves to — so flagging it
 * is flagging the DEFAULT NOBODY CHOSE, not second-guessing a considered decision. A smaller rung is
 * always left alone (someone picked it), and an `<img>` with a srcset is left alone (the browser picks
 * per viewport). That keeps this from crying wolf on a page that did the work.
 *
 * It still cannot know the painted box without a browser, so it never claims a waste ratio — it
 * reports the delivered width and says what to do. A genuine full-bleed hero may legitimately want the
 * largest rung, and the recommendation says so rather than pretending otherwise.
 */
export function analyzeImageSizing(
  refs: readonly Ref[],
  /**
   * Optional: the published file's transfer size, which the caller can read from the built directory
   * it just served. With it the report is ordered by REAL cost instead of a rung label — the only way
   * to tell a 1.2MB photo from a 17KB logo that share the same `xl` suffix.
   */
  bytesOf?: (file: string) => number | undefined,
): ImageSizingReport {
  const byKey = new Map<string, ImageSizingFinding>();
  let ok = 0;

  for (const ref of refs) {
    const size = rungOf(ref.file);
    // No rung in the name → an original, an SVG, or a non-platform url. Not a sizing finding.
    if (!size) continue;
    if (ref.responsive || size !== LARGEST) {
      ok += 1;
      continue;
    }
    const bytes = bytesOf?.(ref.file);
    const key = `${ref.file}|${ref.via}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byKey.set(key, {
      file: ref.file,
      via: ref.via,
      size,
      rungWidth: THUMB_SIZES[size],
      ...(bytes !== undefined ? { bytes } : {}),
      count: 1,
      recommendation:
        ref.via === 'background'
          ? `Served at the largest rung (up to ${THUMB_SIZES[size]}px wide) because the url carries no \`?size=\` — that is the default, not a choice. A background cannot use a srcset, so size it yourself: \`?size=md\` for a card or column, \`?size=lg\` for a full-width band. Leave it only if this really is a full-bleed hero.`
          : `Served at the largest rung (up to ${THUMB_SIZES[size]}px wide) with no srcset, so every viewport and pixel density gets the same file. Render it with the responsive image helper — it emits the srcset, width/height and decoding="async" — or append an explicit \`?size=\`.`,
    });
  }

  // Worst first: real bytes when known (a 1.2MB photo before a 17KB logo), else how often the page
  // repeats it, then the rung. Without bytes the order is a proxy, so it must not pretend otherwise.
  const all = [...byKey.values()].sort(
    (a, b) => (b.bytes ?? 0) - (a.bytes ?? 0) || b.count - a.count || b.rungWidth - a.rungWidth || a.file.localeCompare(b.file),
  );
  const findings = all.slice(0, MAX_FINDINGS);
  return {
    findings,
    scanned: refs.length,
    ok,
    ...(all.length > findings.length ? { truncated: all.length - findings.length } : {}),
  };
}
