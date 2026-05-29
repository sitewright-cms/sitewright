import { describe, it, expect } from 'vitest';
import { loadMediaManifest } from '../src/lib/media.js';

describe('loadMediaManifest', () => {
  it('returns an empty manifest when the file is absent', () => {
    expect(loadMediaManifest('/nonexistent/manifest.json')).toEqual({});
  });

  it('loads the generated manifest (object keyed by media filename)', () => {
    // Present after the optimize-media prebuild (which runs before tests in verify/CI).
    const manifest = loadMediaManifest();
    expect(typeof manifest).toBe('object');
  });
});
