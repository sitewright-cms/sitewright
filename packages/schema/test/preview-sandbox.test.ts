import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PREVIEW_SANDBOX_ATTR, PREVIEW_SANDBOX_CSP, PREVIEW_SANDBOX_TOKENS } from '../src/preview-sandbox.js';

const repoRoot = join(import.meta.dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8');

describe('preview sandbox tokens', () => {
  it('the CSP header value and the iframe attribute carry the SAME token set', () => {
    // The browser INTERSECTS the response CSP's sandbox with the iframe's `sandbox` attribute, and the
    // stricter side wins silently — no console error, the feature simply does nothing. Deriving both
    // from one list is what makes that class of bug impossible; this asserts they stay in step.
    expect(PREVIEW_SANDBOX_CSP).toBe(`sandbox ${PREVIEW_SANDBOX_ATTR}`);
    expect(PREVIEW_SANDBOX_ATTR.split(' ')).toEqual([...PREVIEW_SANDBOX_TOKENS]);
  });

  it('grants downloads, forms and escaping popups', () => {
    // Each of these was measured missing at least once. `allow-downloads` is the newest: without it a
    // `download` link inside a preview is a dead click (no navigation, no file, no error).
    expect(PREVIEW_SANDBOX_TOKENS).toContain('allow-downloads');
    expect(PREVIEW_SANDBOX_TOKENS).toContain('allow-forms');
    expect(PREVIEW_SANDBOX_TOKENS).toContain('allow-popups');
    expect(PREVIEW_SANDBOX_TOKENS).toContain('allow-popups-to-escape-sandbox');
    expect(PREVIEW_SANDBOX_TOKENS).toContain('allow-scripts');
  });

  it('NEVER grants allow-same-origin — the opaque origin is the preview security boundary', () => {
    // A preview document is served from the API's own origin. `allow-same-origin` would let author
    // JS read the editor session and call the API as the signed-in user. This is load-bearing.
    expect(PREVIEW_SANDBOX_TOKENS).not.toContain('allow-same-origin');
    expect(PREVIEW_SANDBOX_CSP).not.toContain('allow-same-origin');
  });

  it('every preview surface uses the shared constants, never a hand-written token list', () => {
    // A literal token list at a call site is exactly how the two sides drifted before. Fail on any
    // reintroduced literal in the source of the surfaces that must match.
    for (const rel of [
      'apps/api/src/http/app.ts',
      'apps/editor/src/views/editor/PreviewPane.tsx',
      'apps/editor/src/views/SitePreview.tsx',
    ]) {
      const src = read(rel);
      const literals = src.match(/['"`]sandbox allow-scripts[^'"`]*['"`]|sandbox="allow-scripts[^"]*"/g) ?? [];
      expect(literals, `${rel} must use PREVIEW_SANDBOX_CSP / PREVIEW_SANDBOX_ATTR`).toEqual([]);
    }
  });
});
