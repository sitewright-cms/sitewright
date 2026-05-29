import { describe, expect, it } from 'vitest';
import { escapeHtml, escapeAttr } from '../src/escape.js';

describe('escapeHtml', () => {
  it('escapes the HTML-significant characters', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapes ampersands so entities cannot be smuggled in', () => {
    expect(escapeHtml('Tom & Jerry < Co')).toBe('Tom &amp; Jerry &lt; Co');
  });

  it('leaves quotes untouched (text context)', () => {
    expect(escapeHtml(`it's "fine"`)).toBe(`it's "fine"`);
  });

  it('returns plain text unchanged', () => {
    expect(escapeHtml('Hello world')).toBe('Hello world');
  });
});

describe('escapeAttr', () => {
  it('escapes quotes so an attribute value cannot break out', () => {
    expect(escapeAttr('" onload="alert(1)')).toBe('&quot; onload=&quot;alert(1)');
  });

  it('escapes single quotes and angle brackets', () => {
    expect(escapeAttr(`'<>`)).toBe('&#39;&lt;&gt;');
  });

  it('escapes ampersands', () => {
    expect(escapeAttr('a&b')).toBe('a&amp;b');
  });
});
