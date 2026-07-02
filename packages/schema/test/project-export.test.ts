import { describe, it, expect } from 'vitest';
import {
  ProjectExportBundleSchema,
  EXPORT_BUNDLE_CAPS,
} from '../src/project-export.js';
import { PROJECT_FORMAT_VERSION } from '../src/project.js';

const minimalProject = {
  id: 'p1',
  name: 'Acme',
  slug: 'acme',
  identity: { name: 'Acme', colors: { primary: '#0a7' } },
  settings: { defaultLocale: 'en', locales: ['en'] },
};

describe('ProjectExportBundleSchema', () => {
  it('parses a bundle with only the project, defaulting every section to []', () => {
    const parsed = ProjectExportBundleSchema.parse({
      formatVersion: PROJECT_FORMAT_VERSION,
      project: minimalProject,
    });
    expect(parsed.project.slug).toBe('acme');
    for (const key of [
      'pages',
      'templates',
      'snippets',
      'datasets',
      'entries',
      'translations',
      'forms',
      'media',
      'mediaFolders',
    ] as const) {
      expect(parsed[key]).toEqual([]);
    }
  });

  it('carries the whole-project sections through a round-trip', () => {
    const parsed = ProjectExportBundleSchema.parse({
      formatVersion: PROJECT_FORMAT_VERSION,
      project: minimalProject,
      pages: [{ id: 'home', path: '', title: 'Home' }],
      snippets: [{ id: 'hero', name: 'hero', source: '<div>hi</div>' }],
      translations: [{ id: 'home__de', pageId: 'home', locale: 'de', title: 'Start' }],
      forms: [
        { id: 'contact', name: 'Contact', fields: [{ name: 'email', label: 'Email' }], recipient: 'o@acme.test' },
      ],
      mediaFolders: [{ id: 'f1', path: 'docs' }],
    });
    expect(parsed.snippets.map((s) => s.name)).toEqual(['hero']);
    expect(parsed.translations[0]?.id).toBe('home__de');
    expect(parsed.forms[0]?.id).toBe('contact');
    expect(parsed.mediaFolders[0]?.path).toBe('docs');
  });

  it('folds a legacy pre-v2 {brand,company} project into identity', () => {
    const parsed = ProjectExportBundleSchema.parse({
      formatVersion: PROJECT_FORMAT_VERSION,
      project: {
        id: 'p1',
        name: 'Acme',
        slug: 'acme',
        brand: { name: 'Acme', colors: { primary: '#0a7' } },
        settings: { defaultLocale: 'en', locales: ['en'] },
      },
    });
    expect(parsed.project.identity.name).toBe('Acme');
  });

  it('rejects a section that exceeds its cap', () => {
    const tooManyFolders = Array.from({ length: EXPORT_BUNDLE_CAPS.mediaFolders + 1 }, (_, i) => ({
      id: `f${i}`,
      path: `d${i}`,
    }));
    expect(() =>
      ProjectExportBundleSchema.parse({
        formatVersion: PROJECT_FORMAT_VERSION,
        project: minimalProject,
        mediaFolders: tooManyFolders,
      }),
    ).toThrow();
  });
});
