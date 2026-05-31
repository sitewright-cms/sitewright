import { describe, it, expect } from 'vitest';
import { resolveInternalUrl } from '../src/url.js';

describe('resolveInternalUrl', () => {
  it('rewrites root-relative internal links to be page-relative', () => {
    expect(resolveInternalUrl('/about', '../')).toBe('../about');
    expect(resolveInternalUrl('/contact', '../../')).toBe('../../contact');
    expect(resolveInternalUrl('/our-vehicles', '')).toBe('our-vehicles');
  });

  it('maps the home link relative to the current page', () => {
    expect(resolveInternalUrl('/', '')).toBe('./');
    expect(resolveInternalUrl('/', '../')).toBe('../');
    expect(resolveInternalUrl('/', '../../')).toBe('../../');
  });

  it('leaves external and fragment links unchanged', () => {
    expect(resolveInternalUrl('https://example.com/x', '../')).toBe('https://example.com/x');
    expect(resolveInternalUrl('http://example.com', '')).toBe('http://example.com');
    expect(resolveInternalUrl('#section', '../')).toBe('#section');
  });

  it('rejects unsafe and protocol-relative URLs (fallback to #)', () => {
    expect(resolveInternalUrl('javascript:alert(1)', '../')).toBe('#');
    expect(resolveInternalUrl('//evil.com', '../')).toBe('#');
    expect(resolveInternalUrl('', '../')).toBe('#');
  });

  it('rejects root-relative paths that traverse above the site root', () => {
    expect(resolveInternalUrl('/../evil', '')).toBe('#');
    expect(resolveInternalUrl('/a/../b', '../')).toBe('#');
    expect(resolveInternalUrl('/..', '../')).toBe('#');
  });

  it('keeps internal links inside the locale subtree via localePrefix', () => {
    // From /de/index.html (root '../', prefix 'de/'): /about → ../de/about.
    expect(resolveInternalUrl('/about', '../', 'de/')).toBe('../de/about');
    // From /de/about/index.html (root '../../'): /contact → ../../de/contact.
    expect(resolveInternalUrl('/contact', '../../', 'de/')).toBe('../../de/contact');
    // Home within the locale.
    expect(resolveInternalUrl('/', '../', 'de/')).toBe('../de/');
    // Default/empty prefix is identical to no prefix (single-locale no-regression).
    expect(resolveInternalUrl('/about', '../', '')).toBe('../about');
    // External + fragment links ignore the prefix.
    expect(resolveInternalUrl('https://x.io/a', '../', 'de/')).toBe('https://x.io/a');
    expect(resolveInternalUrl('#top', '../', 'de/')).toBe('#top');
  });
});
