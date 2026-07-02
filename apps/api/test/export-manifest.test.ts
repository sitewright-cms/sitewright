import { describe, it, expect } from 'vitest';
import { buildExportManifest, exportBundleOverCap } from '../src/export/manifest.js';
import { EXPORT_BUNDLE_CAPS, type ProjectExportBundle } from '@sitewright/schema';

function emptyBundle(overrides: Partial<ProjectExportBundle> = {}): ProjectExportBundle {
  return {
    formatVersion: 2,
    project: {
      id: 'p1',
      name: 'Acme',
      slug: 'acme',
      identity: { name: 'Acme', colors: {} },
      settings: { defaultLocale: 'en', locales: ['en'] },
    },
    pages: [],
    templates: [],
    snippets: [],
    datasets: [],
    entries: [],
    translations: [],
    forms: [],
    media: [],
    mediaFolders: [],
    ...overrides,
  } as ProjectExportBundle;
}

const project = { id: 'p1', name: 'Acme', slug: 'acme' };

describe('buildExportManifest', () => {
  it('records app version when provided', () => {
    const m = buildExportManifest(project, emptyBundle(), '1.2.3');
    expect(m.app).toBe('1.2.3');
    expect(m.kind).toBe('sitewright-project-export');
    expect(m.mediaSlug).toBe('acme');
    expect(m.counts?.pages).toBe(0);
    expect(m.omitted).toContain('project_smtp_password');
  });

  it('nulls app when the version is undefined', () => {
    const m = buildExportManifest(project, emptyBundle(), undefined);
    expect(m.app).toBeNull();
  });
});

describe('exportBundleOverCap', () => {
  it('returns null when every section is within its cap', () => {
    expect(exportBundleOverCap(emptyBundle())).toBeNull();
  });

  it('names the first section that exceeds its cap', () => {
    const folders = Array.from({ length: EXPORT_BUNDLE_CAPS.mediaFolders + 1 }, (_, i) => ({
      id: `f${i}`,
      path: `d${i}`,
    }));
    const reason = exportBundleOverCap(emptyBundle({ mediaFolders: folders }));
    expect(reason).toContain('mediaFolders');
  });
});
