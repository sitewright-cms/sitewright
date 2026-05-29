import { describe, expect, it } from 'vitest';
import type { Dataset, Entry } from '@sitewright/schema';
import {
  coerceFieldValue,
  defaultEntryValues,
  entryLabel,
  identifierize,
  readValue,
  slugify,
} from '../src/lib/entry-form';

const dataset: Dataset = {
  id: 'posts',
  name: 'Posts',
  slug: 'posts',
  fields: [
    { name: 'title', type: 'text', required: true, localized: false },
    { name: 'count', type: 'number', required: false, localized: false },
    { name: 'live', type: 'boolean', required: false, localized: false },
    { name: 'meta', type: 'json', required: false, localized: false },
  ],
};

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Blog Posts')).toBe('blog-posts');
    expect(slugify('  Hello,  World! ')).toBe('hello-world');
    expect(slugify('Already-Slug')).toBe('already-slug');
  });

  it('returns empty string for non-alphanumeric input', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('identifierize', () => {
  it('produces a valid KeyName (letters/digits/underscore)', () => {
    expect(identifierize('First Name')).toBe('first_name');
    expect(identifierize('title')).toBe('title');
  });

  it('prefixes an underscore when it would start with a digit', () => {
    expect(identifierize('2024 sales')).toBe('_2024_sales');
  });

  it('returns empty string when nothing usable remains', () => {
    expect(identifierize('!!!')).toBe('');
  });
});

describe('coerceFieldValue', () => {
  it('keeps text/richtext as strings', () => {
    expect(coerceFieldValue('text', 'hi')).toBe('hi');
    expect(coerceFieldValue('richtext', 'body')).toBe('body');
    expect(coerceFieldValue('text', null)).toBe('');
  });

  it('parses numbers and rejects blanks/NaN', () => {
    expect(coerceFieldValue('number', '42')).toBe(42);
    expect(coerceFieldValue('number', '')).toBeUndefined();
    expect(coerceFieldValue('number', 'abc')).toBeUndefined();
  });

  it('coerces booleans', () => {
    expect(coerceFieldValue('boolean', true)).toBe(true);
    expect(coerceFieldValue('boolean', 'true')).toBe(true);
    expect(coerceFieldValue('boolean', false)).toBe(false);
  });

  it('parses JSON, falling back to the raw string when invalid', () => {
    expect(coerceFieldValue('json', '{"a":1}')).toEqual({ a: 1 });
    expect(coerceFieldValue('json', 'not json')).toBe('not json');
    expect(coerceFieldValue('json', '')).toBeUndefined();
  });
});

describe('defaultEntryValues', () => {
  it('seeds an empty value per field by type', () => {
    expect(defaultEntryValues(dataset)).toEqual({
      title: '',
      count: undefined,
      live: false,
      meta: undefined,
    });
  });
});

describe('readValue', () => {
  it('reads a value without dynamic indexing', () => {
    expect(readValue({ title: 'X' }, 'title')).toBe('X');
    expect(readValue({}, 'missing')).toBeUndefined();
  });
});

describe('entryLabel', () => {
  it('uses the first text field value when present', () => {
    const entry: Entry = { id: 'e1', dataset: 'posts', status: 'draft', values: { title: 'My Post' } };
    expect(entryLabel(dataset, entry)).toBe('My Post');
  });

  it('falls back to the entry id when no text value is set', () => {
    const entry: Entry = { id: 'e2', dataset: 'posts', status: 'draft', values: {} };
    expect(entryLabel(dataset, entry)).toBe('e2');
  });
});
