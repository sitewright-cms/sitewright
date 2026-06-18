import { describe, it, expect } from 'vitest';
import { parsePreviewTarget, buildPreviewUrl } from '../src/lib/preview-target';

describe('parsePreviewTarget', () => {
  it('parses a bare project id (home)', () => {
    expect(parsePreviewTarget('?preview=proj-1')).toEqual({ projectId: 'proj-1', path: '' });
  });
  it('parses a project id with a route path', () => {
    expect(parsePreviewTarget('?preview=proj-1/about')).toEqual({ projectId: 'proj-1', path: 'about' });
    expect(parsePreviewTarget('?preview=proj-1/de/leistungen')).toEqual({ projectId: 'proj-1', path: 'de/leistungen' });
  });
  it('returns null when absent or malformed', () => {
    expect(parsePreviewTarget('?other=1')).toBeNull();
    expect(parsePreviewTarget('')).toBeNull();
    expect(parsePreviewTarget('?preview=')).toBeNull();
    expect(parsePreviewTarget('?preview=/onlyslash')).toBeNull();
  });
});

describe('buildPreviewUrl', () => {
  it('builds a ?preview= URL preserving origin + path', () => {
    expect(buildPreviewUrl('https://app.test', '/', 'proj-1')).toBe('https://app.test/?preview=proj-1');
    expect(buildPreviewUrl('https://app.test', '/editor', 'p 2')).toBe('https://app.test/editor?preview=p%202');
  });
});
