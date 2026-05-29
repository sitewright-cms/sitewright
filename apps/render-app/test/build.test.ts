import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const homePath = fileURLToPath(new URL('../dist/index.html', import.meta.url));
const aboutPath = fileURLToPath(new URL('../dist/about/index.html', import.meta.url));
const featurePath = fileURLToPath(
  new URL('../dist/features/static-first-output/index.html', import.meta.url),
);
const draftFeaturePath = fileURLToPath(
  new URL('../dist/features/draft-feature/index.html', import.meta.url),
);

let home = '';
let about = '';
let feature = '';

describe('static build (integration)', () => {
  beforeAll(async () => {
    // In `verify`/CI the build has already run; only build here if needed so the
    // test is self-contained when run standalone. Check every required output so a
    // stale partial build triggers a rebuild rather than a confusing read error.
    if (![homePath, aboutPath, featurePath].every(existsSync)) {
      await import('../scripts/optimize-media.mjs'); // prebuild: generate media + manifest
      const { build } = await import('astro');
      await build({ root, logLevel: 'error' });
    }
    home = readFileSync(homePath, 'utf8');
    about = readFileSync(aboutPath, 'utf8');
    feature = readFileSync(featurePath, 'utf8');
  }, 120000);

  it('renders the hero', () => {
    expect(home).toContain('We build fast, beautiful websites');
  });

  it('renders published features bound from the dataset, in sorted order', () => {
    const positions = ['Built-in CMS', 'Reusable partials', 'Static-first output'].map((t) =>
      home.indexOf(t),
    );
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('excludes draft entries from the published build', () => {
    expect(home).not.toContain('Unpublished draft');
  });

  it('expands partials (shared header and footer)', () => {
    expect(home).toContain('Northwind');
    expect(home).toContain('built with Sitewright');
  });

  it('injects per-project brand tokens as CSS custom properties', () => {
    expect(home).toContain('--sw-color-primary: #0ea5e9');
  });

  it('ships no external script (static-first output)', () => {
    expect(home).not.toMatch(/<script[^>]*\bsrc=/);
  });

  it('renders the about page', () => {
    expect(about).toContain('About Northwind');
  });

  it('resolves a single-mode binding (about page featured heading)', () => {
    // about-featured binds one feature (sorted title asc -> "Built-in CMS").
    expect(about).toContain('Built-in CMS');
  });

  it('generates a collection-page detail route per published entry', () => {
    expect(feature).toContain('Static-first output'); // title (field-bound)
    expect(feature).toContain('near-zero JavaScript'); // body (field-bound)
  });

  it('does not generate detail pages for draft entries', () => {
    expect(existsSync(draftFeaturePath)).toBe(false);
  });

  it('optimizes media into a <picture> with AVIF/WebP sources and emits the variant files', () => {
    expect(home).toContain('<picture');
    expect(home).toContain('image/avif');
    expect(home).toContain('image/webp');
    expect(home).toContain('/_sw-media/hero/');
    // intrinsic dimensions for CLS-free layout
    expect(home).toMatch(/width="1600"/);
    expect(home).toMatch(/height="900"/);
    const variant = fileURLToPath(
      new URL('../dist/_sw-media/hero/hero-800.webp', import.meta.url),
    );
    expect(existsSync(variant)).toBe(true);
  });
});
