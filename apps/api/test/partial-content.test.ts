import { describe, it, expect } from 'vitest';
import { partialContent } from '../src/http/app.js';

// Range parsing for self-hosted video/audio. This exists because the FIRST cut advertised
// `accept-ranges: bytes` and then ignored `Range:` — the browser believed it could seek, asked for a
// window, got the whole file with a 200, and snapped playback back to 0. Measured on a real 16 MB
// background video before the fix.
const body = Buffer.from('0123456789'); // 10 bytes, so the offsets read at a glance

const range = (h: string | string[] | undefined): { body: Buffer; contentRange: string } => {
  const r = partialContent(body, h);
  if (r === null || r === 'unsatisfiable') throw new Error(`expected a range, got ${String(r)}`);
  return r;
};

describe('partialContent', () => {
  it('returns null when there is no range to honour', () => {
    expect(partialContent(body, undefined)).toBeNull();
    expect(partialContent(body, '')).toBeNull();
    expect(partialContent(body, 'items=0-1')).toBeNull(); // not a BYTE range
    expect(partialContent(body, 'bytes=0-1,4-5')).toBeNull(); // multipart ranges are not supported
  });

  it('serves a closed range inclusively', () => {
    const r = range('bytes=2-4');
    expect(r.body.toString()).toBe('234'); // inclusive of BOTH ends
    expect(r.contentRange).toBe('bytes 2-4/10');
  });

  it('an open-ended range runs to the last byte', () => {
    const r = range('bytes=7-');
    expect(r.body.toString()).toBe('789');
    expect(r.contentRange).toBe('bytes 7-9/10');
  });

  it('a SUFFIX range asks for the last N bytes', () => {
    // `bytes=-3` means the final three bytes, NOT "from 0 to 3" — easy to get backwards, and a player
    // uses exactly this to read a container's trailing index before it can seek.
    const r = range('bytes=-3');
    expect(r.body.toString()).toBe('789');
    expect(r.contentRange).toBe('bytes 7-9/10');
  });

  it('a suffix longer than the file clamps to the whole file', () => {
    const r = range('bytes=-999');
    expect(r.body.toString()).toBe('0123456789');
    expect(r.contentRange).toBe('bytes 0-9/10');
  });

  it('an end past the file is clamped rather than refused', () => {
    const r = range('bytes=8-99');
    expect(r.body.toString()).toBe('89');
    expect(r.contentRange).toBe('bytes 8-9/10');
  });

  it('a start past the end is UNSATISFIABLE, not a silent full response', () => {
    // Answering this with the whole file is what breaks seeking, so it must be an explicit 416.
    expect(partialContent(body, 'bytes=10-')).toBe('unsatisfiable');
    expect(partialContent(body, 'bytes=50-60')).toBe('unsatisfiable');
    expect(partialContent(body, 'bytes=5-2')).toBe('unsatisfiable'); // inverted
  });

  it('handles a header array (duplicate Range headers) by taking the first', () => {
    expect(range(['bytes=0-1', 'bytes=5-6']).contentRange).toBe('bytes 0-1/10');
  });
});
