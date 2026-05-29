import { describe, it, expect } from 'vitest';
import type { Entry } from '@sitewright/schema';
import { fieldValue, str, textProp } from '../src/blocks/props.js';

const entry: Entry = {
  id: 'e1',
  dataset: 'features',
  status: 'published',
  values: { title: 'Bound title', count: 3 },
};

describe('fieldValue', () => {
  it('returns the static prop when no field binding is present', () => {
    expect(fieldValue({ text: 'static' }, entry, 'text')).toBe('static');
  });

  it('returns the entry field value when bound and an entry is present', () => {
    expect(fieldValue({ textField: 'title' }, entry, 'text')).toBe('Bound title');
  });

  it('falls back to the static prop when bound but no entry is in context', () => {
    expect(fieldValue({ text: 'static', textField: 'title' }, undefined, 'text')).toBe('static');
  });
});

describe('str', () => {
  it('passes strings through and falls back otherwise', () => {
    expect(str('hi')).toBe('hi');
    expect(str(42, 'fallback')).toBe('fallback');
    expect(str(undefined)).toBe('');
  });
});

describe('textProp', () => {
  it('resolves a bound field to a string', () => {
    expect(textProp({ titleField: 'title' }, entry, 'title')).toBe('Bound title');
  });

  it('uses the fallback for a non-string bound value', () => {
    expect(textProp({ valField: 'count' }, entry, 'val', 'n/a')).toBe('n/a');
  });
});
