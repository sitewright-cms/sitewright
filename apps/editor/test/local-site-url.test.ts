import { describe, it, expect } from 'vitest';
import { localSiteUrl, localSiteLabel } from '../src/lib/local-site-url';

const https = { protocol: 'https:', port: '' };
const withPort = { protocol: 'http:', port: '2003' };

describe('localSiteUrl', () => {
  it('names the subdomain when subdomain routing is on', () => {
    // `/sites/<slug>/` only 301-redirects here, so this is the address to advertise.
    expect(localSiteUrl('acme', 'sites.example', https)).toBe('https://acme.sites.example/');
  });

  it('carries a non-standard port through', () => {
    expect(localSiteUrl('acme', 'sites.example', withPort)).toBe('http://acme.sites.example:2003/');
  });

  it('falls back to the path form when no sites domain is configured', () => {
    // Not a redirect then — the path form is the real address.
    expect(localSiteUrl('acme', undefined, https)).toBe('/sites/acme/');
    expect(localSiteUrl('acme', '', https)).toBe('/sites/acme/');
  });
});

describe('localSiteLabel', () => {
  it('is the bare host when subdomains are on, and the path otherwise', () => {
    expect(localSiteLabel('acme', 'sites.example')).toBe('acme.sites.example');
    expect(localSiteLabel('acme')).toBe('/sites/acme/');
  });
});
