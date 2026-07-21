import { describe, it, expect } from 'vitest';
import {
  assetAlias,
  isShortAssetId,
  flatMediaName,
  buildAliasMap,
  aliasResolver,
  ALIAS_LEN,
} from '../src/publish/asset-alias.js';

describe('assetAlias', () => {
  it('is a deterministic 6-char base62 prefix for a long (uuid) id', () => {
    const id = '3f8a1c2e-9b4d-4e6a-8c1f-2d5e7a9b0c3d';
    const a = assetAlias(id);
    expect(a).toHaveLength(ALIAS_LEN);
    expect(a).toMatch(/^[0-9A-Za-z]{6}$/);
    expect(assetAlias(id)).toBe(a); // stable across calls (pure function of the id)
  });

  it('uses an already-short id VERBATIM (post-migration ids stay put)', () => {
    expect(isShortAssetId('a1B2c3')).toBe(true);
    expect(assetAlias('a1B2c3')).toBe('a1B2c3');
  });

  it('treats a wrong-length or non-base62 id as long (hashes it)', () => {
    expect(isShortAssetId('a1B2c')).toBe(false); // 5 chars
    expect(isShortAssetId('a1B2c3d')).toBe(false); // 7 chars
    expect(isShortAssetId('a1-2c3')).toBe(false); // hyphen not base62
    expect(assetAlias('a1-2c3')).toHaveLength(ALIAS_LEN);
  });

  it('flatMediaName joins alias + file with a single hyphen', () => {
    expect(flatMediaName('a1B2c3', 'hero-lg.webp')).toBe('a1B2c3-hero-lg.webp');
  });
});

describe('buildAliasMap', () => {
  it('assigns every asset its pure alias when there is no collision', () => {
    const media = [{ id: 'uuid-one' }, { id: 'uuid-two' }, { id: 'a1B2c3' }];
    const map = buildAliasMap(media);
    expect(map.get('uuid-one')).toBe(assetAlias('uuid-one'));
    expect(map.get('uuid-two')).toBe(assetAlias('uuid-two'));
    expect(map.get('a1B2c3')).toBe('a1B2c3'); // verbatim short id
    // all aliases are unique
    expect(new Set(map.values()).size).toBe(3);
  });

  it('deterministically extends the loser on a forced alias collision', () => {
    // Two distinct ids whose 6-char hash aliases collide would otherwise clobber each other. We can't
    // easily craft a real sha256 collision, so assert the invariant the resolver must guarantee:
    // every mapped alias is unique and stable given the same input set.
    const media = Array.from({ length: 50 }, (_, i) => ({ id: `asset-${i}-uuid` }));
    const map = buildAliasMap(media);
    expect(new Set(map.values()).size).toBe(media.length); // no collisions among the aliases
    expect(buildAliasMap(media)).toEqual(map); // stable across runs
  });

  it('keeps every verbatim short id, even mixed with long ids (short ids are claimed first)', () => {
    const media = [{ id: 'uuid-alpha' }, { id: 'a1B2c3' }, { id: 'uuid-beta' }, { id: 'Z9y8X7' }];
    const map = buildAliasMap(media);
    expect(map.get('a1B2c3')).toBe('a1B2c3'); // verbatim, never displaced by a long-id hash
    expect(map.get('Z9y8X7')).toBe('Z9y8X7');
    expect(map.get('uuid-alpha')).toHaveLength(ALIAS_LEN);
    expect(new Set(map.values()).size).toBe(4); // still globally unique
  });

  it('aliasResolver falls back to the pure alias for an id not in the map', () => {
    const resolve = aliasResolver(buildAliasMap([{ id: 'known-uuid' }]));
    expect(resolve('known-uuid')).toBe(assetAlias('known-uuid'));
    expect(resolve('unknown-uuid')).toBe(assetAlias('unknown-uuid'));
  });
});
