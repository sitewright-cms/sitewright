import { describe, it, expect } from 'vitest';
import { previewUrlFrom } from '../src/api';

describe('previewUrlFrom', () => {
  const base = '/preview-site/p/sig123/';

  it('returns the signed base as-is for the home route', () => {
    expect(previewUrlFrom(base, '')).toMatch(/\/preview-site\/p\/sig123\/$/);
  });

  it('appends a trailing slash to a bare route slug so relative links resolve', () => {
    expect(previewUrlFrom(base, 'about')).toMatch(/\/preview-site\/p\/sig123\/about\/$/);
    expect(previewUrlFrom(base, '/about')).toMatch(/\/preview-site\/p\/sig123\/about\/$/); // leading slash stripped
  });

  it('leaves an already-slashed nested route untouched', () => {
    expect(previewUrlFrom(base, 'de/leistungen/')).toMatch(/\/preview-site\/p\/sig123\/de\/leistungen\/$/);
  });
});
