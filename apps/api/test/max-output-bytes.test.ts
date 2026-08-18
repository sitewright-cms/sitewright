import { describe, it, expect } from 'vitest';
import { configuredMaxOutputBytes } from '../src/publish/build.js';

/**
 * The build's output cap.
 *
 * ★ This existed as a hard-coded 100 MiB whose own comment said "operator-configurable" — nothing
 * wired it to anything. A 1,162-page bilingual site generates ~102 MiB of HTML, so every build threw,
 * `ensurePreviewBuild` swallowed it into a cooldown, and the preview kept serving the last successful
 * build. The author sees a site missing content that is in fact present, and the only diagnostic was a
 * log line reading "published site exceeds the maximum output size" with no size, no limit and no knob.
 */
describe('configuredMaxOutputBytes', () => {
  it('defaults to 512 MiB — big enough for an ordinary large multilingual site', () => {
    expect(configuredMaxOutputBytes({})).toBe(512 * 1024 * 1024);
  });

  it('is genuinely operator-configurable, in MiB', () => {
    expect(configuredMaxOutputBytes({ SW_MAX_OUTPUT_MB: '1024' })).toBe(1024 * 1024 * 1024);
    expect(configuredMaxOutputBytes({ SW_MAX_OUTPUT_MB: '64' })).toBe(64 * 1024 * 1024);
  });

  it('ignores junk rather than collapsing the cap to zero (which would fail every build)', () => {
    for (const v of ['', 'lots', '-5', '0', 'NaN', '1e999']) {
      expect(configuredMaxOutputBytes({ SW_MAX_OUTPUT_MB: v })).toBe(512 * 1024 * 1024);
    }
  });

  it('truncates a fractional value instead of writing a non-integer byte budget', () => {
    expect(configuredMaxOutputBytes({ SW_MAX_OUTPUT_MB: '10.9' })).toBe(10 * 1024 * 1024);
  });
});
