// Scoping a rendered page down to the part an agent actually wants to read.
//
// `preview_page includeHtml:true` handed back the WHOLE document — the inlined, compiled stylesheet
// alone is 25k+ tokens, so the response was truncated before it reached the markup the agent asked
// about. Two cuts make it usable: inline <style>/<script> BODIES are elided (the markup stays, a note
// says how much was dropped), and a CSS selector narrows the output to the matching elements.
//
// The selector support is a deliberate SUBSET — enough to address a region, not a CSS engine:
// a comma-separated list of compound selectors (`tag`, `#id`, `.class`, `[attr]`, `[attr="value"]`,
// combined like `section.hero[data-x]`), joined by descendant (space) or child (`>`) combinators.
// Parsing is htmlparser2 (linear); the selector is length-capped and parsed without backtracking.
import { parseDocument } from 'htmlparser2';
import { getOuterHTML } from 'domutils';
import type { AnyNode, Element } from 'domhandler';

/** Upper bound on matched elements returned. */
export const MAX_SCOPE_MATCHES = 20;
/** Upper bound on the scoped output, in characters. */
export const MAX_SCOPE_CHARS = 200_000;
const MAX_SELECTOR_LENGTH = 200;
const MAX_SELECTOR_STEPS = 12;

interface Compound {
  tag?: string;
  id?: string;
  classes: string[];
  attrs: Array<{ name: string; value?: string }>;
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

const IDENT = /^-?[A-Za-z_][\w-]*/;

/** Parse one compound selector (`div.a#b[x="y"]`), or throw a SelectorError naming what's unsupported. */
function parseCompound(text: string): Compound {
  const out: Compound = { classes: [], attrs: [] };
  let rest = text;
  const tag = /^(\*|[A-Za-z][\w-]*)/.exec(rest);
  if (tag) {
    if (tag[1] !== '*') out.tag = tag[1]!.toLowerCase();
    rest = rest.slice(tag[0].length);
  }
  while (rest.length > 0) {
    const sigil = rest[0];
    if (sigil === '#' || sigil === '.') {
      const name = IDENT.exec(rest.slice(1));
      if (!name) throw new SelectorError(`expected a name after "${sigil}" in "${text}"`);
      if (sigil === '#') out.id = name[0];
      else out.classes.push(name[0]);
      rest = rest.slice(1 + name[0].length);
      continue;
    }
    if (sigil === '[') {
      const m = /^\[\s*([A-Za-z_:][\w:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*)?\]/.exec(rest);
      if (!m) throw new SelectorError(`unsupported attribute selector in "${text}" — use [name] or [name="value"]`);
      out.attrs.push({ name: m[1]!.toLowerCase(), value: m[2] ?? m[3] ?? m[4] });
      rest = rest.slice(m[0].length);
      continue;
    }
    throw new SelectorError(`unsupported selector syntax "${rest}" in "${text}" — supported: tag, #id, .class, [attr], [attr="v"], descendant and ">" combinators`);
  }
  if (!out.tag && !out.id && out.classes.length === 0 && out.attrs.length === 0 && !text.startsWith('*')) {
    throw new SelectorError(`empty selector part in "${text}"`);
  }
  return out;
}

/** Parse a selector list into chains of steps. */
export function parseSelector(selector: string): Step[][] {
  if (selector.length > MAX_SELECTOR_LENGTH) throw new SelectorError(`selector is longer than ${MAX_SELECTOR_LENGTH} characters`);
  const chains: Step[][] = [];
  for (const part of selector.split(',')) {
    const tokens = part.replace(/\s*>\s*/g, ' > ').trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) throw new SelectorError('empty selector');
    const chain: Step[] = [];
    let pending: ' ' | '>' | undefined;
    for (const token of tokens) {
      if (token === '>') {
        if (chain.length === 0 || pending === '>') throw new SelectorError(`misplaced ">" in "${part.trim()}"`);
        pending = '>';
        continue;
      }
      chain.push({ compound: parseCompound(token), ...(chain.length > 0 ? { combinator: pending ?? ' ' } : {}) });
      pending = undefined;
    }
    if (pending) throw new SelectorError(`selector ends with ">" in "${part.trim()}"`);
    if (chain.length > MAX_SELECTOR_STEPS) throw new SelectorError(`selector has more than ${MAX_SELECTOR_STEPS} steps`);
    chains.push(chain);
  }
  return chains;
}

function isElement(node: AnyNode | null | undefined): node is Element {
  return !!node && (node.type === 'tag' || node.type === 'script' || node.type === 'style');
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
    if (a.value !== undefined && el.attribs[a.name] !== a.value) return false;
  }
  return true;
}

/**
 * Does `el` match the chain, read right-to-left from step `i`? Memoised per (element, step): a
 * descendant combinator tries every ancestor, so without it `div div div …` over a deep tree is
 * exponential. With it, each (element, step) pair is decided once.
 */
function matchesChain(el: Element, chain: readonly Step[], memo: Map<Element, Array<boolean | undefined>>, i = chain.length - 1): boolean {
  let row = memo.get(el);
  if (row?.[i] !== undefined) return row[i]!;
  const step = chain[i]!;
  let result = false;
  if (matchesCompound(el, step.compound)) {
    if (i === 0) result = true;
    else if (step.combinator === '>') result = isElement(el.parent) && matchesChain(el.parent, chain, memo, i - 1);
    else {
      for (let p = el.parent; isElement(p); p = p.parent) {
        if (matchesChain(p, chain, memo, i - 1)) {
          result = true;
          break;
        }
      }
    }
  }
  if (!row) memo.set(el, (row = []));
  row[i] = result;
  return result;
}

/** Replace inline <style>/<script> bodies with a short note, in place (the document is ours). */
function elideAssetBodies(nodes: readonly AnyNode[]): void {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (node.name === 'style' || node.name === 'script') {
      const text = node.children.map((c) => ('data' in c ? String(c.data) : '')).join('');
      if (text.trim().length > 0) {
        const kb = Math.max(1, Math.round(text.length / 1024));
        const note = node.name === 'style' ? `/* ${kb} KB of inline CSS omitted */` : `/* ${kb} KB of inline script omitted */`;
        const first = node.children[0];
        if (first && 'data' in first) {
          first.data = note;
          node.children = [first];
        }
      }
      continue;
    }
    elideAssetBodies(node.children);
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

/** Scope a rendered document for reading: assets elided, optionally narrowed to a selector. */
export function scopeHtml(html: string, opts: ScopeHtmlOptions = {}): ScopedHtml {
  const chains = opts.selector !== undefined ? parseSelector(opts.selector) : undefined;
  const doc = parseDocument(html);
  if (!opts.keepAssets) elideAssetBodies(doc.children);
  let out: string;
  let matches: number | undefined;
  let truncated = false;
  if (chains) {
    const found: Element[] = [];
    const memos = chains.map(() => new Map<Element, Array<boolean | undefined>>());
    const walk = (nodes: readonly AnyNode[]): void => {
      for (const node of nodes) {
        if (!isElement(node)) continue;
        if (chains.some((chain, n) => matchesChain(node, chain, memos[n]!))) {
          found.push(node);
          continue; // a match's own descendants are already inside its outerHTML
        }
        walk(node.children);
      }
    };
    walk(doc.children);
    matches = found.length;
    truncated = found.length > MAX_SCOPE_MATCHES;
    out = found
      .slice(0, MAX_SCOPE_MATCHES)
      .map((el) => getOuterHTML(el))
      .join('\n');
  } else {
    out = getOuterHTML(doc);
  }
  if (out.length > MAX_SCOPE_CHARS) {
    out = out.slice(0, MAX_SCOPE_CHARS);
    truncated = true;
  }
  return { html: out, ...(matches !== undefined ? { matches } : {}), truncated };
}
