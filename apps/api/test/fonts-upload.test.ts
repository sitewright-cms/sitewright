import { describe, it, expect } from 'vitest';
import { detectFontFormat, FONT_EXT, MAX_FONT_BYTES } from '../src/fonts/upload.js';

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

  it('maps every format to a container extension + has a sane size cap', () => {
    expect(FONT_EXT).toEqual({ woff2: 'woff2', woff: 'woff', ttf: 'ttf', otf: 'otf' });
    expect(MAX_FONT_BYTES).toBe(5 * 1024 * 1024);
  });
});
