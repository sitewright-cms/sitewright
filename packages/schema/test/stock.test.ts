import { describe, it, expect } from 'vitest';
import { StockProviderNameSchema, StockSearchProviderSchema, StockImportSchema } from '../src/stock.js';
import {
  InstanceSettingsInputSchema,
  InstanceSettingsStoredSchema,
  maskInstanceSettings,
  type InstanceSettingsStored,
} from '../src/instance-settings.js';
import { MediaAssetSchema } from '../src/media.js';

describe('StockProviderNameSchema + StockImportSchema', () => {
  it('accepts the three providers and rejects others', () => {
    expect(StockProviderNameSchema.parse('openverse')).toBe('openverse');
    expect(() => StockProviderNameSchema.parse('shutterstock')).toThrow();
  });

  it('validates an import body', () => {
    expect(StockImportSchema.parse({ provider: 'unsplash', id: 'abc', alt: 'A cat' })).toMatchObject({ provider: 'unsplash', id: 'abc' });
    expect(() => StockImportSchema.parse({ provider: 'unsplash' })).toThrow(); // id required
  });

  it('SEARCH additionally accepts `all`, but an IMPORT does not (ids are per-provider)', () => {
    expect(StockSearchProviderSchema.parse('all')).toBe('all');
    expect(StockSearchProviderSchema.parse('pexels')).toBe('pexels');
    expect(() => StockSearchProviderSchema.parse('shutterstock')).toThrow();
    // `all` cannot name a photo — every concrete provider stays valid for an import, 'all' does not.
    expect(() => StockProviderNameSchema.parse('all')).toThrow();
    expect(() => StockImportSchema.parse({ provider: 'all', id: 'abc' })).toThrow();
  });

  it('every concrete provider is searchable (the two enums cannot drift apart)', () => {
    for (const name of StockProviderNameSchema.options) {
      expect(StockSearchProviderSchema.parse(name)).toBe(name);
    }
    expect(StockSearchProviderSchema.options).toHaveLength(StockProviderNameSchema.options.length + 1);
  });
});

describe('instance-settings stock keys', () => {
  it('accepts plaintext provider keys on input', () => {
    expect(InstanceSettingsInputSchema.parse({ stock: { unsplash: 'ak', pexels: 'pk' } })).toEqual({
      stock: { unsplash: 'ak', pexels: 'pk' },
    });
    expect(InstanceSettingsInputSchema.parse({ stock: null })).toEqual({ stock: null });
  });

  it('masks stored stock keys to presence flags (never the ciphertext)', () => {
    const enc = { iv: 'aXY=', ct: 'Y3Q=', tag: 'dGFn' };
    const stored: InstanceSettingsStored = {
      formModes: { globalSmtp: false, userSmtp: false, contactPhp: false, contactPhpSmtp: false, thirdParty: false, whatsapp: false },
      stock: { unsplash: enc },
    };
    const masked = maskInstanceSettings(stored);
    expect(masked.stock).toEqual({ hasUnsplash: true, hasPexels: false });
    expect(JSON.stringify(masked)).not.toContain(enc.ct);
  });

  it('stored stock section validates as encrypted envelopes', () => {
    const enc = { iv: 'aXY=', ct: 'Y3Q=', tag: 'dGFn' };
    expect(InstanceSettingsStoredSchema.parse({ stock: { pexels: enc } }).stock?.pexels).toEqual(enc);
  });
});

describe('MediaAsset attribution', () => {
  const base = {
    kind: 'image' as const,
    id: 'm1',
    filename: 'cat.jpg',
    format: 'jpeg',
    bytes: 1234,
    width: 800,
    height: 600,
    hasAlpha: false,
    animated: false,
    original: 'cat.jpg',
    url: '/media/p1/m1/cat.jpg',
  };
  it('accepts optional attribution and rejects a non-url source', () => {
    const ok = MediaAssetSchema.parse({ ...base, attribution: { provider: 'unsplash', author: 'Jane', sourceUrl: 'https://unsplash.com/photos/abc', license: 'Unsplash License' } });
    expect(ok.attribution?.author).toBe('Jane');
    expect(() => MediaAssetSchema.parse({ ...base, attribution: { provider: 'x', author: 'a', sourceUrl: 'not-a-url', license: 'l' } })).toThrow();
    expect(MediaAssetSchema.parse(base).attribution).toBeUndefined();
  });
});
