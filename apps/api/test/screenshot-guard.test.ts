import { describe, it, expect } from 'vitest';
import { isPrivateIp, isRequestAllowed, injectBaseHref } from '../src/render/screenshot.js';

describe('isPrivateIp', () => {
  it('flags loopback / private / link-local / reserved ranges', () => {
    for (const ip of [
      '0.0.0.0',
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '100.64.0.1', // CGNAT
      '240.0.0.1', // class E / reserved
      '255.255.255.255', // broadcast / reserved
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      '::ffff:127.0.0.1', // IPv4-mapped loopback (dotted)
      '::ffff:7f00:1', // IPv4-mapped loopback (hex group) === 127.0.0.1
      '::ffff:0a00:0001', // IPv4-mapped 10.0.0.1 (hex group)
      '[::1]', // bracketed (as URL.hostname yields)
      '[::ffff:7f00:1]',
      // IPv6 forms that EMBED an IPv4 — each reaches the embedded address on a network that routes it,
      // so a private v4 must not be smuggled through inside a v6 literal.
      '::10.0.0.1', // IPv4-COMPATIBLE (deprecated) — 10.0.0.1
      '::0a00:0001', // same, hex-group spelling
      '2002:0a00:0001::', // 6to4 wrapping 10.0.0.1
      '2002:7f00:1::', // 6to4 wrapping 127.0.0.1
      '2002:a9fe:a9fe::', // 6to4 wrapping 169.254.169.254 (cloud metadata)
      '64:ff9b::a00:1', // NAT64 well-known prefix wrapping 10.0.0.1
      '64:ff9b::10.0.0.1', // same, dotted tail
      '64:ff9b:1::a00:1', // NAT64 local-use prefix (RFC 8215)
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const ip of [
      '8.8.8.8',
      '1.1.1.1',
      '93.184.216.34',
      '172.32.0.1',
      '2606:4700:4700::1111',
      '[2606:4700:4700::1111]',
      // The embedding forms must stay usable when what they wrap is PUBLIC — the rule is "judge the
      // embedded address", not "reject the prefix".
      '::ffff:8.8.8.8',
      '2002:5db8:d822::', // 6to4 wrapping 93.184.216.34
      '64:ff9b::8.8.8.8', // NAT64 wrapping 8.8.8.8
    ]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});

describe('isRequestAllowed (SSRF guard)', () => {
  const ORIGIN = '127.0.0.1:80';
  const resolve = (map: Record<string, string[]>) => async (host: string) => map[host] ?? Promise.reject(new Error('NXDOMAIN'));

  it('allows the API’s own loopback origin (self-hosted media) without resolving', async () => {
    expect(await isRequestAllowed('http://127.0.0.1:80/media/x.jpg', ORIGIN)).toBe(true);
  });

  it('blocks OTHER loopback ports (e.g. an internal DB) even though the API is on loopback', async () => {
    expect(await isRequestAllowed('http://127.0.0.1:5432/', ORIGIN)).toBe(false);
  });

  it('blocks a hostname that resolves to a private IP; allows one that resolves public', async () => {
    const r = resolve({ 'internal.svc': ['10.0.0.5'], 'cdn.example.com': ['93.184.216.34'] });
    expect(await isRequestAllowed('http://internal.svc/secret', ORIGIN, r)).toBe(false);
    expect(await isRequestAllowed('https://cdn.example.com/p.jpg', ORIGIN, r)).toBe(true);
  });

  it('blocks if ANY resolved IP is private (DNS-rebinding safe)', async () => {
    const r = resolve({ 'mixed.example': ['93.184.216.34', '10.0.0.1'] });
    expect(await isRequestAllowed('http://mixed.example/x', ORIGIN, r)).toBe(false);
  });

  it('blocks literal private/link-local IPs and non-http(s) schemes; allows data: and public IPs', async () => {
    expect(await isRequestAllowed('http://169.254.169.254/latest/meta-data/', ORIGIN)).toBe(false);
    expect(await isRequestAllowed('http://[::1]:80/', ORIGIN)).toBe(false); // bracketed IPv6 loopback
    expect(await isRequestAllowed('http://[::ffff:7f00:1]/', ORIGIN)).toBe(false); // hex IPv4-mapped loopback
    expect(await isRequestAllowed('http://8.8.8.8/', ORIGIN)).toBe(true);
    expect(await isRequestAllowed('file:///etc/passwd', ORIGIN)).toBe(false);
    expect(await isRequestAllowed('data:image/png;base64,AAAA', ORIGIN)).toBe(true);
  });

  it('blocks an unresolvable host', async () => {
    expect(await isRequestAllowed('http://nope.invalid/x', ORIGIN, resolve({}))).toBe(false);
  });
});

describe('injectBaseHref', () => {
  it('inserts a <base> right after <head> so relative media resolves to the API origin', () => {
    const out = injectBaseHref('<html><head><title>t</title></head><body>x</body></html>', '127.0.0.1:80');
    expect(out).toContain('<head><base href="http://127.0.0.1:80/">');
    expect(out.indexOf('<base')).toBeLessThan(out.indexOf('<title>'));
  });

  it('falls back to prepending when there is no <head>', () => {
    const out = injectBaseHref('<body>x</body>', '127.0.0.1:3000');
    expect(out.startsWith('<base href="http://127.0.0.1:3000/">')).toBe(true);
  });
});
