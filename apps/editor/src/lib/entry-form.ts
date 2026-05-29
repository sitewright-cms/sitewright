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
    default:
      // text, richtext, date, image, reference, select
      return typeof raw === 'string' ? raw : raw === null || raw === undefined ? '' : String(raw);
  }
}

/** Builds an initial `values` object for a new entry of `dataset`. */
export function defaultEntryValues(dataset: Dataset): Record<string, unknown> {
  return dataset.fields.reduce<Record<string, unknown>>((acc, field) => {
    const empty = field.type === 'boolean' ? false : field.type === 'number' || field.type === 'json' ? undefined : '';
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
