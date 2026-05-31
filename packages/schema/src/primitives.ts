import { z } from 'zod';

/**
 * Shared, security-hardened primitive schemas. The project format is the trust
 * boundary parsed by the API, CLI, and build pipeline, so identifiers, paths,
 * URLs, and CSS values are constrained here rather than re-validated downstream.
 */

export const MAX_IDENTIFIER_LENGTH = 128;
export const MAX_RECORD_ENTRIES = 256;
/** Max block-tree nesting depth (guards against parse-time stack overflow). */
export const MAX_PAGE_TREE_DEPTH = 100;
/** Max children per block node (guards against width-based parse-time exhaustion). */
export const MAX_CHILDREN = 1000;

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Stable entity identifier (ids, partial refs). */
export const IdSchema = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/, 'must be alphanumeric with "-" or "_"');

/** URL- and filesystem-safe slug. */
export const SlugSchema = z
  .string()
  .min(1)
  .max(64)
  // Linear: the "-" separator makes the two quantified groups non-overlapping, and input
  // is length-capped by .max() above, so backtracking is bounded (not ReDoS).
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase alphanumeric with hyphens'); // eslint-disable-line security/detect-unsafe-regex

/** Block component type — resolved against the block registry. */
export const ComponentTypeSchema = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER_LENGTH)
  .regex(/^[A-Za-z][A-Za-z0-9.-]*$/, 'must start with a letter');

/** CMS field / design-token key — used as an object key and code identifier. */
export const KeyNameSchema = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER_LENGTH)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be a valid identifier');

/** Root-relative URL route with optional `[param]` segments. Rejects `//host`, `javascript:`, absolute URLs. */
export const RoutePathSchema = z
  .string()
  .min(1)
  .max(512)
  // Linear: each iteration must start with "/" (not in the inner classes), so the groups
  // don't overlap; length-capped by .max() above (not ReDoS).
  .regex(/^\/$|^(?:\/(?:[A-Za-z0-9._~%-]+|\[[A-Za-z0-9_]+\]))+\/?$/, 'must be a root-relative URL path (optionally with [param] segments)') // eslint-disable-line security/detect-unsafe-regex
  // Reject `.`/`..` segments: never a legitimate page path, and they would be a
  // path-traversal vector for the static publisher (it also guards independently).
  .refine((path) => !path.split('/').some((seg) => seg === '.' || seg === '..'), {
    message: 'path segments cannot be "." or ".."',
  });

/** Asset reference: an absolute http(s) URL or a root-relative path. Rejects `javascript:`/`data:` URIs. */
export const AssetRefSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    // Absolute http(s), or a single-slash root-relative path — NOT protocol-relative
    // (`//host`, an off-site/open-redirect vector), matching safeUrl in @sitewright/blocks.
    (v) => /^https?:\/\//i.test(v) || (v.startsWith('/') && !v.startsWith('//')),
    'must be an absolute http(s) URL or a root-relative path (not protocol-relative)',
  );

/** CSS color value: hex, rgb(a)/hsl(a) function, or a bare keyword. Cannot break out of a declaration. */
export const CssColorSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^#[0-9a-fA-F]{3,8}$|^(?:rgb|hsl)a?\([0-9\s%,./deg-]+\)$|^[a-zA-Z]+$/,
    'must be a valid CSS color value',
  );

// A CSS token value cannot contain the declaration break-out characters
// (`;{}<>`), a BACKSLASH (CSS hex escapes like `\3b` decode to `;`, reconstructing
// a blocked char), or whitespace controls / NUL (which could straddle a comment).
// Mirrors the renderer's `SAFE` guard (brand-css.ts) at the schema boundary.
// eslint-disable-next-line no-control-regex -- intentionally denying NUL/control chars
const CSS_VALUE_SAFE = /^[^;{}<>\\\n\r\t\f\x00]*$/;

/** A short design-token value (string or number); strings cannot contain CSS-breaking characters. */
export const TokenValueSchema = z.union([
  z.number(),
  z.string().max(64).regex(CSS_VALUE_SAFE, 'invalid token value'),
]);

/** A CSS string value (e.g. a font-family stack) with no declaration break-out characters. */
export const CssStringSchema = z.string().max(200).regex(CSS_VALUE_SAFE, 'invalid CSS value');

/**
 * A space-separated list of Tailwind utility classes for a block's root element.
 * The charset covers real-world utilities — modifiers (`md:`, `hover:`), arbitrary
 * values (`grid-cols-[1fr_2fr]`, `text-[#0a0a0a]`), opacity (`bg-brand/80`),
 * functions (`bg-[url(...)]`), and arbitrary variants (`[&>*]`) — while excluding
 * the characters that could break out of an HTML attribute or a CSS selector
 * (`" ' < > { } ;`). The renderer additionally escapes this before emitting it.
 */
export const ClassNameSchema = z
  .string()
  .min(1)
  .max(1000)
  .regex(/^[A-Za-z0-9 \-_:/[\]().,%#!@*+&=]+$/, 'contains invalid class characters');

/** True if a dotted-decimal IPv4 is loopback / private / link-local / CGNAT / wildcard. */
function isPrivateIPv4(host: string): boolean {
  return (
    host.startsWith('0.') || // 0.0.0.0/8 (incl. the 0.0.0.0 wildcard → localhost on Linux)
    host.startsWith('10.') || // RFC 1918
    host.startsWith('127.') || // loopback
    /^169\.254\./.test(host) || // link-local /16 (incl. 169.254.169.254 cloud metadata)
    /^192\.168\./.test(host) || // RFC 1918
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || // RFC 1918
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) // RFC 6598 CGNAT 100.64.0.0/10
  );
}

/** Decode an IPv4-mapped IPv6 host (`::ffff:7f00:1` or `::ffff:127.0.0.1`) to dotted IPv4, else null. */
function ipv4MappedToDotted(host: string): string | null {
  const m = /^::ffff:(.+)$/.exec(host);
  const tail = m?.[1];
  if (tail === undefined) return null;
  if (tail.includes('.')) return tail; // already dotted (e.g. ::ffff:127.0.0.1)
  const groups = tail.split(':'); // hex form: two 16-bit groups (e.g. 7f00:1)
  if (groups.length !== 2) return null;
  const hi = Number.parseInt(groups[0] ?? '', 16);
  const lo = Number.parseInt(groups[1] ?? '', 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/**
 * True if `url`'s host is localhost / link-local / a private (RFC 1918/6598) range —
 * i.e. not a public host. Unparseable → treated as private (blocked). A string-level
 * SSRF guard (DNS-rebinding to a private IP isn't covered — defense-in-depth, used
 * for any server-fetched or browser-posted author-supplied URL). IPv4-mapped IPv6
 * (`::ffff:a.b.c.d`) is decoded so it can't smuggle a private IPv4 past the checks.
 */
export function targetsPrivateHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return true;
  }
  const mapped = ipv4MappedToDotted(host);
  if (mapped && isPrivateIPv4(mapped)) return true;
  return (
    host === 'localhost' ||
    host === '::' || // IPv6 unspecified (routes to loopback on many stacks)
    host === '::1' || // IPv6 loopback
    host.startsWith('fc') || // IPv6 ULA fc00::/7
    host.startsWith('fd') ||
    host.startsWith('fe80:') || // IPv6 link-local
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    isPrivateIPv4(host)
  );
}

/**
 * Builds a record schema that rejects prototype-pollution keys (`__proto__`,
 * `constructor`, `prototype`) and caps cardinality. Use for any user-supplied
 * "property bag" map (props, values, config, query, design tokens).
 */
export function safeRecord<V extends z.ZodTypeAny>(
  value: V,
  baseKey: z.ZodString = z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
) {
  const key = baseKey.refine((k) => !DANGEROUS_KEYS.has(k), {
    message: 'disallowed object key',
  });
  return z.record(key, value).superRefine((obj, ctx) => {
    if (Object.keys(obj).length > MAX_RECORD_ENTRIES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `too many entries (max ${MAX_RECORD_ENTRIES})`,
      });
    }
  });
}

/**
 * Iteratively asserts a raw (pre-parse) block-tree value does not exceed `max`
 * nesting depth. MUST be called before `PageNodeSchema.parse` on untrusted
 * input: Zod parses recursively, so a pathologically deep tree would overflow
 * the call stack during parsing itself.
 */
export function assertWithinTreeDepth(value: unknown, max: number = MAX_PAGE_TREE_DEPTH): void {
  const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 1 }];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.depth > max) {
      throw new RangeError(`block tree exceeds maximum depth of ${max}`);
    }
    const node = frame.node;
    if (node !== null && typeof node === 'object' && 'children' in node) {
      const children = (node as { children?: unknown }).children;
      if (Array.isArray(children)) {
        for (const child of children) {
          stack.push({ node: child, depth: frame.depth + 1 });
        }
      }
    }
  }
}
