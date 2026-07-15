import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  MANIFEST_FILENAME,
  computeManifest,
  diffManifests,
  isSafeRel,
  parseManifest,
  parseManifestJson,
  serializeManifest,
  toPosixRel,
  type DeployManifest,
} from '../src/publish/deploy/manifest.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const H = 'a'.repeat(64);

describe('isSafeRel', () => {
  it('accepts confined POSIX relative paths', () => {
    for (const rel of ['index.html', 'about/index.html', 'a/b/c/d.webp', 'deep.name-1_2.js']) {
      expect(isSafeRel(rel)).toBe(true);
    }
  });
  it('rejects absolute, traversal, backslash, control-char, empty-segment, __proto__ and the manifest itself', () => {
    for (const rel of ['', '/etc/passwd', '../secret', 'a/../../b', 'a\\b', 'a//b', 'a/./b', 'x\n.html', '__proto__', 'a/__proto__/b.html', MANIFEST_FILENAME, 'x'.repeat(1025)]) {
      expect(isSafeRel(rel)).toBe(false);
    }
  });
});

describe('toPosixRel', () => {
  it('normalises OS separators to forward slashes', () => {
    expect(toPosixRel('about\\index.html')).toBe('about/index.html');
    expect(toPosixRel('a/b/c')).toBe('a/b/c');
  });
});

describe('computeManifest', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sw-manifest-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('hashes each file (size + sha256) keyed by POSIX rel', async () => {
    await writeFile(join(dir, 'a.html'), 'hello');
    const manifest = await computeManifest([{ rel: 'a.html', abs: join(dir, 'a.html') }]);
    expect(manifest['a.html']).toEqual({ size: 5, hash: sha('hello') });
  });

  it('is stable for identical content and differs for changed content', async () => {
    await writeFile(join(dir, 'a.html'), 'one');
    const m1 = await computeManifest([{ rel: 'a.html', abs: join(dir, 'a.html') }]);
    await writeFile(join(dir, 'a.html'), 'two');
    const m2 = await computeManifest([{ rel: 'a.html', abs: join(dir, 'a.html') }]);
    expect(m1['a.html']!.hash).not.toBe(m2['a.html']!.hash);
  });

  it('excludes the reserved manifest filename so a build can never clobber the state file', async () => {
    await writeFile(join(dir, 'a.html'), 'ok');
    await writeFile(join(dir, MANIFEST_FILENAME), '{"tampered":true}');
    const manifest = await computeManifest([
      { rel: 'a.html', abs: join(dir, 'a.html') },
      { rel: MANIFEST_FILENAME, abs: join(dir, MANIFEST_FILENAME) },
    ]);
    expect(Object.keys(manifest)).toEqual(['a.html']);
  });
});

describe('diffManifests', () => {
  const next: DeployManifest = {
    'index.html': { size: 10, hash: sha('home') },
    'about/index.html': { size: 12, hash: sha('about') },
  };

  it('first deploy (prev null): everything uploads, nothing removed', () => {
    expect(diffManifests(null, next)).toEqual({ upload: ['about/index.html', 'index.html'], remove: [] });
  });

  it('identical prev: nothing to do', () => {
    expect(diffManifests({ ...next }, next)).toEqual({ upload: [], remove: [] });
  });

  it('uploads only content-changed or new files', () => {
    const prev: DeployManifest = { 'index.html': { size: 1, hash: H }, 'about/index.html': next['about/index.html']! };
    expect(diffManifests(prev, next).upload).toEqual(['index.html']);
  });

  it('flags a size-only change (same hash slot, different size) as an upload', () => {
    const prev: DeployManifest = { ...next, 'index.html': { size: 99, hash: next['index.html']!.hash } };
    expect(diffManifests(prev, next).upload).toEqual(['index.html']);
  });

  it('marks files gone from the build for removal — but never an unsafe path', () => {
    const prev: DeployManifest = { ...next, 'old.html': { size: 1, hash: H }, '../evil': { size: 1, hash: H } };
    const { upload, remove } = diffManifests(prev, next);
    expect(upload).toEqual([]);
    expect(remove).toEqual(['old.html']); // '../evil' filtered out by isSafeRel
  });
});

describe('parseManifest / parseManifestJson', () => {
  it('round-trips a serialized manifest', () => {
    const m: DeployManifest = { 'a.html': { size: 3, hash: H } };
    expect(parseManifestJson(serializeManifest(m))).toEqual(m);
  });
  it('returns null for non-objects and bad JSON', () => {
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest([1, 2])).toBeNull();
    expect(parseManifest('nope')).toBeNull();
    expect(parseManifestJson('{not json')).toBeNull();
  });
  it('drops entries with unsafe keys or malformed values (a tampered manifest can only narrow)', () => {
    const parsed = parseManifest({
      'good.html': { size: 4, hash: H },
      '../escape': { size: 4, hash: H }, // unsafe key
      'badsize.html': { size: -1, hash: H }, // negative size
      'badhash.html': { size: 4, hash: 'xyz' }, // not 64 hex
      'nullval.html': null,
    });
    expect(parsed).toEqual({ 'good.html': { size: 4, hash: H } });
  });

  it('drops a __proto__ key and never pollutes the prototype chain', () => {
    const parsed = parseManifest(JSON.parse(`{"__proto__":{"size":5,"hash":"${H}"},"ok.html":{"size":5,"hash":"${H}"}}`));
    expect(parsed).toEqual({ 'ok.html': { size: 5, hash: H } });
    expect(Object.keys(parsed!)).toEqual(['ok.html']); // no '__proto__' own key
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(parsed)).toBeNull(); // built with a null prototype
  });
});
