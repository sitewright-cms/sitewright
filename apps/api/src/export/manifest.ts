import {
  EXPORT_BUNDLE_CAPS,
  PROJECT_EXPORT_FORMAT,
  type ExportManifest,
  type ProjectExportBundle,
} from '@sitewright/schema';
import type { ProjectIdentity } from '../repo/content.js';

/**
 * Returns a human-readable reason if any bundle section exceeds its cap, else null. The caps
 * bound the IMPORT schema, so an export past them would produce a backup that can't be restored
 * — the route fails such an export loudly (413) rather than shipping an un-importable archive.
 */
export function exportBundleOverCap(bundle: ProjectExportBundle): string | null {
  const checks: readonly [string, number, number][] = [
    ['pages', bundle.pages.length, EXPORT_BUNDLE_CAPS.pages],
    ['templates', bundle.templates.length, EXPORT_BUNDLE_CAPS.templates],
    ['snippets', bundle.snippets.length, EXPORT_BUNDLE_CAPS.snippets],
    ['datasets', bundle.datasets.length, EXPORT_BUNDLE_CAPS.datasets],
    ['entries', bundle.entries.length, EXPORT_BUNDLE_CAPS.entries],
    ['translations', bundle.translations.length, EXPORT_BUNDLE_CAPS.translations],
    ['forms', bundle.forms.length, EXPORT_BUNDLE_CAPS.forms],
    ['media', bundle.media.length, EXPORT_BUNDLE_CAPS.media],
    ['mediaFolders', bundle.mediaFolders.length, EXPORT_BUNDLE_CAPS.mediaFolders],
  ];
  for (const [name, count, cap] of checks) {
    if (count > cap) return `${name} (${count} exceeds the ${cap} limit)`;
  }
  return null;
}

/** Sections a project export intentionally never carries (documented in the manifest). */
const OMITTED = [
  'deploy_target_credentials',
  'project_smtp_password',
  'form_submissions',
  'content_revisions',
  'members',
  'invites',
  'api_keys',
] as const;

/**
 * Builds the export zip's `manifest.json` envelope. `exportedAt` is stamped here
 * (route runtime — `Date` is available) and `mediaSlug` records the slug baked
 * into the bundle's `/media/<slug>/…` URLs so import can rewrite them.
 */
export function buildExportManifest(
  project: ProjectIdentity,
  bundle: ProjectExportBundle,
  appVersion: string | undefined,
): ExportManifest {
  return {
    kind: 'sitewright-project-export',
    exportFormat: PROJECT_EXPORT_FORMAT,
    bundleFormat: bundle.formatVersion,
    app: appVersion ?? null,
    exportedAt: new Date().toISOString(),
    source: { id: project.id, name: project.name, slug: project.slug },
    mediaSlug: project.slug,
    counts: {
      pages: bundle.pages.length,
      templates: bundle.templates.length,
      snippets: bundle.snippets.length,
      datasets: bundle.datasets.length,
      entries: bundle.entries.length,
      translations: bundle.translations.length,
      forms: bundle.forms.length,
      media: bundle.media.length,
      mediaFolders: bundle.mediaFolders.length,
    },
    omitted: [...OMITTED],
  };
}
