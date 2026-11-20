import { describe, expect, it } from 'vitest';
import { isGoogleSearchLink, opaqueRedirect, resultUrl } from '../src/rank/providers/google-links.js';

/**
 * Google's own links among results: what is no site's result, and the site a wrapped result names. The `/goto` links
 * are the shape Bright Data returned on 2026-11-17 for "website development namibia" in Namibia.
 */

const GOTO =
  'https://www.google.com/goto?url=CAESWAHEIkXX4TJTXsITnX4Tf1ZHoOCE8KycFAL9IbxPnNB69wVo9t0zh41suX_EB9cP8UihVUF5OP4RJnxsfyNfCRlElWYyEYdUYBK7oCq84ANzD58ZNFd63Gw&gsessionid=lxwxoL4w9ai1Iu02D';

describe('isGoogleSearchLink', () => {
  it('Google Search and Maps themselves are no site’s result; Google’s own sites and wrapped results are', () => {
    expect(isGoogleSearchLink('https://www.google.com/search?q=website+development+namibia&udm=1')).toBe(true);
    expect(isGoogleSearchLink('https://maps.google.com/maps?q=x')).toBe(true);
    expect(isGoogleSearchLink('https://www.google.com.na/maps/place/x')).toBe(true);
    expect(isGoogleSearchLink('https://support.google.com/business/')).toBe(false);
    expect(isGoogleSearchLink(GOTO)).toBe(false); // a result, only wrapped
    expect(isGoogleSearchLink('https://plumbers.na/search')).toBe(false);
  });
});

describe('resultUrl', () => {
  it('leaves a site’s own link as it is', () => {
    expect(resultUrl('https://www.namibiawebdesign.com/', 'https://www.namibiawebdesign.com')).toBe('https://www.namibiawebdesign.com/');
    expect(resultUrl('https://support.google.com/business/')).toBe('https://support.google.com/business/');
  });

  it('reads the address a `/url?q=` redirect wraps', () => {
    expect(resultUrl('https://www.google.com/url?q=https://www.phoenix-tech.net/web-development/&sa=U&ved=x')).toBe('https://www.phoenix-tech.net/web-development/');
    expect(resultUrl('https://www.google.com/url?url=https://asylum.com.na/')).toBe('https://asylum.com.na/');
  });

  it('reads an opaque `/goto` by its displayed address — the site alone when Google cut the path into a breadcrumb', () => {
    expect(resultUrl(GOTO, 'https://www.webnamibia.com')).toBe('https://www.webnamibia.com/');
    expect(resultUrl(GOTO, 'https://www.phoenix-tech.net/web-development/')).toBe('https://www.phoenix-tech.net/web-development/');
    expect(resultUrl(GOTO, 'https://www.treasurehunt-design.com › services › web-de...')).toBe('https://www.treasurehunt-design.com/');
    expect(resultUrl(GOTO, 'www.phoenix-tech.net › blog')).toBe('https://www.phoenix-tech.net/');
    expect(resultUrl(GOTO, 'https://www.phoenix-tech.net/web-develo…')).toBe('https://www.phoenix-tech.net/');
  });

  it('names no site when the wrapped result shows none, or only Google', () => {
    expect(resultUrl(GOTO)).toBeNull();
    expect(resultUrl(GOTO, '')).toBeNull();
    expect(resultUrl(GOTO, 'https://www.google.com')).toBeNull();
    expect(resultUrl(GOTO, 'not a host')).toBeNull();
    expect(resultUrl('https://www.google.com/url?q=javascript:alert(1)')).toBeNull();
    // Cut short inside the host: not the site's host.
    expect(resultUrl(GOTO, 'https://www.some-very-long-domain-na…')).toBeNull();
    // An address with a user part is no displayed site.
    expect(resultUrl(GOTO, 'https://phoenix-tech.net@evil.test')).toBeNull();
  });
});

describe('opaqueRedirect', () => {
  it('is Google’s `/goto` link on a Google Search host, over https', () => {
    expect(opaqueRedirect(GOTO)).toBe(GOTO);
    expect(opaqueRedirect('https://google.com.na/goto?url=CAES')).toBe('https://google.com.na/goto?url=CAES');
  });

  it('is nothing else: a `/url?q=` redirect names its page, and no other host or scheme is asked', () => {
    expect(opaqueRedirect('https://www.google.com/url?q=https://www.phoenix-tech.net/')).toBeUndefined();
    expect(opaqueRedirect('http://www.google.com/goto?url=CAES')).toBeUndefined();
    expect(opaqueRedirect('https://maps.google.com/goto?url=CAES')).toBeUndefined();
    expect(opaqueRedirect('https://www.google.com.evil.test/goto?url=CAES')).toBeUndefined();
    expect(opaqueRedirect('https://www.phoenix-tech.net/goto?url=CAES')).toBeUndefined();
    expect(opaqueRedirect('https://www.google.com/goto/x')).toBeUndefined();
    expect(opaqueRedirect('not a url')).toBeUndefined();
  });
});
