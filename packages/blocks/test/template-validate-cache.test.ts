import { describe, it, expect } from 'vitest';
import { validateTemplate, validateTemplateStats, TemplateError } from '../src/index.js';

// `validateTemplate` is a character scan of the whole source, run on EVERY render — including once per
// partial, per route. Pages sharing one `template:` ref render the same source hundreds of times, so an
// 800-route build re-scanned identical strings and a CPU profile put it at 8% of build time after the
// clean-css fix.
// The verdict is a pure function of the source, so it is memoizable — but only if a REJECTION still
// rejects on every later call, which is the property these tests pin.

describe('validateTemplate memoization', () => {
  it('scans a repeated source only once', () => {
    const src = '<p class="x">{{page.title}}</p><!-- unique-pass-marker -->';
    const before = validateTemplateStats().scans;

    validateTemplate(src);
    validateTemplate(src);
    validateTemplate(src);

    expect(validateTemplateStats().scans - before).toBe(1);
  });

  it('KEEPS REJECTING a cached-invalid source — a cache hit must never become a pass', () => {
    const unsafe = '<p>{{{ raw }}}</p><!-- unique-reject-marker -->';

    expect(() => validateTemplate(unsafe)).toThrow(TemplateError);
    // The second call is served from the cache: it must throw the same way, not fall through.
    expect(() => validateTemplate(unsafe)).toThrow(TemplateError);
    expect(() => validateTemplate(unsafe)).toThrow(/raw output/i);
  });

  it('re-reports the ORIGINAL message on a cached rejection', () => {
    const unsafe = '<p>{{{ danger }}}</p><!-- unique-message-marker -->';
    let first = '';
    try {
      validateTemplate(unsafe);
    } catch (err) {
      first = (err as Error).message;
    }
    expect(first).not.toBe('');
    expect(() => validateTemplate(unsafe)).toThrow(first);
  });

  it('judges each DISTINCT source on its own merits (no cross-contamination from a passing neighbour)', () => {
    const safe = '<p>{{page.title}}</p><!-- neighbour-marker -->';
    const unsafe = '<p>{{page.title}}</p><script>var a = {{page.title}};</script><!-- neighbour-marker -->';

    expect(() => validateTemplate(safe)).not.toThrow();
    expect(() => validateTemplate(unsafe)).toThrow(TemplateError);
    expect(() => validateTemplate(safe)).not.toThrow();
  });

  it('bounds the cache so a long-lived process cannot retain every source it ever saw', () => {
    for (let i = 0; i < 600; i++) validateTemplate(`<p data-i="${i}">{{page.title}}</p>`);
    expect(validateTemplateStats().size).toBeLessThanOrEqual(300);
  });

  it('caps RETAINED bytes too — the key is the whole source, so an entry count bounds nothing', () => {
    // 20 sources of ~300 KB sit far under the 300-entry cap while retaining ~6 MB.
    for (let i = 0; i < 20; i++) validateTemplate(`<p data-i="${i}">${'y'.repeat(300_000)}</p>`);
    expect(validateTemplateStats().bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
  });
});
