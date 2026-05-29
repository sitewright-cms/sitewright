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
  // eslint-disable-next-line security/detect-unsafe-regex -- linear: the "-" separator
  // makes the two quantified groups non-overlapping, and input is length-capped by .max().
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase alphanumeric with hyphens');

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
  // eslint-disable-next-line security/detect-unsafe-regex -- linear: each iteration must
  // start with "/" (not in the inner classes), so groups don't overlap; length-capped by .max().
  .regex(
    /^\/$|^(?:\/(?:[A-Za-z0-9._~%-]+|\[[A-Za-z0-9_]+\]))+\/?$/,
    'must be a root-relative URL path (optionally with [param] segments)',
  );

/** Asset reference: an absolute http(s) URL or a root-relative path. Rejects `javascript:`/`data:` URIs. */
export const AssetRefSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (v) => /^https?:\/\//i.test(v) || v.startsWith('/'),
    'must be an absolute http(s) URL or a root-relative path',
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

/** A short design-token value (string or number); strings cannot contain CSS-breaking characters. */
export const TokenValueSchema = z.union([
  z.number(),
  z.string().max(64).regex(/^[^;{}<>]*$/, 'invalid token value'),
]);

/** A CSS string value (e.g. a font-family stack) with no declaration break-out characters. */
export const CssStringSchema = z
  .string()
  .max(200)
  .regex(/^[^;{}<>]*$/, 'invalid CSS value');

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
