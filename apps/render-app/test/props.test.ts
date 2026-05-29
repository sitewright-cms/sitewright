import { describe, it, expect } from 'vitest';
import type { Entry } from '@sitewright/schema';
import { fieldValue, safeUrl, str, textProp, urlProp } from '../src/blocks/props.js';

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

describe('safeUrl', () => {
  it.each(['https://example.com', 'http://x.io/a', '/about', '/', '#section'])(
    'allows safe URL %s',
    (url) => {
      expect(safeUrl(url)).toBe(url);
    },
  );

  it.each(['javascript:alert(1)', 'data:text/html,<script>', 'vbscript:x', 'ftp://x', 'mailto:a@b'])(
    'rejects unsafe URL %s -> fallback',
    (url) => {
      expect(safeUrl(url)).toBe('#');
    },
  );

  it('uses the provided fallback for unsafe/empty values', () => {
    expect(safeUrl('javascript:alert(1)', '')).toBe('');
    expect(safeUrl('   ', '')).toBe('');
  });
});

describe('urlProp', () => {
  it('sanitizes a bound href field', () => {
    const evil: Entry = { id: 'x', dataset: 'd', status: 'published', values: { u: 'javascript:alert(1)' } };
    expect(urlProp({ hrefField: 'u' }, evil, 'href', '#')).toBe('#');
  });

  it('passes through a safe static href', () => {
    expect(urlProp({ href: '/contact' }, undefined, 'href')).toBe('/contact');
  });
});
