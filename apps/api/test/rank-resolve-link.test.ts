import { describe, expect, it } from 'vitest';
import { resolveRedirect } from '../src/rank/resolve-link.js';
import type { RankProviderIo } from '../src/rank/providers/types.js';

/**
 * The page behind Google's `/goto` redirect, for the site's own result. Measured 2026-11-20: Google answered one such
 * link from Bright Data's results with 302 → the site's page, in under a second, whatever the user agent.
 */

const GOTO = 'https://www.google.com/goto?url=CAESjAEBxCJF1zRbEalpM9x9&gsessionid=Gosyt0H0VNa6';
const SITE = { domain: 'phoenix-tech.net', includeSubdomains: true };
const PAGE = 'https://www.phoenix-tech.net/software/for-educational-institutes/moodle-hosting/';

type Answer = { status: number; location?: string } | Error;

function io(answer: Answer): RankProviderIo & { calls: Array<{ url: string; method: string; headers: Record<string, string> }> } {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, method: init.method, headers: init.headers });
      if (answer instanceof Error) throw answer;
      return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, ...(answer.location ? { location: answer.location } : {}), text: async () => '' };
    },
  };
}

describe('resolveRedirect', () => {
  it('reads the page Google redirects to, asking once without credentials', async () => {
    const fake = io({ status: 302, location: PAGE });
    expect(await resolveRedirect(GOTO, SITE, fake)).toBe(PAGE);
    expect(fake.calls).toEqual([{ url: GOTO, method: 'GET', headers: {} }]);
  });

  it('accepts a page of a subdomain only when subdomains count', async () => {
    const sub = 'https://shop.phoenix-tech.net/cart/';
    expect(await resolveRedirect(GOTO, SITE, io({ status: 301, location: sub }))).toBe(sub);
    expect(await resolveRedirect(GOTO, { ...SITE, includeSubdomains: false }, io({ status: 301, location: sub }))).toBeNull();
  });

  it('keeps nothing that is not a page of the site the check is for', async () => {
    for (const location of [
      'https://www.other-site.test/page/',
      'https://phoenix-tech.net.evil.test/',
      'https://user:pw@www.phoenix-tech.net/',
      'javascript:alert(1)',
      'ftp://www.phoenix-tech.net/file',
      '/sorry/index?continue=x', // relative: one of Google's own pages
      'not a url',
    ]) {
      expect(await resolveRedirect(GOTO, SITE, io({ status: 302, location })), location).toBeNull();
    }
  });

  it('is null when Google answers without a redirect, or not at all', async () => {
    expect(await resolveRedirect(GOTO, SITE, io({ status: 200 }))).toBeNull();
    expect(await resolveRedirect(GOTO, SITE, io({ status: 429 }))).toBeNull();
    expect(await resolveRedirect(GOTO, SITE, io({ status: 302 }))).toBeNull();
    expect(await resolveRedirect(GOTO, SITE, io(new Error('the payment provider could not be reached')))).toBeNull();
  });

  it('asks nothing for a link that is not Google’s `/goto`', async () => {
    for (const link of ['https://www.phoenix-tech.net/', 'https://www.google.com/url?q=https://x.test/', 'http://www.google.com/goto?url=x', 'https://evil.test/goto?url=x']) {
      const fake = io({ status: 302, location: PAGE });
      expect(await resolveRedirect(link, SITE, fake), link).toBeNull();
      expect(fake.calls).toEqual([]);
    }
  });
});
