import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FontStore } from '../src/fonts/store.js';
import { detectFontFormat, storeLocalFont, FontUploadError, MAX_FONT_BYTES } from '../src/fonts/upload.js';

const magic = (head: number[] | string, rest = 'data') =>
  Buffer.concat([typeof head === 'string' ? Buffer.from(head) : Buffer.from(head), Buffer.from(rest)]);

describe('detectFontFormat (magic bytes, not extension/mimetype)', () => {
  it('recognizes woff2 / woff / otf / ttf', () => {
    expect(detectFontFormat(magic('wOF2'))).toBe('woff2');
    expect(detectFontFormat(magic('wOFF'))).toBe('woff');
    expect(detectFontFormat(magic('OTTO'))).toBe('otf');
    expect(detectFontFormat(magic([0x00, 0x01, 0x00, 0x00]))).toBe('ttf'); // sfnt 1.0
    expect(detectFontFormat(magic('true'))).toBe('ttf');
    expect(detectFontFormat(magic('ttcf'))).toBe('ttf');
  });

  it('rejects non-fonts (disguised html/exe/empty)', () => {
    expect(detectFontFormat(Buffer.from('<html>'))).toBeNull();
    expect(detectFontFormat(magic([0x4d, 0x5a, 0x90, 0x00]))).toBeNull(); // MZ (PE/exe)
    expect(detectFontFormat(Buffer.from('ab'))).toBeNull(); // too short
  });
});

describe('storeLocalFont', () => {
  let root: string;
  let store: FontStore;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sw-upl-'));
    store = new FontStore(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores a valid font and returns a local record with a generated id + file name', async () => {
    const rec = await storeLocalFont(store, { family: 'Boombox', fallback: 'sans-serif', weight: 700, style: 'normal', data: magic('wOF2') });
    expect(rec.id).toMatch(/^up-[0-9a-f]+$/);
    expect(rec.source).toBe('local');
    expect(rec.files).toEqual([{ weight: 700, style: 'normal', format: 'woff2', file: '700.woff2' }]);
    expect(await store.has(rec.id, '700.woff2')).toBe(true);
  });

  it('names an italic face <weight>-italic.<ext>', async () => {
    const rec = await storeLocalFont(store, { family: 'Boombox', fallback: 'serif', weight: 400, style: 'italic', data: magic([0x00, 0x01, 0x00, 0x00]) });
    expect(rec.files[0]).toMatchObject({ format: 'ttf', file: '400-italic.ttf' });
  });

  it('rejects a non-font payload (magic-byte mismatch)', async () => {
    await expect(
      storeLocalFont(store, { family: 'X', fallback: 'serif', weight: 400, style: 'normal', data: Buffer.from('<svg/>') }),
    ).rejects.toBeInstanceOf(FontUploadError);
  });

  it('rejects an over-cap upload before writing', async () => {
    const big = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(MAX_FONT_BYTES + 1)]);
    await expect(storeLocalFont(store, { family: 'X', fallback: 'serif', weight: 400, style: 'normal', data: big })).rejects.toThrow(/size limit/);
  });

  it('rejects a family that could break out of CSS (schema re-validation)', async () => {
    await expect(
      storeLocalFont(store, { family: 'Evil"}', fallback: 'serif', weight: 400, style: 'normal', data: magic('wOF2') }),
    ).rejects.toBeInstanceOf(FontUploadError);
  });
});
