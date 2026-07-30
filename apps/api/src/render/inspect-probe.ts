// @ts-nocheck
/* v8 ignore start -- INSPECT_EXTRACT is browser code, run via page.evaluate in Chromium (not under node coverage) */
// The in-page extract behind `inspect_source` — READ the live original the way a developer would with
// devtools: settled markup + real computed styles + real rects, for the selectors the agent asks about.
//
// Why this exists: every other fidelity tool (visual_audit, compare_regions, compare_to_source,
// fidelity_check, clone_audit) returns an IMAGE or a comparison SCORE, and each needs a built clone to
// compare against. None of them can answer "what IS the original's nav link padding" — yet the import
// guide repeatedly instructs the agent to MEASURE the original and reproduce those numbers. Without this
// the only way to get a number was to stand up a parallel headless browser outside the platform.
//
// It also solves the JS-built-chrome blind spot: an importer stores the PRE-JS body, so a site that
// builds its header/footer in JavaScript hands the agent a source with no chrome markup at all. This runs
// after the shared settle, so what it returns is what the visitor actually sees.
//
// Runs as a single `page.evaluate` in the SSRF-pinned render context (see compare.ts). Serialisable in,
// serialisable out — no imports, no closures over server state.

/** A curated computed-style set: the properties a faithful port actually has to match. */
export const INSPECT_DEFAULT_STYLES = [
  'display',
  'position',
  'width',
  'height',
  'margin',
  'padding',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'text-decoration-line',
  'color',
  'background-color',
  'background-image',
  'background-size',
  'background-position',
  'background-attachment',
  'border',
  'border-radius',
  'box-shadow',
  'opacity',
  'transform',
  'flex-direction',
  'justify-content',
  'align-items',
  'gap',
  'z-index',
] as const;

/** Hard caps so one call can never return an unbounded payload (or hang the render slot). */
export const INSPECT_LIMITS = {
  maxSelectors: 20,
  maxStyles: 40,
  maxNodesPerSelector: 8,
  maxHtmlChars: 4000,
  maxTextChars: 400,
} as const;

/** One matched element, as reported to the agent. */
export interface InspectNode {
  tag: string;
  id?: string;
  classes?: string;
  /** Layout box in CSS px, viewport-relative for x/y (page-relative via `pageY`). */
  rect: { x: number; y: number; width: number; height: number; pageY: number };
  /** Requested computed styles, property → value. Shorthands are reported as the browser resolves them. */
  styles: Record<string, string>;
  /** Visible text, collapsed + truncated. */
  text?: string;
  /** Settled outerHTML with <script>/<style> bodies removed, truncated. Only when `html` was requested. */
  html?: string;
  /** ::before / ::after content + the styles that make a pseudo-element visible, when one is generated. */
  pseudo?: { before?: Record<string, string>; after?: Record<string, string> };
}

export interface InspectSelectorResult {
  selector: string;
  /** Total matches in the document (may exceed `nodes.length`, which is capped). */
  count: number;
  nodes: InspectNode[];
}

export interface InspectResult {
  title: string;
  /** The viewport the measurements were taken at — every number below is only true AT this width. */
  viewport: { width: number; height: number };
  /** Full document height after settle, so the agent can reason about page-length differences. */
  documentHeight: number;
  results: InspectSelectorResult[];
}

/**
 * The browser-side function. Args are passed as ONE object (Playwright's single-argument evaluate).
 *
 * Pseudo-elements are included because they are invisible to every other tool and routinely carry real
 * design: a rotated ::before label, a gradient underline, a counter. An agent that can't see them
 * reproduces a page with the decoration missing and no measurement disagrees.
 */
export const INSPECT_EXTRACT = (args: {
  selectors: string[];
  styles: string[];
  html: boolean;
  limits: { maxNodesPerSelector: number; maxHtmlChars: number; maxTextChars: number };
}): InspectResult => {
  const { selectors, styles, html, limits } = args;
  const doc = document;
  const win = window;

  const clean = (s: string, max: number): string => {
    const collapsed = s.replace(/\s+/g, ' ').trim();
    return collapsed.length > max ? `${collapsed.slice(0, max)}…[truncated]` : collapsed;
  };

  const stripCode = (s: string): string =>
    s.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '<script></script>').replace(/<style\b[\s\S]*?<\/style\s*>/gi, '<style></style>');

  const styleMap = (cs: CSSStyleDeclaration): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const prop of styles) {
      const v = cs.getPropertyValue(prop);
      if (v) out[prop] = v;
    }
    return out;
  };

  // A pseudo-element is only worth reporting when it actually generates a box.
  const pseudoOf = (el: Element, which: '::before' | '::after'): Record<string, string> | undefined => {
    const cs = win.getComputedStyle(el, which);
    const content = cs.getPropertyValue('content');
    if (!content || content === 'none' || content === 'normal') return undefined;
    const out = styleMap(cs);
    out.content = content;
    return out;
  };

  const results: InspectSelectorResult[] = [];
  for (const selector of selectors) {
    let matches: Element[] = [];
    let count = 0;
    try {
      const all = doc.querySelectorAll(selector);
      count = all.length;
      matches = Array.prototype.slice.call(all, 0, limits.maxNodesPerSelector) as Element[];
    } catch {
      // An invalid selector is the agent's typo — report it as zero matches rather than failing the call.
      results.push({ selector, count: -1, nodes: [] });
      continue;
    }
    const nodes: InspectNode[] = matches.map((el) => {
      const r = el.getBoundingClientRect();
      const cs = win.getComputedStyle(el);
      const node: InspectNode = {
        tag: el.tagName.toLowerCase(),
        rect: {
          x: Math.round(r.x * 10) / 10,
          y: Math.round(r.y * 10) / 10,
          width: Math.round(r.width * 10) / 10,
          height: Math.round(r.height * 10) / 10,
          pageY: Math.round((r.y + win.scrollY) * 10) / 10,
        },
        styles: styleMap(cs),
      };
      if (el.id) node.id = el.id;
      const cls = typeof el.className === 'string' ? el.className : '';
      if (cls.trim()) node.classes = clean(cls, 200);
      const text = clean(el.textContent || '', limits.maxTextChars);
      if (text) node.text = text;
      if (html) node.html = clean(stripCode(el.outerHTML), limits.maxHtmlChars);
      const before = pseudoOf(el, '::before');
      const after = pseudoOf(el, '::after');
      if (before || after) node.pseudo = { ...(before ? { before } : {}), ...(after ? { after } : {}) };
      return node;
    });
    results.push({ selector, count, nodes });
  }

  return {
    title: doc.title,
    viewport: { width: win.innerWidth, height: win.innerHeight },
    documentHeight: doc.documentElement.scrollHeight,
    results,
  };
};
