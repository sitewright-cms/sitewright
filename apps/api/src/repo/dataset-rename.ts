// Pure helpers for the dataset-slug RENAME cascade. Renaming a dataset's `slug` must update every place
// that references it BY SLUG: a page/template `source` (the `{{#each dataset.<slug>}}` / `{{#sw-pick-entry
// dataset.<slug> …}}` paths + a `{{sw-control … dataset="<slug>"}}` picker arg), an entry's `dataset`
// field, and another dataset's `reference` field whose `config.target` points at it. Kept pure (no DB) so
// the rewrite rules are unit-tested in isolation; the repo wires them into one transaction.

/** Escape a slug for use inside a RegExp (slugs are [a-z0-9-]; `-` is the only meta char to guard). */
function esc(slug: string): string {
  return slug.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Rewrite `dataset.<old>` template paths and `dataset="<old>"` helper args in a page/template `source`.
 * - The path match requires `dataset` to start at a non-identifier boundary (so `mydataset.x` is left
 *   alone) and the slug to END at a non-`[a-z0-9-]` char (so `dataset.items` does NOT touch
 *   `dataset.items2` / `dataset.items-archive`); a trailing `.` (property access) is fine.
 * - The attr match preserves the original quote style.
 * Returns the source unchanged when there are no references.
 */
export function rewriteDatasetRefsInSource(source: string, oldSlug: string, newSlug: string): string {
  if (!source || oldSlug === newSlug) return source;
  const o = esc(oldSlug);
  const pathRe = new RegExp(`(?<![A-Za-z0-9_])dataset\\.${o}(?![A-Za-z0-9-])`, 'g');
  const attrRe = new RegExp(`(\\bdataset=)(["'])${o}\\2`, 'g');
  return source.replace(pathRe, `dataset.${newSlug}`).replace(attrRe, `$1$2${newSlug}$2`);
}

/** True if a page/template `source` references the dataset by slug (path or picker arg). */
export function sourceReferencesDataset(source: string, slug: string): boolean {
  if (!source) return false;
  const o = esc(slug);
  return new RegExp(`(?<![A-Za-z0-9_])dataset\\.${o}(?![A-Za-z0-9-])`).test(source) || new RegExp(`\\bdataset=(["'])${o}\\1`).test(source);
}

/** A dataset field (possibly nested) — only the bits this rewrite touches. */
interface RefField {
  type?: string;
  config?: { target?: string } & Record<string, unknown>;
  fields?: RefField[];
}

/**
 * Rewrite any `reference` field (at any nesting depth) whose `config.target` is the old slug → the new
 * slug. Returns the new field tree + whether anything changed (immutable; untouched fields are reused).
 */
export function rewriteReferenceTargets<T extends RefField>(fields: readonly T[], oldSlug: string, newSlug: string): { fields: T[]; changed: boolean } {
  let changed = false;
  const walk = (fs: readonly RefField[]): RefField[] =>
    fs.map((f) => {
      let next: RefField = f;
      if (f.type === 'reference' && f.config?.target === oldSlug) {
        next = { ...f, config: { ...f.config, target: newSlug } };
        changed = true;
      }
      if (Array.isArray(f.fields)) {
        const sub = walk(f.fields);
        if (sub.some((c, i) => c !== f.fields![i])) next = { ...next, fields: sub };
      }
      return next;
    });
  const out = walk(fields) as T[];
  return { fields: out, changed };
}
