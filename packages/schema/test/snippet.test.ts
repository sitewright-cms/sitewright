import { describe, it, expect } from 'vitest';
import { SnippetSchema } from '../src/snippet.js';

describe('SnippetSchema', () => {
  it('accepts a valid Handlebars-partial name + source', () => {
    const s = SnippetSchema.parse({ id: 'header', name: 'site-header', source: '<header>{{ company.name }}</header>' });
    expect(s.name).toBe('site-header');
  });

  it('rejects a name with mustache-significant or whitespace characters', () => {
    for (const bad of ['has space', 'foo}}bar', '1leading', '', '{{x}}']) {
      expect(() => SnippetSchema.parse({ id: 'x', name: bad, source: '<p>x</p>' })).toThrow();
    }
  });

  it('rejects an over-long source', () => {
    expect(() => SnippetSchema.parse({ id: 'x', name: 'big', source: 'x'.repeat(256 * 1024 + 1) })).toThrow();
  });
});
