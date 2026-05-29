import { describe, expect, it } from 'vitest';
import type { Entry } from '@sitewright/schema';
import { safeUrl } from '../src/url.js';
import { textProp, urlProp } from '../src/props.js';

const entry: Entry = {
  id: 'e1',
  dataset: 'posts',
  status: 'published',
  values: { title: 'Bound Title', link: 'https://example.com' },
};

describe('safeUrl', () => {
  it('allows http(s), root-relative and fragment URLs', () => {
    expect(safeUrl('https://example.com')).toBe('https://example.com');
    expect(safeUrl('/about')).toBe('/about');
    expect(safeUrl('#top')).toBe('#top');
  });

  it('rejects javascript: and other active schemes', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('data:text/html,<script>')).toBe('#');
    expect(safeUrl('vbscript:msgbox')).toBe('#');
  });

  it('rejects protocol-relative URLs (open-redirect / off-site vector)', () => {
    expect(safeUrl('//evil.com')).toBe('#');
    expect(safeUrl('//evil.com/path')).toBe('#');
    // but still allows genuine root-relative paths and the bare root
    expect(safeUrl('/about')).toBe('/about');
    expect(safeUrl('/')).toBe('/');
  });

  it('returns the fallback for empty input', () => {
    expect(safeUrl('', '/home')).toBe('/home');
  });
});

describe('textProp', () => {
  it('reads a static string prop', () => {
    expect(textProp({ text: 'Hi' }, undefined, 'text')).toBe('Hi');
  });

  it('prefers a bound field value when <key>Field is set and an entry is present', () => {
    expect(textProp({ textField: 'title' }, entry, 'text')).toBe('Bound Title');
  });

  it('falls back to the static value when no entry is in context', () => {
    expect(textProp({ text: 'Static', textField: 'title' }, undefined, 'text')).toBe('Static');
  });

  it('returns the fallback when neither static nor bound value exists', () => {
    expect(textProp({}, undefined, 'text', 'default')).toBe('default');
  });

  it('falls back when the bound field is absent from the entry values', () => {
    expect(textProp({ textField: 'missing' }, entry, 'text', 'fallback')).toBe('fallback');
  });
});

describe('urlProp', () => {
  it('sanitizes a static URL', () => {
    expect(urlProp({ href: 'javascript:1' }, undefined, 'href')).toBe('#');
  });

  it('reads and sanitizes a bound URL field', () => {
    expect(urlProp({ hrefField: 'link' }, entry, 'href')).toBe('https://example.com');
  });
});
