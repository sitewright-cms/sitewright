// Scoping a rendered page down to the part an agent actually wants to read.
//
// `preview_page includeHtml:true` handed back the WHOLE document — the inlined, compiled stylesheet
// alone is 25k+ tokens, so the response was truncated before it reached the markup the agent asked
// about. Two cuts make it usable: inline <style>/<script> BODIES are elided (the markup stays, a note
// says how much was dropped; JSON data islands are kept up to a size), and a CSS selector narrows the
// output to the matching elements.
//
// The selector support is a deliberate SUBSET — enough to address a region, not a CSS engine: a
// comma-separated list of compound selectors (`tag`, `#id`, `.class`, `[attr]`, `[attr="v"]`,
// `[attr~="v"]`, `^=`, `$=`, `*=`), joined by descendant (space) or child (`>`) combinators. A class
// with a `:` or `/` in it (Tailwind's `md:flex`, `w-1/2`) is written escaped, `.md\:flex`, or as
// `[class~="md:flex"]`. The tokenizer is quote-aware and the matcher is ONE linear pass over the tree
// (no per-element ancestor walks), iterative, so a deep or hostile document can't stall it.
import { parseDocument } from 'htmlparser2';
import { getOuterHTML } from 'domutils';
import type { AnyNode, Element } from 'domhandler';

/** Upper bound on matched elements returned. */
export const MAX_SCOPE_MATCHES = 20;
/** Upper bound on the scoped output, in characters. */
export const MAX_SCOPE_CHARS = 200_000;
/** JSON data islands (`<script type="application/json">`, ld+json) up to this size are kept. */
const MAX_KEPT_JSON = 8 * 1024;
const MAX_SELECTOR_LENGTH = 200;
const MAX_SELECTOR_STEPS = 12;

type AttrOp = '=' | '~=' | '^=' | '$=' | '*=';
interface Compound {
  tag?: string;
  id?: string;
  classes: string[];
  attrs: Array<{ name: string; op?: AttrOp; value?: string }>;
}
interface Step {
  compound: Compound;
  /** How this step relates to the PREVIOUS one; the first step has none. */
  combinator?: ' ' | '>';
}

export class SelectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelectorError';
  }
}

const UNSUPPORTED =
  'supported: tag, #id, .class (escape ":" and "/" as \\: \\/), [attr], [attr="v"], [attr~="v"], ^= $= *=, descendant and ">" combinators, "," lists';

/** A cursor over the selector text — every read is bounded by its length, no regex backtracking. */
class Cursor {
  i = 0;
  constructor(readonly s: string) {}
  get done(): boolean {
    return this.i >= this.s.length;
  }
  peek(): string {
    return this.s[this.i] ?? '';
  }
  skipSpace(): boolean {
    const start = this.i;
    while (!this.done && /\s/.test(this.peek())) this.i += 1;
    return this.i > start;
  }
  /** An identifier: [\w-] characters and `\`-escaped characters (`md\:flex` → `md:flex`). */
  ident(): string {
    let out = '';
    while (!this.done) {
      const ch = this.peek();
      if (ch === '\\' && this.i + 1 < this.s.length) {
        out += this.s[this.i + 1];
        this.i += 2;
      } else if (/[\w-]/.test(ch)) {
        out += ch;
        this.i += 1;
      } else break;
    }
    return out;
  }
  /** A quoted string (either quote) or a bare word up to `]`. */
  value(): string {
    const q = this.peek();
    if (q === '"' || q === "'") {
      this.i += 1;
      let out = '';
      while (!this.done && this.peek() !== q) {
        if (this.peek() === '\\' && this.i + 1 < this.s.length) this.i += 1;
        out += this.peek();
        this.i += 1;
      }
      if (this.done) throw new SelectorError(`unterminated quote in "${this.s}"`);
      this.i += 1;
      return out;
    }
    let out = '';
    while (!this.done && !/[\]\s]/.test(this.peek())) {
      out += this.peek();
      this.i += 1;
    }
    return out;
  }
}

/** Parse one compound selector at the cursor; empty → null. */
function compoundAt(c: Cursor): Compound | null {
  const out: Compound = { classes: [], attrs: [] };
  let any = false;
  if (c.peek() === '*') {
    c.i += 1;
    any = true;
  } else if (/[A-Za-z]/.test(c.peek())) {
    out.tag = c.ident().toLowerCase();
    any = true;
  }
  for (;;) {
    const ch = c.peek();
    if (ch === '#' || ch === '.') {
      c.i += 1;
      const name = c.ident();
      if (!name) throw new SelectorError(`expected a name after "${ch}" in "${c.s}"`);
      if (ch === '#') out.id = name;
      else out.classes.push(name);
      any = true;
    } else if (ch === '[') {
      c.i += 1;
      c.skipSpace();
      const name = c.ident().toLowerCase();
      if (!name) throw new SelectorError(`expected an attribute name in "${c.s}"`);
      c.skipSpace();
      let op: AttrOp | undefined;
      let value: string | undefined;
      for (const candidate of ['~=', '^=', '$=', '*=', '='] as const) {
        if (c.s.startsWith(candidate, c.i)) {
          op = candidate;
          c.i += candidate.length;
          break;
        }
      }
      if (op) {
        c.skipSpace();
        value = c.value();
        c.skipSpace();
      }
      if (c.peek() !== ']') throw new SelectorError(`unsupported attribute selector in "${c.s}" — ${UNSUPPORTED}`);
      c.i += 1;
      out.attrs.push({ name, ...(op ? { op, value } : {}) });
      any = true;
    } else break;
  }
  return any ? out : null;
}

/** Parse a selector list into chains of steps. */
export function parseSelector(selector: string): Step[][] {
  if (selector.length > MAX_SELECTOR_LENGTH) throw new SelectorError(`selector is longer than ${MAX_SELECTOR_LENGTH} characters`);
  const c = new Cursor(selector.trim());
  const chains: Step[][] = [];
  let chain: Step[] = [];
  let pending: ' ' | '>' | undefined;
  while (!c.done) {
    const spaced = c.skipSpace();
    if (c.done) break;
    const ch = c.peek();
    if (ch === ',') {
      if (chain.length === 0 || pending === '>') throw new SelectorError(`empty selector part in "${selector}"`);
      chains.push(chain);
      chain = [];
      pending = undefined;
      c.i += 1;
      continue;
    }
    if (ch === '>') {
      if (chain.length === 0 || pending === '>') throw new SelectorError(`misplaced ">" in "${selector}"`);
      pending = '>';
      c.i += 1;
      continue;
    }
    const compound = compoundAt(c);
    if (!compound) throw new SelectorError(`unsupported selector syntax at "${selector.slice(c.i)}" — ${UNSUPPORTED}`);
    if (chain.length > 0) {
      if (!pending && !spaced) throw new SelectorError(`unsupported selector syntax at "${selector.slice(c.i)}" — ${UNSUPPORTED}`);
      chain.push({ compound, combinator: pending ?? ' ' });
    } else {
      chain.push({ compound });
    }
    if (chain.length > MAX_SELECTOR_STEPS) throw new SelectorError(`selector has more than ${MAX_SELECTOR_STEPS} steps`);
    pending = undefined;
  }
  if (pending) throw new SelectorError(`selector ends with "${pending}" in "${selector}"`);
  if (chain.length === 0) throw new SelectorError('empty selector');
  chains.push(chain);
  return chains;
}

function isElement(node: AnyNode | null | undefined): node is Element {
  return !!node && (node.type === 'tag' || node.type === 'script' || node.type === 'style');
}

function attrMatches(actual: string, op: AttrOp, value: string): boolean {
  switch (op) {
    case '=':
      return actual === value;
    case '~=':
      return actual.split(/\s+/).includes(value);
    case '^=':
      return value !== '' && actual.startsWith(value);
    case '$=':
      return value !== '' && actual.endsWith(value);
    case '*=':
      return value !== '' && actual.includes(value);
  }
}

function matchesCompound(el: Element, c: Compound): boolean {
  if (c.tag && el.name.toLowerCase() !== c.tag) return false;
  if (c.id && el.attribs.id !== c.id) return false;
  if (c.classes.length > 0) {
    const have = new Set((el.attribs.class ?? '').split(/\s+/).filter(Boolean));
    if (!c.classes.every((cls) => have.has(cls))) return false;
  }
  for (const a of c.attrs) {
    if (!Object.prototype.hasOwnProperty.call(el.attribs, a.name)) return false;
    // eslint-disable-next-line security/detect-object-injection -- own attribute, checked above
    if (a.op && !attrMatches(el.attribs[a.name] ?? '', a.op, a.value ?? '')) return false;
  }
  return true;
}

/** Per-element, per-chain state: does it match the chain up to step i (`m`), or does it or an ancestor (`a`)? */
interface ChainState {
  m: boolean[];
  a: boolean[];
}

/**
 * Every OUTERMOST element matching any chain, in document order. One iterative pre-order pass: an
 * element's state is computed from its parent's, so a descendant combinator is an O(1) look at the
 * parent's "some ancestor matched step i−1" flag rather than a walk up the tree.
 */
function findMatches(roots: readonly AnyNode[], chains: readonly Step[][]): Element[] {
  const found: Element[] = [];
  const state = new Map<Element, { chains: ChainState[]; inMatch: boolean }>();
  const stack: AnyNode[] = [...roots].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!isElement(node)) continue;
    const parent = isElement(node.parent) ? state.get(node.parent) : undefined;
    const perChain = chains.map((chain, n) => {
      const up = parent?.chains[n];
      const m: boolean[] = [];
      const a: boolean[] = [];
      for (let i = 0; i < chain.length; i += 1) {
        const step = chain[i]!;
        const linked = i === 0 || (step.combinator === '>' ? up?.m[i - 1] === true : up?.a[i - 1] === true);
        m[i] = linked && matchesCompound(node, step.compound);
        a[i] = m[i]! || up?.a[i] === true;
      }
      return { m, a };
    });
    const matched = chains.some((chain, n) => perChain[n]!.m[chain.length - 1]);
    const inMatch = parent?.inMatch === true;
    if (matched && !inMatch) found.push(node);
    state.set(node, { chains: perChain, inMatch: inMatch || matched });
    for (let k = node.children.length - 1; k >= 0; k -= 1) stack.push(node.children[k]!);
  }
  return found;
}

/** Replace inline <style>/<script> bodies with a short note, in place (the document is ours). */
function elideAssetBodies(roots: readonly AnyNode[]): void {
  const stack: AnyNode[] = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!isElement(node)) continue;
    if (node.name !== 'style' && node.name !== 'script') {
      stack.push(...node.children);
      continue;
    }
    const text = node.children.map((c) => ('data' in c ? String(c.data) : '')).join('');
    if (text.trim().length === 0) continue;
    // A JSON data island (page data, structured data) is CONTENT an agent may need to check — keep it
    // when it is small; a stylesheet or a runtime never is.
    if (node.name === 'script' && /json/i.test(node.attribs.type ?? '') && text.length <= MAX_KEPT_JSON) continue;
    const kb = Math.max(1, Math.round(text.length / 1024));
    const what = node.name === 'style' ? 'inline CSS' : /json/i.test(node.attribs.type ?? '') ? 'JSON data' : 'inline script';
    const first = node.children[0];
    if (first && 'data' in first) {
      first.data = `/* ${kb} KB of ${what} omitted */`;
      node.children = [first];
    }
  }
}

export interface ScopeHtmlOptions {
  /** Return only the elements matching this (subset) CSS selector. */
  selector?: string;
  /** Keep inline <style>/<script> bodies (default: elided). */
  keepAssets?: boolean;
}

export interface ScopedHtml {
  html: string;
  /** Elements the selector matched (absent without a selector). */
  matches?: number;
  /** True when matches or characters were cut at the caps. */
  truncated: boolean;
}

/** Serialize, or say why not — dom-serializer recurses, so a pathologically deep tree can't be printed. */
function serialize(node: AnyNode | AnyNode[]): string {
  try {
    return getOuterHTML(node);
  } catch (err) {
    if (err instanceof RangeError) return '<!-- this part of the document is nested too deeply to print -->';
    throw err;
  }
}

/** Scope a rendered document for reading: assets elided, optionally narrowed to a selector. */
export function scopeHtml(html: string, opts: ScopeHtmlOptions = {}): ScopedHtml {
  const chains = opts.selector !== undefined ? parseSelector(opts.selector) : undefined;
  const doc = parseDocument(html);
  if (!opts.keepAssets) elideAssetBodies(doc.children);
  let out: string;
  let matches: number | undefined;
  let truncated = false;
  if (chains) {
    const found = findMatches(doc.children, chains);
    matches = found.length;
    truncated = found.length > MAX_SCOPE_MATCHES;
    out = found
      .slice(0, MAX_SCOPE_MATCHES)
      .map((el) => serialize(el))
      .join('\n');
  } else {
    out = serialize(doc.children);
  }
  if (out.length > MAX_SCOPE_CHARS) {
    // May end mid-tag; the caller's note says the output was cut.
    out = out.slice(0, MAX_SCOPE_CHARS);
    truncated = true;
  }
  return { html: out, ...(matches !== undefined ? { matches } : {}), truncated };
}
