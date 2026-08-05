import { z } from 'zod';

/**
 * Shared, security-hardened primitive schemas. The project format is the trust
 * boundary parsed by the API, CLI, and build pipeline, so identifiers, paths,
 * URLs, and CSS values are constrained here rather than re-validated downstream.
 */

export const MAX_IDENTIFIER_LENGTH = 128;
export const MAX_RECORD_ENTRIES = 256;

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

/**
 * A dataset's slug — its binding KEY in templates: `{{#each dataset.<slug>}}`, `{{sw-control … dataset=
 * "<slug>"}}`, a reference field's `config.target`. Unlike a URL slug it is a Handlebars/JS IDENTIFIER, so
 * it uses UNDERSCORES, not hyphens — `dataset.faq-passengers` parses as subtraction, `dataset.faq_passengers`
 * is a valid path. Same shape as {@link SlugSchema} but with `_` as the separator (a leading digit is fine —
 * Handlebars resolves `dataset.2024report`). No leading/trailing/double underscore.
 */
export const DatasetSlugSchema = z
  .string()
  .min(1)
  .max(64)
  // Linear: the "_" separator makes the two quantified groups non-overlapping; length-capped above (not ReDoS).
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, 'must be a lowercase identifier with underscores, e.g. faq_passengers (no hyphens)'); // eslint-disable-line security/detect-unsafe-regex

/**
 * A dataset ENTRY's id — its "item key". Like {@link DatasetSlugSchema} it is a Handlebars/JS IDENTIFIER:
 * an entry is directly addressable as `{{ item.<dataset>.<id>.<field> }}` (the keyed twin of the loop), so
 * a hyphen would parse as subtraction and break the lookup (and the editor's data-sw-entry edit handle).
 * Lowercase letters/digits in underscore-separated groups; no hyphens, no leading/trailing/double underscore.
 */
export const EntryIdSchema = z
  .string()
  .min(1)
  .max(64)
  // Linear: the "_" separator makes the quantified groups non-overlapping; length-capped above (not ReDoS).
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, 'must be a lowercase identifier with underscores, e.g. fast_pickup (no hyphens)'); // eslint-disable-line security/detect-unsafe-regex

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

/**
 * Color-token key. Like {@link KeyNameSchema} but also permits internal hyphens, so the
 * DaisyUI/Tailwind semantic names (`base-100`, `base-content`, `primary-content`) are valid
 * keys. Deliberately the SAME alphabet as the tailwind compiler's `SAFE_TOKEN` regex, so any
 * schema-valid color key is also a valid `--color-<key>` theme var / utility (never silently
 * dropped downstream). Must start with a letter; no leading/trailing hyphen.
 */
export const ColorTokenKeySchema = z
  .string()
  .min(1)
  .max(40)
  // Linear: a leading letter, then `_`/alnum runs each introduced by an optional single `-`
  // (the separator makes the groups non-overlapping); length-capped above (not ReDoS).
  .regex(/^[A-Za-z][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*$/, 'must be a CSS-ident color token name'); // eslint-disable-line security/detect-unsafe-regex

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

/**
 * A page's OWN path segment (its slug) — NOT the full route. The full URL is computed by
 * joining the slugs of the page and its ancestors ({root}/{parent slugs}/{slug}); see
 * `pagePath` in @sitewright/core. Allowed: the EMPTY string (the home page / tree root, at
 * `/`), a single lowercase slug segment (`about`, `web-design`), or a single `[param]`
 * segment for a collection page's leaf. No slashes — nesting comes from `parent`, not the path.
 */
export const PageSlugSchema = z
  .string()
  .max(64)
  // Linear: alternation of anchored, non-overlapping single-segment forms; length-capped above.
  .regex(/^$|^[a-z0-9]+(?:-[a-z0-9]+)*$|^\[[A-Za-z0-9_]+\]$/, 'must be empty (home) or a single lowercase slug segment (no slashes)'); // eslint-disable-line security/detect-unsafe-regex

/**
 * A navigation link target for a placeholder (`kind:'link'` page). Allowed: the EMPTY string (a pure
 * dropdown-parent label), a fragment (`#id` — a same-page anchor, or a `<dialog>` the runtime opens
 * as a modal), a root-relative internal path (`/about`, `/about#team`; NOT protocol-relative `//`),
 * an absolute http(s) URL, or a `mailto:`/`tel:`/`sms:` handler. Rejects `javascript:`/`data:`/
 * `vbscript:` and other active/unknown schemes. The render-time `safeUrl`/`resolveInternalUrl`
 * guard in @sitewright/blocks mirrors this allowlist.
 */
export const NavTargetSchema = z
  .string()
  .max(2048)
  .refine(
    (v) =>
      v === '' ||
      v.startsWith('#') ||
      (v.startsWith('/') && !v.startsWith('//')) ||
      /^https?:\/\//i.test(v) ||
      /^(?:mailto|tel|sms):/i.test(v),
    'must be empty, a #anchor, a root-relative /path, an http(s) URL, or a mailto:/tel:/sms: link',
  )
  // Reject embedded TAB/LF/CR: the URL parser strips these, so `/\tjavascript:…` could otherwise slip past.
  .refine((v) => !/[\t\n\r]/.test(v), 'must not contain control whitespace');

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
// a blocked char), or whitespace controls / NUL.
// Mirrors the renderer's `SAFE` guard (brand-css.ts) at the schema boundary.
// eslint-disable-next-line no-control-regex -- intentionally denying NUL/control chars
const CSS_VALUE_SAFE = /^[^;{}<>\\\n\r\t\f\x00]*$/;

/**
 * True when a value opens or closes a CSS COMMENT.
 *
 * Denying whitespace controls is NOT sufficient for this and used to be mistaken for it: `/*` needs no
 * whitespace, and an opened comment runs to the next `*​/` or end of file — swallowing the rest of the
 * `:root{…}` block, its closing brace, and whatever stylesheet follows. Measured with a single poisoned
 * `typography.fontFamilies` value: every later custom property came back empty AND the next rule in the
 * sheet stopped applying.
 *
 * Exported so the schema boundary and BOTH downstream emitters (`brand-css.ts`'s `SAFE`,
 * `@sitewright/tailwind`'s `renderThemeBlock`) enforce one definition. Each of those keeps its own value
 * ALPHABET — they legitimately differ on parentheses — but none of them may allow a comment.
 */
export function containsCssComment(v: string): boolean {
  return CSS_RICH_COMMENT.test(v);
}

/** A short design-token value (string or number); strings cannot contain CSS-breaking characters. */
export const TokenValueSchema = z.union([
  z.number(),
  z
    .string()
    .max(64)
    .regex(CSS_VALUE_SAFE, 'invalid token value')
    .refine((v) => !containsCssComment(v), 'invalid token value'),
]);

/** A CSS string value (e.g. a font-family stack) with no declaration break-out characters. */
export const CssStringSchema = z
  .string()
  .max(200)
  .regex(CSS_VALUE_SAFE, 'invalid CSS value')
  .refine((v) => !containsCssComment(v), 'invalid CSS value');

// ── Rich CSS token values (`identity.cssTokens`) ──────────────────────────────────────────────
// A DELIBERATELY WIDER value alphabet than TokenValueSchema, which bans parentheses and so cannot
// express the two things authors most want to tokenise: a gradient and a shadow ramp
// (`linear-gradient(135deg,#f00,#00f)`, `0 2px 5px rgba(0,0,0,.2)`). Widening is scoped to
// FUNCTION SYNTAX; every break-out route stays shut:
//   · `;{}<>` and backslash — a value must not end its declaration, escape its rule, or rebuild a
//     blocked character via a `\3b`-style hex escape. Whitespace controls + NUL are blocked so a
//     value can't straddle a comment or a line.
//   · `/*` and `*/` — a comment opened inside a value would swallow the rest of the `:root{…}` block
//     (including its closing brace), silently eating every declaration that follows.
//   · Fetching/computing functions by name — `url()`, `src()`, `image()`, `image-set()`, `element()`
//     and IE's `expression()`, each also matched through an OPTIONAL VENDOR PREFIX so the
//     `-webkit-image-set()` / `-moz-element()` aliases can't walk straight past a bare-name check.
//     Those are the ones that can make a network request (an exfiltration channel) or evaluate script
//     from a stylesheet. `var()`, `calc()`, `rgb()/hsl()/oklch()`, `linear-gradient()` stay available.
//   · Invisible FORMAT characters (zero-width, bidi overrides, BOM). No CSS value legitimately needs
//     one, and they exist only to make a blocked construct read as something else in review.
//   · `@import` — inert inside a declaration (an at-rule needs a rule position, which `;{}` guard),
//     but denied by name so it can never travel further than intended.
//   · UNBALANCED parentheses — an unclosed function consumes tokens past the end of the declaration
//     and, like an open comment, would absorb the rest of the stylesheet.
// eslint-disable-next-line no-control-regex -- intentionally denying NUL/control chars
const CSS_RICH_BREAKOUT = /[;{}<>\\\n\r\t\f\x00\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/;
const CSS_RICH_COMMENT = /\/\*|\*\//;
/** Function names that fetch a resource or evaluate an expression — denied at a token boundary,
 *  through an optional vendor prefix (`-webkit-image-set(`, `-moz-element(`).
 *  The optional `-[a-z]+-` prefix backtracks at worst LINEARLY per start position (one greedy run
 *  looking for its closing `-`), so the whole scan is quadratic — not exponential — and every caller
 *  feeds it a value already capped at 300 chars ({@link CssTokenValueSchema}, and the importer's own
 *  per-value bound), which puts the adversarial worst case in the tens of thousands of steps. */
// eslint-disable-next-line security/detect-unsafe-regex -- bounded input + linear per-position backtracking (see above)
const CSS_RICH_FETCH = /(?:^|[^\w-])(?:-[a-z]+-)?(?:url|src|image|image-set|element|expression)\s*\(/i;
const CSS_RICH_ATRULE = /@import/i;

/** True when every `(` in the value has a matching `)` and none closes before it opens. */
function parensBalanced(v: string): boolean {
  let depth = 0;
  for (const ch of v) {
    if (ch === '(') depth += 1;
    else if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/**
 * THE single predicate for "this arbitrary CSS value is safe to emit into a stylesheet we control".
 * Exported so the schema boundary, the renderer's brand-CSS emitter and the importer's `:root`
 * transcription all enforce the SAME rule — three hand-copied regexes would drift, and the strictest
 * copy silently dropping values is exactly the failure this replaces. Widening it is a security change.
 */
export function isSafeCssTokenValue(v: string): boolean {
  return !CSS_RICH_BREAKOUT.test(v) && !CSS_RICH_COMMENT.test(v) && !CSS_RICH_FETCH.test(v) && !CSS_RICH_ATRULE.test(v) && parensBalanced(v);
}

/**
 * A RICH design-token value — an arbitrary CSS value (gradient, shadow, transition, `var()` chain)
 * stored under `identity.cssTokens` and emitted as `--sw-<key>`. See the guard notes above for what
 * stays blocked and why; it is intentionally broader than {@link TokenValueSchema}, so treat any
 * further widening as a security change.
 */
export const CssTokenValueSchema = z
  .string()
  .min(1)
  .max(300)
  .refine((v) => !CSS_RICH_BREAKOUT.test(v), 'must not contain ; { } < > backslash or control characters')
  .refine((v) => !CSS_RICH_COMMENT.test(v), 'must not contain a CSS comment')
  .refine((v) => !CSS_RICH_FETCH.test(v), 'must not use url(), src(), image(), image-set(), element() or expression()')
  .refine((v) => !CSS_RICH_ATRULE.test(v), 'must not contain @import')
  .refine(parensBalanced, 'unbalanced parentheses');

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

/**
 * Decode an IPv6 host that EMBEDS an IPv4 address in its low 32 bits to dotted IPv4, else null. Covers
 * IPv4-mapped (`::ffff:7f00:1` / `::ffff:127.0.0.1`) and the deprecated IPv4-COMPATIBLE form
 * (`::10.0.0.1` / `::0a00:1`), which some stacks still route. 6to4 and NAT64 also embed an IPv4 but are
 * caught by their own prefix checks in {@link targetsPrivateHost}.
 */
function ipv4MappedToDotted(host: string): string | null {
  const m = /^::(?:ffff:)?(.+)$/.exec(host);
  const tail = m?.[1];
  if (tail === undefined) return null;
  if (tail.includes(':') && !/^[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(tail)) return null; // a longer v6 tail, not an embedded v4
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
 * SSRF guard: it judges the URL STRING and never resolves DNS, so a hostname with a
 * private A record passes. Treat it as a cheap pre-filter, NOT a boundary — anything
 * that fetches a user-supplied URL server-side must go through the connect-pinned
 * fetcher (`pinnedFetch` / `pinnedFetchDetailed`), which resolves once, rejects private
 * addresses and connects to the pinned IP. IPv6 forms that embed an IPv4 (IPv4-mapped,
 * IPv4-compatible, 6to4, NAT64) are decoded so they can't smuggle a private v4 through.
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
    host.startsWith('2002:') || // 6to4 (embeds an IPv4 in bits 17–48 → can reach a private v4)
    host.startsWith('64:ff9b:') || // RFC 6146 NAT64 well-known prefix (embeds an IPv4)
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    isPrivateIPv4(host)
  );
}

/**
 * Builds a record schema that rejects prototype-pollution keys (`__proto__`,
 * `constructor`, `prototype`) and caps cardinality. Use for any user-supplied
 * "property bag" map (props, values, config, query, design tokens). `maxEntries`
 * defaults to {@link MAX_RECORD_ENTRIES}; pass a higher cap for a record that
 * legitimately holds more rows (e.g. a multilingual site's translation catalog).
 */
export function safeRecord<V extends z.ZodTypeAny>(
  value: V,
  baseKey: z.ZodString = z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  maxEntries: number = MAX_RECORD_ENTRIES,
) {
  const key = baseKey.refine((k) => !DANGEROUS_KEYS.has(k), {
    message: 'disallowed object key',
  });
  return z.record(key, value).superRefine((obj, ctx) => {
    if (Object.keys(obj).length > maxEntries) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `too many entries (max ${maxEntries})`,
      });
    }
  });
}

