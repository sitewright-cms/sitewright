// Pure helpers for the dataset/entry forms: turning form inputs into typed entry
// values, seeding empty entries, and deriving labels/slugs. Kept framework-free
// and side-effect-free so it is trivially unit-tested.
import type { Dataset, Entry, FieldType } from '@sitewright/schema';

/** Lowercases and hyphenates a label into a slug-safe token (may be empty). */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Turns a label into a valid CMS field key (KeyNameSchema: starts with a letter
 * or underscore, then letters/digits/underscores). Returns '' when nothing
 * usable remains.
 */
export function identifierize(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (cleaned === '') return '';
  return /^[a-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

/** Own-enumerable value read that avoids dynamic object indexing. */
export function readValue(values: Record<string, unknown>, key: string): unknown {
  return Object.entries(values).find(([k]) => k === key)?.[1];
}

/** Coerces a raw form input into the stored value for a field of `type`. */
export function coerceFieldValue(type: FieldType, raw: unknown): unknown {
  switch (type) {
    case 'number': {
      if (raw === '' || raw === null || raw === undefined) return undefined;
      const n = Number(raw);
      return Number.isNaN(n) ? undefined : n;
    }
    case 'boolean':
      return raw === true || raw === 'true';
    case 'json': {
      if (typeof raw !== 'string' || raw.trim() === '') return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    case 'list':
    case 'object':
      // Nested values (array / sub-record) are NOT edited as a raw string — pass the value
      // through untouched so the entry editor can never coerce a stored array/object into a
      // string. (The structured recursive editor for these lands in a follow-up.)
      return raw;
    default:
      // text, richtext, date, image, reference, select
      return typeof raw === 'string' ? raw : raw === null || raw === undefined ? '' : String(raw);
  }
}

/** Builds an initial `values` object for a new entry of `dataset`. */
export function defaultEntryValues(dataset: Dataset): Record<string, unknown> {
  return dataset.fields.reduce<Record<string, unknown>>((acc, field) => {
    const empty =
      field.type === 'boolean'
        ? false
        : field.type === 'number' || field.type === 'json'
          ? undefined
          : field.type === 'list'
            ? []
            : field.type === 'object'
              ? {}
              : '';
    return { ...acc, [field.name]: empty };
  }, {});
}

/** A human label for an entry: the first non-empty text field value, else its id. */
export function entryLabel(dataset: Dataset, entry: Entry): string {
  const textField = dataset.fields.find((f) => f.type === 'text');
  if (textField) {
    const value = readValue(entry.values, textField.name);
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return entry.id;
}

/**
 * Inserts `copy` directly AFTER the entry whose id is `srcId` in an already-sorted `list`, then
 * returns the list with a dense `order` (0,1,2,…) assigned to every element — so a duplicated entry
 * lands next to its source rather than at the end. If `srcId` isn't found, `copy` is appended.
 */
export function reorderWithInsert(list: readonly Entry[], srcId: string, copy: Entry): Entry[] {
  const idx = list.findIndex((e) => e.id === srcId);
  const next =
    idx === -1 ? [...list, copy] : [...list.slice(0, idx + 1), copy, ...list.slice(idx + 1)];
  return next.map((e, i) => ({ ...e, order: i }));
}

/**
 * Moves the item keyed `sourceKey` to before/after the item keyed `targetKey`, returning a NEW
 * array (the source is unchanged). Drag-reorder for a plain ordered list (e.g. dataset schema
 * fields, ordered by array position). No-op (a shallow copy) if either key is missing or equal.
 */
export function reorderByKey<T>(
  list: readonly T[],
  keyOf: (item: T) => string,
  sourceKey: string,
  targetKey: string,
  pos: 'before' | 'after',
): T[] {
  if (sourceKey === targetKey) return list.slice();
  const from = list.findIndex((x) => keyOf(x) === sourceKey);
  if (from === -1) return list.slice();
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  const target = next.findIndex((x) => keyOf(x) === targetKey);
  if (target === -1) return list.slice();
  next.splice(target + (pos === 'after' ? 1 : 0), 0, moved!);
  return next;
}

/**
 * Returns `desired` if free, else the first `desired-2`, `desired-3`, … not in `taken`. Used to
 * pick a collision-free slug/id when duplicating a dataset.
 */
export function uniqueSlug(desired: string, taken: ReadonlySet<string>): string {
  if (!taken.has(desired)) return desired;
  for (let n = 2; ; n += 1) {
    const candidate = `${desired}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
