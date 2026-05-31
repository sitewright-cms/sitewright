import { describe, it, expect } from 'vitest';
import { targetsPrivateHost } from '../src/primitives.js';

describe('targetsPrivateHost', () => {
  it('allows ordinary public hosts', () => {
    for (const u of [
      'https://example.com/x.jpg',
      'https://images.unsplash.com/photo-1',
      'https://images.pexels.com/photos/1/p.jpg',
      'https://8.8.8.8/x',
      'https://172.15.0.1/x', // just below the 172.16/12 private range
      'https://172.32.0.1/x', // just above it
      'https://100.63.0.1/x', // just below 100.64/10 CGNAT
      'https://100.128.0.1/x', // just above it
    ]) {
      expect(targetsPrivateHost(u), u).toBe(false);
    }
  });

  it('blocks loopback / private / link-local / CGNAT / wildcard IPv4', () => {
    for (const u of [
      'https://127.0.0.1/x',
      'https://127.99.1.1/x',
      'http://10.0.0.5/x',
      'https://192.168.1.1/x',
      'https://172.16.0.1/x',
      'https://172.31.255.255/x',
      'https://169.254.169.254/latest/meta-data/', // cloud metadata
      'https://169.254.1.2/x', // wider link-local /16
      'https://100.100.100.254/x', // CGNAT (cloud internal metadata)
      'https://0.0.0.0/x',
      'https://0.1.2.3/x',
    ]) {
      expect(targetsPrivateHost(u), u).toBe(true);
    }
  });

  it('blocks IPv4-mapped IPv6 that smuggles a private address', () => {
    for (const u of [
      'https://[::ffff:7f00:1]/x', // ::ffff:127.0.0.1
      'https://[::ffff:127.0.0.1]/x', // dotted mapped form
      'https://[::ffff:a00:1]/x', // ::ffff:10.0.0.1
      'https://[::ffff:c0a8:101]/x', // ::ffff:192.168.1.1
      'https://[::ffff:a9fe:a9fe]/x', // ::ffff:169.254.169.254 (metadata)
    ]) {
      expect(targetsPrivateHost(u), u).toBe(true);
    }
  });

  it('blocks IPv6 loopback / unspecified / ULA / link-local and internal suffixes', () => {
    for (const u of [
      'https://[::1]/x',
      'https://[::]/x',
      'https://[fc00::1]/x',
      'https://[fd12:3456::1]/x',
      'https://[fe80::1]/x',
      'https://localhost/x',
      'https://db.internal/x',
      'https://printer.local/x',
    ]) {
      expect(targetsPrivateHost(u), u).toBe(true);
    }
  });

  it('treats an unparseable URL as private (fail closed)', () => {
    expect(targetsPrivateHost('not a url')).toBe(true);
    expect(targetsPrivateHost('')).toBe(true);
  });
});
