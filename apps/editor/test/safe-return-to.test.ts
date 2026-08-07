import { describe, it, expect } from 'vitest';
import { safeReturnTo } from '../src/App';

describe('safeReturnTo (post-login return URL)', () => {
  it('accepts the OAuth consent endpoint it was built for', () => {
    const next = '/oauth/authorize?client_id=sitewright-cli&response_type=code&code_challenge=abc';
    expect(safeReturnTo(`?next=${encodeURIComponent(next)}`)).toBe(next);
  });

  it('is null when there is no next param', () => {
    expect(safeReturnTo('')).toBeNull();
    expect(safeReturnTo('?foo=1')).toBeNull();
  });

  it('REFUSES anything that could navigate off this origin', () => {
    // `//host` is scheme-relative: same-origin to a naive "starts with /" check, off-site to a browser.
    for (const hostile of [
      '//evil.test/steal',
      'https://evil.test/steal',
      'http://evil.test',
      '/\\evil.test',
      'javascript:alert(1)',
      '\t/oauth/authorize?x=1',
    ]) {
      expect(safeReturnTo(`?next=${encodeURIComponent(hostile)}`), hostile).toBeNull();
    }
  });

  it('REFUSES same-origin paths outside the one allowed flow', () => {
    // The allow-list is one endpoint on purpose — nothing else ever hands the SPA a return URL.
    for (const other of ['/', '/projects', '/oauth/token', '/oauth/authorized?x=1', '/oauth/authorize']) {
      expect(safeReturnTo(`?next=${encodeURIComponent(other)}`), other).toBeNull();
    }
  });
});
