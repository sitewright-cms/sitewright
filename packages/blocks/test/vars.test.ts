import { describe, it, expect } from 'vitest';
import { substituteVars, type VarContext } from '../src/vars.js';

const vars: VarContext = {
  company: { name: 'Acme', legalName: 'Acme Inc.', address: { locality: 'Windhoek' }, founded: 1999 },
  website: { siteUrl: 'https://acme.example' },
  page: { title: 'Home', path: '/' },
};

describe('substituteVars', () => {
  it('substitutes whitelisted company/website/page paths (incl. nested + numeric)', () => {
    expect(substituteVars('© {{ company.name }}', vars)).toBe('© Acme');
    expect(substituteVars('{{ company.legalName }} in {{ company.address.locality }}', vars)).toBe('Acme Inc. in Windhoek');
    expect(substituteVars('Visit {{ website.siteUrl }}', vars)).toBe('Visit https://acme.example');
    expect(substituteVars('Page: {{ page.title }}', vars)).toBe('Page: Home');
    expect(substituteVars('Since {{ company.founded }}', vars)).toBe('Since 1999'); // number → string
  });

  it('tolerates whitespace variants in the braces', () => {
    expect(substituteVars('{{company.name}}', vars)).toBe('Acme');
    expect(substituteVars('{{   company.name   }}', vars)).toBe('Acme');
  });

  it('leaves unknown namespaces, unknown paths, and object leaves untouched', () => {
    expect(substituteVars('{{ secret.token }}', vars)).toBe('{{ secret.token }}'); // not whitelisted
    expect(substituteVars('{{ company.unknown }}', vars)).toBe('{{ company.unknown }}'); // unknown field
    expect(substituteVars('{{ company.address }}', vars)).toBe('{{ company.address }}'); // object leaf, not stringified
  });

  it('never traverses prototype-pollution keys', () => {
    expect(substituteVars('{{ company.__proto__.x }}', vars)).toBe('{{ company.__proto__.x }}');
    expect(substituteVars('{{ company.constructor.name }}', vars)).toBe('{{ company.constructor.name }}');
  });

  it('returns raw text (no escaping — the renderer escapes); dangerous values pass through verbatim for the caller to escape', () => {
    const evil: VarContext = { company: { name: '<script>alert(1)</script>' } };
    expect(substituteVars('{{ company.name }}', evil)).toBe('<script>alert(1)</script>');
  });

  it('is a no-op without vars or without placeholders', () => {
    expect(substituteVars('{{ company.name }}', undefined)).toBe('{{ company.name }}');
    expect(substituteVars('plain text', vars)).toBe('plain text');
  });
});
