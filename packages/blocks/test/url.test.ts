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
});
