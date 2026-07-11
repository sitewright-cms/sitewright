import { describe, it, expect } from 'vitest';
import { parseTrustProxy } from '../src/trust-proxy.js';

describe('parseTrustProxy', () => {
  it('trusts all hops for "true"', () => {
    expect(parseTrustProxy('true')).toBe(true);
  });

  it('trusts nothing when unset, empty, whitespace, or "false"', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('   ')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('parses a single IP/CIDR into a one-element list', () => {
    expect(parseTrustProxy('10.0.0.0/8')).toEqual(['10.0.0.0/8']);
  });

  it('parses a comma list and trims whitespace', () => {
    expect(parseTrustProxy('10.0.0.0/8, 192.168.0.0/16 ,172.16.0.1')).toEqual([
      '10.0.0.0/8',
      '192.168.0.0/16',
      '172.16.0.1',
    ]);
  });

  it('drops empty entries so a trailing comma cannot crash proxy-addr at boot', () => {
    expect(parseTrustProxy('10.0.0.0/8,')).toEqual(['10.0.0.0/8']);
    expect(parseTrustProxy(',,10.0.0.0/8,,')).toEqual(['10.0.0.0/8']);
  });

  it('resolves a list that reduces to nothing back to false', () => {
    expect(parseTrustProxy(', ,')).toBe(false);
  });
});
