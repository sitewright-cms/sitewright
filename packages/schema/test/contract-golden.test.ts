import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  DatasetSchema,
  EntrySchema,
  FormSchema,
  ImageMapSchema,
  MediaAssetSchema,
  PageSchema,
  PageTranslationSchema,
  ProjectExportBundleSchema,
  SnippetSchema,
  TemplateSchema,
} from '../src/index.js';

/**
 * The compatibility promise Zod cannot make for itself.
 *
 * A Zod schema describes the shape NOW. It will happily tighten — narrow an enum, promote an
 * optional field to required, drop a key — and report nothing, because it has no memory of what it
 * used to accept. "Documents written by an older version still load" is a claim about the PAST, and
 * the only way to check it is to keep documents written by the past and parse them.
 *
 * Each fixture is named for the version that produced it. They are append-only: see
 * contract/README.md for why editing one to make a test pass destroys the evidence it exists for.
 */
const goldenDir = (kind: string): string => fileURLToPath(new URL(`../../../contract/golden/${kind}`, import.meta.url));

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  page: PageSchema,
  template: TemplateSchema,
  snippet: SnippetSchema,
  translation: PageTranslationSchema,
  dataset: DatasetSchema,
  entry: EntrySchema,
  form: FormSchema,
  imagemap: ImageMapSchema,
  media: MediaAssetSchema,
};

/** `<kind>.<version>.json` — the kind picks the schema, the version says what wrote it. */
function goldenFiles(dir: string): { file: string; kind: string; version: string }[] {
  return readdirSync(goldenDir(dir))
    .filter((f) => f.endsWith('.json'))
    .map((file) => {
      const [kind, version] = file.replace(/\.json$/, '').split('.');
      return { file, kind: kind ?? '', version: version ?? '' };
    });
}

describe('contract: golden documents still parse', () => {
  const files = goldenFiles('content');

  it('has a corpus to check', () => {
    // A guard that silently checks nothing is worse than no guard: it reports success forever.
    expect(files.length, 'contract/golden/content is empty — the guard would pass vacuously').toBeGreaterThan(0);
  });

  for (const { file, kind, version } of files) {
    it(`${file} (written by ${version}) validates against the current ${kind} schema`, () => {
      const schema = SCHEMAS[kind];
      expect(schema, `no schema mapped for golden kind "${kind}"`).toBeDefined();
      const raw: unknown = JSON.parse(readFileSync(`${goldenDir('content')}/${file}`, 'utf8'));
      const parsed = schema!.safeParse(raw);
      expect(
        parsed.success ? null : JSON.stringify(parsed.error.issues, null, 2),
        `${file} no longer validates. A document a released version wrote must keep loading — this is\n` +
          `a BREAKING change unless the schema is fixed to accept it again. See contract/README.md.`,
      ).toBeNull();
    });
  }
});

describe('contract: golden export bundles still import', () => {
  const files = goldenFiles('bundles');

  it('has a corpus to check', () => {
    expect(files.length, 'contract/golden/bundles is empty — the guard would pass vacuously').toBeGreaterThan(0);
  });

  for (const { file, version } of files) {
    it(`${file} (exported by ${version}) still validates as a bundle`, () => {
      const raw: unknown = JSON.parse(readFileSync(`${goldenDir('bundles')}/${file}`, 'utf8'));
      const parsed = ProjectExportBundleSchema.safeParse(raw);
      expect(
        parsed.success ? null : JSON.stringify(parsed.error.issues, null, 2),
        `${file} no longer imports. A project exported by a released version must stay importable —\n` +
          `bumping formatVersion without keeping a reader for the old one is a BREAKING change.`,
      ).toBeNull();
    });
  }
});
