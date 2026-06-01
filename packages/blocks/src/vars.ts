// Template/partial variables: `{{ company.* }}` / `{{ website.* }}` / `{{ page.* }}`
// substitution in block text. This is NOT a template engine — it is a pure,
// whitelisted path lookup with NO logic and NO eval (the locked "no-eval sandboxed
// templating" decision). The substituted value is RAW text; the renderer escapes
// it at emit time, so a value containing HTML can never inject markup.

/** The whitelisted variable namespaces a page/partial/template may reference. */
export interface VarContext {
  /** The project's Corporate Identity (name, legalName, slogan, email, address, …). */
  company?: Record<string, unknown>;
  /** Project website settings (siteUrl, …). */
  website?: Record<string, unknown>;
  /** The current page (title, path, …). */
  page?: Record<string, unknown>;
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// `{{ namespace.path }}` — a lowercase-led dotted token. Flat char class (no nested
// quantifier) so there's no catastrophic-backtracking surface; the namespace +
// segments are validated in code below.
const VAR_RE = /\{\{\s*([a-z][a-zA-Z0-9_.]*)\s*\}\}/g;

/** Safely resolve a dotted path to a string/number leaf (else undefined). */
function resolvePath(root: unknown, segments: readonly string[]): string | undefined {
  let current: unknown = root;
  for (const key of segments) {
    if (DANGEROUS_KEYS.has(key)) return undefined;
    if (current === null || typeof current !== 'object') return undefined;
    // Own-enumerable lookup only (no prototype chain / dynamic indexing).
    current = Object.entries(current as Record<string, unknown>).find(([k]) => k === key)?.[1];
  }
  if (typeof current === 'string') return current;
  if (typeof current === 'number' && Number.isFinite(current)) return String(current);
  return undefined;
}

/**
 * Replace `{{ company.* }}` / `{{ website.* }}` / `{{ page.* }}` placeholders in
 * `text` with whitelisted values from `vars`. Unknown namespaces, unknown paths, or
 * non-string/number leaves leave the literal placeholder untouched (visible to the
 * author, never blanked). Returns RAW text — callers escape it.
 */
export function substituteVars(text: string, vars: VarContext | undefined): string {
  if (!vars || !text.includes('{{')) return text;
  return text.replace(VAR_RE, (match, token: string) => {
    const segments = token.split('.');
    const ns = segments[0];
    const nsObj = ns === 'company' ? vars.company : ns === 'website' ? vars.website : ns === 'page' ? vars.page : undefined;
    // Require a whitelisted namespace AND at least one field segment.
    if (nsObj === undefined || segments.length < 2) return match;
    const value = resolvePath(nsObj, segments.slice(1));
    return value ?? match;
  });
}
