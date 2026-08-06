import { describe, it, expect } from 'vitest';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import {
  renderPlatformSecurityTxt,
  parseSecurityContacts,
  UPSTREAM_SECURITY_CONTACT,
  UPSTREAM_SECURITY_POLICY,
  PLATFORM_SECURITY_TXT_DAYS,
} from '../src/http/security-txt.js';

const NOW = new Date('2026-08-06T12:00:00.000Z');

describe('platform security.txt (RFC 9116)', () => {
  it('falls back to the upstream advisory channel + policy when the operator sets nothing', () => {
    const txt = renderPlatformSecurityTxt({ now: NOW });
    expect(txt).toContain(`Contact: ${UPSTREAM_SECURITY_CONTACT}`);
    expect(txt).toContain(`Policy: ${UPSTREAM_SECURITY_POLICY}`);
    expect(txt).toContain('Preferred-Languages: en');
    // No configured origin → no Canonical (never guessed from the request Host).
    expect(txt).not.toContain('Canonical:');
  });

  it('an operator contact REPLACES the upstream default rather than joining it', () => {
    const txt = renderPlatformSecurityTxt({
      now: NOW,
      contacts: ['https://agency.com/security/', 'mailto:security@agency.com'],
    });
    expect(txt.split('\n').filter((l) => l.startsWith('Contact:'))).toEqual([
      'Contact: https://agency.com/security/',
      'Contact: mailto:security@agency.com',
    ]);
    // The operator owns their disclosure path — upstream must not be silently appended to it.
    expect(txt).not.toContain(UPSTREAM_SECURITY_CONTACT);
    // The POLICY still describes the software's process, so it stays.
    expect(txt).toContain(`Policy: ${UPSTREAM_SECURITY_POLICY}`);
  });

  it('Expires is always ~90 days out — generated per request, so it cannot rot', () => {
    expect(renderPlatformSecurityTxt({ now: NOW })).toContain('Expires: 2026-11-04T12:00:00Z');
    const later = renderPlatformSecurityTxt({ now: new Date('2027-01-01T00:00:00.000Z') });
    expect(later).toContain('Expires: 2027-04-01T00:00:00Z');
    expect(PLATFORM_SECURITY_TXT_DAYS).toBe(90);
  });

  it('emits Canonical from the configured public URL, trailing slash normalized', () => {
    expect(renderPlatformSecurityTxt({ now: NOW, publicUrl: 'https://cms.agency.com' })).toContain(
      'Canonical: https://cms.agency.com/.well-known/security.txt',
    );
    expect(renderPlatformSecurityTxt({ now: NOW, publicUrl: 'https://cms.agency.com/' })).toContain(
      'Canonical: https://cms.agency.com/.well-known/security.txt',
    );
  });

  describe('parseSecurityContacts', () => {
    it('splits on commas, trims, and keeps preference order', () => {
      expect(parseSecurityContacts('https://a.com/s/, mailto:s@a.com , tel:+14155550123')).toEqual([
        'https://a.com/s/',
        'mailto:s@a.com',
        'tel:+14155550123',
      ]);
      expect(parseSecurityContacts(undefined)).toEqual([]);
      expect(parseSecurityContacts('')).toEqual([]);
    });

    it('DROPS anything that is not a usable URI rather than publishing it', () => {
      // Not a URI at all, an http (not https) web link, and a non-E.164 tel.
      expect(parseSecurityContacts('security@agency.com')).toEqual([]);
      expect(parseSecurityContacts('http://agency.com/security/')).toEqual([]);
      expect(parseSecurityContacts('tel:0301234567')).toEqual([]);
      // The valid entries in a mixed list still survive.
      expect(parseSecurityContacts('nonsense, https://a.com/s/')).toEqual(['https://a.com/s/']);
    });

    it('strips CR/LF so an env value cannot inject an extra field', () => {
      // With the newline removed the value is one mangled, space-bearing string — which then fails
      // the URI shape check and is dropped. Either way no second field can reach the file.
      expect(parseSecurityContacts('https://a.com/s/\nExpires: 1999-01-01T00:00:00Z')).toEqual([]);
      expect(parseSecurityContacts('https://a.com/s/\r\nPolicy:https://evil.example.com/')).toEqual([
        'https://a.com/s/Policy:https://evil.example.com/',
      ]);
    });

    it('caps the list so the environment cannot pad the file', () => {
      const many = Array.from({ length: 12 }, (_, i) => `https://a.com/${i}/`).join(',');
      expect(parseSecurityContacts(many)).toHaveLength(5);
    });
  });

  describe('over HTTP', () => {
    it('serves text/plain at the normative path (NOT the SPA shell)', async () => {
      const app = await createApp({ db: await makeTestDb(), publicUrl: 'https://cms.agency.com' });
      const res = await app.inject({ method: 'GET', url: '/.well-known/security.txt' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.body).toMatch(/^Contact: /m);
      expect(res.body).toMatch(/^Expires: /m);
      expect(res.body).toContain('Canonical: https://cms.agency.com/.well-known/security.txt');
      // The thing that used to be served here: the editor shell.
      expect(res.body).not.toContain('<!doctype html');
      await app.close();
    });

    it('reflects the contacts the operator configured', async () => {
      const app = await createApp({ db: await makeTestDb(), securityContacts: ['mailto:security@agency.com'] });
      const res = await app.inject({ method: 'GET', url: '/.well-known/security.txt' });
      expect(res.body).toContain('Contact: mailto:security@agency.com');
      expect(res.body).not.toContain(UPSTREAM_SECURITY_CONTACT);
      await app.close();
    });
  });
});
