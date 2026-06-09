import { describe, it, expect } from 'vitest';
import { ProjectSchema, PROJECT_FORMAT_VERSION } from '../src/project.js';
import { DEFAULT_BRAND_COLORS } from '../src/corporate-identity.js';

const base = {
  formatVersion: PROJECT_FORMAT_VERSION,
  id: 'p1',
  name: 'Acme',
  slug: 'acme',
  identity: { name: 'Acme' },
};

describe('ProjectSchema', () => {
  it('parses a project and applies setting + identity defaults', () => {
    const p = ProjectSchema.parse(base);
    expect(p.settings.defaultLocale).toBe('en');
    expect(p.settings.locales).toEqual(['en']);
    expect(p.identity.colors).toEqual(DEFAULT_BRAND_COLORS);
  });

  it('preserves explicit settings', () => {
    const p = ProjectSchema.parse({
      ...base,
      settings: { defaultLocale: 'de', locales: ['de', 'en'] },
    });
    expect(p.settings.defaultLocale).toBe('de');
    expect(p.settings.locales).toEqual(['de', 'en']);
  });

  it('rejects an unsupported format version', () => {
    expect(() => ProjectSchema.parse({ ...base, formatVersion: 999 })).toThrow();
  });

  it('requires an identity name', () => {
    expect(() => ProjectSchema.parse({ ...base, identity: {} })).toThrow();
  });

  it('rejects a defaultLocale that is not in locales', () => {
    expect(() =>
      ProjectSchema.parse({
        ...base,
        settings: { defaultLocale: 'fr', locales: ['en', 'de'] },
      }),
    ).toThrow();
  });

  it('rejects an invalid slug', () => {
    expect(() => ProjectSchema.parse({ ...base, slug: 'Not A Slug' })).toThrow();
  });
});
