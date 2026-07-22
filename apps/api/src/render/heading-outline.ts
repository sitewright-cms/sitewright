/**
 * Page heading-structure outline for the SEO audit. Parses the h1–h6 headings out of a page's built
 * static HTML — our OWN renderer's output, which is predictable, well-formed markup, so a scoped regex
 * is safe and keeps this module dependency-free (no HTML-parser dep in apps/api) — and flags the
 * structural problems search engines and screen-reader users care about: a missing or duplicated H1,
 * a page that doesn't start with its H1, skipped heading levels, and empty headings.
 *
 * Pure + framework-free → unit-tested directly. The route fetches the served HTML and calls these.
 */

/** One heading in the page outline. */
export interface HeadingNode {
  /** Heading level, 1 (H1) … 6 (H6). */
  level: number;
  /** Visible text — inner tags stripped, entities decoded, whitespace collapsed, capped. */
  text: string;
  /** A recommendation attached to THIS heading (a skipped level, or empty text), when one applies. */
  issue?: string;
}

/** The page's heading outline plus document-level recommendations. */
export interface HeadingOutline {
  /** Headings in document order (capped — see `truncated`). */
  headings: HeadingNode[];
  /** Document-level recommendations (missing / duplicate H1, no headings, wrong first level). */
  issues: string[];
  /** How many headings were dropped past the render cap, when the page had more. */
  truncated?: number;
}

/** How many headings the outline RENDERS; the rest are summarised as "…and N more". */
const MAX_HEADINGS = 60;
/** Hard scan cap: how many headings `extractHeadings` will parse at all — a memory guard against a
 *  pathological page, set well above any realistic heading count so the truncation remainder stays
 *  accurate (a page with 200 headings reports "…and 140 more", not "…and 1 more"). */
const SCAN_CAP = 500;
const MAX_HEADING_TEXT = 160;
/** Hard input bound: heading extraction only reads the first slice of a page's HTML. A page's headings
 *  are always near the top and few; this caps the linear scan's worst case regardless of body size (the
 *  audited HTML can be author-controlled raw markup via Code-editor mode, not just our own renderer's). */
const MAX_HTML_BYTES = 512 * 1024;
/** Regions whose inner text must never be read as headings (a `<h2>` inside a `<style>`/`<script>` string). */
const SKIP_TAGS = ['script', 'style', 'template', 'svg', 'noscript'] as const;

/** True when `s[i]` ends an HTML tag name (whitespace, '>', '/', or end-of-string) — so "<h1" and "<h1 "
 *  match a heading but "<h1x" / "<header" do not. */
function isNameBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === '>' || ch === '/' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

/** The named HTML entities that realistically show up in heading text (numeric entities handled generically). */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

/** Decode the handful of HTML entities that appear in real heading text. */
function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, code: string) => {
    if (code[0] === '#') {
      const cp = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff) {
        try {
          return String.fromCodePoint(cp);
        } catch {
          return whole;
        }
      }
      return whole;
    }
    const named = NAMED_ENTITIES[code];
    return named ?? whole;
  });
}

/** Reduce a heading's inner HTML to clean text: strip inner tags, decode entities, collapse whitespace, cap. */
function headingText(inner: string): string {
  // `<[^>]+>` is a negated-class match (linear, no catastrophic backtracking); the inner slice is bounded.
  const text = decodeEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return text.length > MAX_HEADING_TEXT ? `${text.slice(0, MAX_HEADING_TEXT - 1)}…` : text;
}

/**
 * Pull the h1–h6 headings out of a page's HTML, in document order, using a single LINEAR forward scan
 * (`indexOf`, no backtracking). This deliberately avoids a lazy-quantifier + backreference regex
 * (`<h1>[\s\S]*?</h1>` style): the audited HTML can be author-controlled raw markup (Code-editor mode),
 * and an unclosed `<h1>`/`<script>` makes such a regex O(n²) — enough to freeze the single-threaded event
 * loop. The scan skips comment/script/style/template/svg/noscript regions (a `<h2>` inside a CSS string
 * isn't a heading), reads at most {@link MAX_HTML_BYTES} of input, and collects up to {@link SCAN_CAP}
 * headings so the caller's truncation remainder stays accurate. Inner markup is stripped, entities
 * decoded, whitespace collapsed, text capped. The DISPLAY cap is applied by {@link analyzeHeadingOutline}.
 */
export function extractHeadings(htmlInput: string): Array<{ level: number; text: string }> {
  const html = htmlInput.length > MAX_HTML_BYTES ? htmlInput.slice(0, MAX_HTML_BYTES) : htmlInput;
  const lower = html.toLowerCase(); // case-insensitive tag matching via indexOf/startsWith
  const n = html.length;
  const out: Array<{ level: number; text: string }> = [];
  let i = 0;

  while (i < n && out.length < SCAN_CAP) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;

    // HTML comment → jump past `-->`.
    if (lower.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }

    // Skip-region open tag → jump past its matching close tag (`</tag …>`).
    let jumped = false;
    for (const tag of SKIP_TAGS) {
      if (lower.startsWith(tag, lt + 1) && isNameBoundary(lower[lt + 1 + tag.length])) {
        const close = lower.indexOf(`</${tag}`, lt + 1 + tag.length);
        const gt = close < 0 ? -1 : html.indexOf('>', close);
        i = gt < 0 ? n : gt + 1;
        jumped = true;
        break;
      }
    }
    if (jumped) continue;

    // Heading open tag `<h1`…`<h6`.
    const digit = lower[lt + 2];
    if (lower[lt + 1] === 'h' && digit !== undefined && digit >= '1' && digit <= '6' && isNameBoundary(lower[lt + 3])) {
      const openEnd = html.indexOf('>', lt + 3);
      if (openEnd < 0) break; // unterminated open tag → nothing more to read
      const level = Number(digit);
      if (html[openEnd - 1] === '/') {
        // Self-closing `<h2/>` — an empty heading; don't swallow the rest of the document.
        out.push({ level, text: '' });
        i = openEnd + 1;
        continue;
      }
      const close = lower.indexOf(`</h${level}`, openEnd + 1);
      const inner = close < 0 ? html.slice(openEnd + 1) : html.slice(openEnd + 1, close);
      out.push({ level, text: headingText(inner) });
      if (close < 0) break;
      const gt = html.indexOf('>', close);
      i = gt < 0 ? n : gt + 1;
      continue;
    }

    i = lt + 1; // some other `<…` — step over it
  }
  return out;
}

/**
 * Turn a document-order heading list into an outline with SEO/accessibility recommendations:
 * a missing or duplicated H1, a page that doesn't open with its H1, skipped levels, empty headings.
 * Immutable — builds fresh nodes, never mutates the input.
 */
export function analyzeHeadingOutline(raw: ReadonlyArray<{ level: number; text: string }>): HeadingOutline {
  const truncated = raw.length > MAX_HEADINGS ? raw.length - MAX_HEADINGS : 0;
  const trimmed = raw.slice(0, MAX_HEADINGS);

  const headings: HeadingNode[] = [];
  let prev = 0;
  for (const h of trimmed) {
    let issue: string | undefined;
    if (!h.text) {
      issue = 'Empty heading — give it descriptive text or remove it.';
    } else if (prev > 0 && h.level > prev + 1) {
      issue = `Skips from H${prev} to H${h.level} — don’t skip heading levels.`;
    }
    headings.push({ level: h.level, text: h.text, ...(issue ? { issue } : {}) });
    prev = h.level;
  }

  const issues: string[] = [];
  if (headings.length === 0) {
    issues.push('This page has no headings. Add an H1 and section headings so readers and search engines can follow its structure.');
    return { headings, issues, ...(truncated ? { truncated } : {}) };
  }

  const h1Count = headings.filter((h) => h.level === 1).length;
  if (h1Count === 0) {
    issues.push('No H1 heading. Add a single, descriptive H1 as the page’s main title.');
  } else if (h1Count > 1) {
    issues.push(`${h1Count} H1 headings. Use exactly one H1 per page — demote the extras to H2.`);
  }
  const firstLevel = headings[0]?.level ?? 1;
  if (firstLevel !== 1) {
    issues.push(`The first heading is an H${firstLevel}, not an H1. Start the page with its H1.`);
  }

  return { headings, issues, ...(truncated ? { truncated } : {}) };
}
