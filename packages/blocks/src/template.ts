// Sitewright's code-first template engine: a small, logic-LIGHT, NO-EVAL renderer for
// developer-authored HTML + Tailwind templates with `{{ bindings }}`, `{{#if}}`,
// `{{#each}}`, `{{> partial}}`, and `{{! comments }}`.
//
// Security model — the TEMPLATE is authored by a (trusted) developer, but the VALUES
// bound in (datasets, page/company content) are UNTRUSTED. So:
//   - There is NO code execution: no `eval`, no `new Function`, no expression language.
//     Tags are tokenized by a linear scan, parsed to a fixed AST, and evaluated by pure
//     data lookups. A value is never fed back into the tokenizer (no template injection).
//   - Interpolation is CONTEXT-AWARE. While tokenizing we track the HTML context of each
//     `{{ }}` and escape accordingly:
//       · element body / quoted non-URL attribute → attribute-safe escape (`& < > " '`),
//       · URL attribute when the value is the whole value (`href="{{u}}"`) → `safeUrl`
//         first (blocks `javascript:`/`data:`/protocol-relative), then escape,
//       · unquoted attribute, `<script>`/`<style>` body, event-handler/`style` attribute,
//         and HTML comments → REJECTED at parse time (a single escaper cannot make these
//         safe; the developer must quote attributes / move logic into a class binding).
//   - Path resolution is own-enumerable only and refuses `__proto__`/`constructor`/
//     `prototype`, so a binding can never reach the prototype chain.
//   - Output size, iteration count, partial-include depth, and block-nesting depth are
//     all bounded, so a runaway/zero-output `{{#each}}` or recursive partial fails fast.
import { escapeAttr } from './escape.js';
import { safeUrl } from './url.js';

/** Thrown for template syntax errors, unsafe contexts, unknown partials, or guard breaches. */
export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

/** The whitelisted binding namespaces a template may read. */
export interface TemplateContext {
  company?: Record<string, unknown>;
  website?: Record<string, unknown>;
  page?: Record<string, unknown>;
  /** Named values/collections, addressable as `{{ data.* }}` / `{{#each data.* }}`. */
  data?: Record<string, unknown>;
  /** Named partial templates, included via `{{> name}}` (rendered in the current scope). */
  partials?: Record<string, string>;
}

export interface RenderOptions {
  /** Max nested partial-include depth (guards self/mutually-recursive partials). */
  maxIncludeDepth?: number;
  /** Max total output bytes (guards a runaway iteration). */
  maxOutput?: number;
  /** Max nested-block depth (`{{#each}}`/`{{#if}}`) — bounds parse/eval recursion. */
  maxNestingDepth?: number;
  /** Max total iterations + partial expansions (guards zero-output CPU blowups). */
  maxOperations?: number;
}

const DEFAULT_MAX_DEPTH = 20;
const DEFAULT_MAX_OUTPUT = 1_048_576; // 1 MiB
const DEFAULT_MAX_NESTING = 64;
const DEFAULT_MAX_OPERATIONS = 1_000_000;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** Attributes whose value is a URL — a whole-value interpolation here is `safeUrl`-sanitized. */
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster', 'cite', 'background', 'xlink:href']);

/** How an interpolation's value must be escaped, decided from its HTML context. */
type InterpMode = 'text' | 'url' | 'unsafe';

// ---------------------------------------------------------------------------- AST
type TplNode =
  | { t: 'text'; value: string }
  | { t: 'interp'; expr: string; mode: InterpMode }
  | { t: 'if'; expr: string; then: TplNode[]; alt: TplNode[] }
  | { t: 'each'; expr: string; body: TplNode[] }
  | { t: 'partial'; name: string };

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'tag'; inner: string; mode: InterpMode };

/**
 * Linear scan into text/tag tokens that also tracks HTML context, so each `{{ }}` is
 * tagged with how its value must be escaped. Best-effort HTML state machine (not a full
 * parser): enough to make the safe contexts safe and reject the un-escapable ones.
 */
function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let textStart = 0;

  type Mode = 'body' | 'comment' | 'rawtext' | 'tag';
  let mode: Mode = 'body';
  let rawCloser = ''; // '</script' | '</style' while in rawtext
  let sub: 'name' | 'preAttr' | 'attrName' | 'afterName' | 'preValue' | 'value' = 'name';
  let attrName = '';
  let quote: '"' | "'" | '' = '';
  let valueHasLiteral = false; // any literal chars in the current attr value before an interp?
  let pendingRaw = ''; // 'script'|'style' to enter on the tag's '>'

  function flushText(end: number): void {
    if (end > textStart) tokens.push({ kind: 'text', value: src.slice(textStart, end) });
  }

  function interpMode(): InterpMode {
    if (mode === 'comment' || mode === 'rawtext') return 'unsafe';
    if (mode === 'body') return 'text';
    if (sub !== 'value') return 'unsafe'; // tag/attr-name structure or unquoted (preValue)
    if (quote === '') return 'unsafe'; // unquoted attribute value
    if (attrName.startsWith('on') || attrName === 'style') return 'unsafe';
    if (!valueHasLiteral && URL_ATTRS.has(attrName)) return 'url';
    return 'text';
  }

  // Returns the mode to enter after a tag's `>` (rawtext for <script>/<style>, else body).
  // Returning a `Mode` — rather than mutating `mode` in here — keeps TS's flow analysis
  // aware that `mode` can become 'rawtext' (a closure-only assignment would be lost).
  function endTag(): Mode {
    const next: Mode = pendingRaw ? 'rawtext' : 'body';
    rawCloser = pendingRaw ? `</${pendingRaw}` : '';
    pendingRaw = '';
    return next;
  }

  let i = 0;
  while (i < src.length) {
    if (src.startsWith('{{', i)) {
      const close = src.indexOf('}}', i + 2);
      if (close === -1) throw new TemplateError('unclosed "{{" tag');
      flushText(i);
      tokens.push({ kind: 'tag', inner: src.slice(i + 2, close).trim(), mode: interpMode() });
      i = close + 2;
      textStart = i;
      continue;
    }
    // eslint-disable-next-line security/detect-object-injection -- i is a bounded scan index
    const ch = src[i] as string;

    // An if/else chain (not a switch): cases reassign `mode` for the NEXT iteration, and
    // a switch on the live `let` makes TS narrow it out from under later case labels.
    if (mode === 'comment') {
      if (ch === '>' && src.startsWith('-->', i - 2)) mode = 'body';
    } else if (mode === 'rawtext') {
      if (ch === '<' && src.slice(i, i + rawCloser.length).toLowerCase() === rawCloser) mode = 'body';
    } else if (mode === 'body') {
      if (src.startsWith('<!--', i)) {
        mode = 'comment';
        i += 4;
        continue;
      }
      if (ch === '<') {
        const m = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(src.slice(i));
        if (m) {
          const name = (m[1] as string).toLowerCase();
          const isClose = src[i + 1] === '/';
          mode = 'tag';
          sub = 'preAttr';
          attrName = '';
          quote = '';
          pendingRaw = !isClose && (name === 'script' || name === 'style') ? name : '';
          i += m[0].length;
          continue;
        }
      }
    } else if (sub === 'value') {
      // mode === 'tag', inside an attribute value
      if (quote === '' ? /[\s>]/.test(ch) : ch === quote) {
        if (ch === '>') mode = endTag();
        else sub = 'preAttr';
        attrName = '';
        quote = '';
      } else {
        valueHasLiteral = true;
      }
    } else {
      // mode === 'tag', in the tag/attribute-name structure
      if (ch === '>') {
        mode = endTag();
      } else if (ch === '/') {
        // self-closing slash — ignore
      } else if (/\s/.test(ch)) {
        if (sub === 'attrName') sub = 'afterName';
      } else if (ch === '=') {
        if (sub === 'attrName' || sub === 'afterName') sub = 'preValue';
      } else if (sub === 'preValue') {
        // first char of an UNQUOTED value, or an opening quote
        if (ch === '"' || ch === "'") {
          sub = 'value';
          quote = ch;
        } else {
          sub = 'value';
          quote = '';
        }
        valueHasLiteral = quote === '';
      } else if (sub === 'preAttr' || sub === 'afterName') {
        sub = 'attrName';
        attrName = ch.toLowerCase();
      } else if (sub === 'attrName') {
        attrName += ch.toLowerCase();
      }
    }
    i += 1;
  }
  flushText(src.length);
  return tokens;
}

// ---------------------------------------------------------------------------- parse
/** Recursive-descent parse into the AST, matching block open/close tags. */
function parse(tokens: readonly Token[], maxNesting: number): TplNode[] {
  let pos = 0;

  function parseUntil(
    closer: 'if' | 'each' | null,
    depth: number,
  ): { nodes: TplNode[]; closedBy: string | null } {
    if (depth > maxNesting) throw new TemplateError('template nesting too deep');
    const nodes: TplNode[] = [];
    while (pos < tokens.length) {
      // eslint-disable-next-line security/detect-object-injection -- pos is a bounded parse cursor
      const tok = tokens[pos]!;
      if (tok.kind === 'text') {
        nodes.push({ t: 'text', value: tok.value });
        pos += 1;
        continue;
      }
      const inner = tok.inner;
      if (inner.startsWith('!')) {
        pos += 1; // comment
        continue;
      }
      if (inner === 'else') {
        if (closer !== 'if') throw new TemplateError('{{else}} outside of {{#if}}');
        pos += 1;
        return { nodes, closedBy: 'else' };
      }
      if (inner.startsWith('/')) {
        const name = inner.slice(1).trim();
        if (name !== closer) throw new TemplateError(`unexpected {{/${name}}}`);
        pos += 1;
        return { nodes, closedBy: name };
      }
      if (inner.startsWith('#if ')) {
        pos += 1;
        const expr = inner.slice('#if '.length).trim();
        const thenPart = parseUntil('if', depth + 1);
        let alt: TplNode[] = [];
        if (thenPart.closedBy === 'else') {
          const elsePart = parseUntil('if', depth + 1);
          if (elsePart.closedBy !== 'if') throw new TemplateError('unclosed {{#if}}');
          alt = elsePart.nodes;
        } else if (thenPart.closedBy !== 'if') {
          throw new TemplateError('unclosed {{#if}}');
        }
        nodes.push({ t: 'if', expr, then: thenPart.nodes, alt });
        continue;
      }
      if (inner.startsWith('#each ')) {
        pos += 1;
        const expr = inner.slice('#each '.length).trim();
        const body = parseUntil('each', depth + 1);
        if (body.closedBy !== 'each') throw new TemplateError('unclosed {{#each}}');
        nodes.push({ t: 'each', expr, body: body.nodes });
        continue;
      }
      if (inner.startsWith('#')) throw new TemplateError(`unknown block helper: {{${inner}}}`);
      if (inner.startsWith('>')) {
        nodes.push({ t: 'partial', name: inner.slice(1).trim() });
        pos += 1;
        continue;
      }
      // interpolation — reject the un-escapable contexts at parse time (fail loud).
      if (tok.mode === 'unsafe') {
        throw new TemplateError(
          `unsafe interpolation context for {{ ${inner} }}: ` +
            'bind values only inside element text or QUOTED attributes — never in an unquoted ' +
            'attribute, an event-handler/style attribute, a <script>/<style> block, or an HTML comment',
        );
      }
      nodes.push({ t: 'interp', expr: inner, mode: tok.mode });
      pos += 1;
    }
    if (closer) throw new TemplateError(`unclosed {{#${closer}}}`);
    return { nodes, closedBy: null };
  }

  return parseUntil(null, 0).nodes;
}

// ---------------------------------------------------------------------------- eval
interface Frame {
  scope: unknown;
  index?: number;
}

/** Own-enumerable dotted lookup; never walks the prototype chain or dynamic-indexes. */
function lookup(root: unknown, segments: readonly string[]): unknown {
  let current: unknown = root;
  for (const key of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    const entry = Object.entries(current as Record<string, unknown>).find(([k]) => k === key);
    if (!entry) return undefined;
    current = entry[1];
  }
  return current;
}

/** Resolves an expression against the scope stack (innermost first), plus `this`/`@index`. */
function resolveExpr(expr: string, stack: readonly Frame[]): unknown {
  if (expr === 'this') return stack[stack.length - 1]?.scope;
  if (expr === '@index') {
    for (let k = stack.length - 1; k >= 0; k -= 1) {
      // eslint-disable-next-line security/detect-object-injection -- k is a bounded loop index
      const idx = stack[k]?.index;
      if (idx !== undefined) return idx;
    }
    return undefined;
  }
  const segments = expr.split('.');
  if (segments.some((s) => s === '' || DANGEROUS_KEYS.has(s))) return undefined;
  for (let k = stack.length - 1; k >= 0; k -= 1) {
    // eslint-disable-next-line security/detect-object-injection -- k is a bounded loop index
    const value = lookup(stack[k]!.scope, segments);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** A value renders only for string/finite-number leaves (else nothing). */
function valueToString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Escapes a resolved value for its interpolation context (text/quoted-attr, or URL). */
function renderInterp(value: unknown, mode: InterpMode): string {
  const str = valueToString(value);
  if (str === undefined) return '';
  // A whole-value URL attribute: sanitize the scheme before escaping. Empty stays empty.
  if (mode === 'url') return str === '' ? '' : escapeAttr(safeUrl(str));
  return escapeAttr(str);
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  if (typeof value === 'string') return value.length > 0;
  return true;
}

/**
 * Renders a developer-authored template against a whitelisted binding context. Throws
 * {@link TemplateError} on a syntax error, an unsafe interpolation context, an unknown
 * partial, or a guard breach.
 */
export function renderTemplate(template: string, ctx: TemplateContext = {}, opts: RenderOptions = {}): string {
  const maxDepth = opts.maxIncludeDepth ?? DEFAULT_MAX_DEPTH;
  const maxOutput = opts.maxOutput ?? DEFAULT_MAX_OUTPUT;
  const maxNesting = opts.maxNestingDepth ?? DEFAULT_MAX_NESTING;
  const maxOps = opts.maxOperations ?? DEFAULT_MAX_OPERATIONS;
  const partials = ctx.partials ?? {};
  const parsedPartials = new Map<string, TplNode[]>();

  const root: Frame = {
    scope: { company: ctx.company, website: ctx.website, page: ctx.page, data: ctx.data },
  };

  let out = '';
  let ops = 0;
  const emit = (s: string): void => {
    out += s;
    if (out.length > maxOutput) throw new TemplateError('template output exceeded the size limit');
  };
  const tick = (): void => {
    ops += 1;
    if (ops > maxOps) throw new TemplateError('template exceeded the operation limit');
  };

  function evalNodes(nodes: readonly TplNode[], stack: Frame[], depth: number): void {
    for (const node of nodes) {
      switch (node.t) {
        case 'text':
          emit(node.value);
          break;
        case 'interp':
          emit(renderInterp(resolveExpr(node.expr, stack), node.mode));
          break;
        case 'if':
          evalNodes(truthy(resolveExpr(node.expr, stack)) ? node.then : node.alt, stack, depth);
          break;
        case 'each': {
          const value = resolveExpr(node.expr, stack);
          if (!Array.isArray(value)) break;
          value.forEach((item, index) => {
            tick();
            stack.push({ scope: item, index });
            evalNodes(node.body, stack, depth);
            stack.pop();
          });
          break;
        }
        case 'partial': {
          if (depth >= maxDepth) throw new TemplateError('partial include depth exceeded');
          tick();
          const src = Object.entries(partials).find(([k]) => k === node.name)?.[1];
          if (src === undefined) throw new TemplateError(`unknown partial: ${node.name}`);
          let parsed = parsedPartials.get(node.name);
          if (!parsed) {
            parsed = parse(tokenize(src), maxNesting);
            parsedPartials.set(node.name, parsed);
          }
          evalNodes(parsed, stack, depth + 1);
          break;
        }
      }
    }
  }

  evalNodes(parse(tokenize(template), maxNesting), [root], 0);
  return out;
}
