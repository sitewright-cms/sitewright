import { describe, expect, it } from 'vitest';
import { httpHref } from '../src/lib/external-href';

describe('httpHref', () => {
  it('links an absolute http(s) address as it is', () => {
    expect(httpHref('https://www.example.com/services/roofing/')).toBe('https://www.example.com/services/roofing/');
    expect(httpHref('http://example.com/a?b=1#c')).toBe('http://example.com/a?b=1#c');
  });

  it('resolves a relative address against the base', () => {
    expect(httpHref('/contact/', 'https://www.example.com/')).toBe('https://www.example.com/contact/');
    expect(httpHref('contact', 'https://www.example.com/de/')).toBe('https://www.example.com/de/contact');
  });

  it('never links a scheme that is not http(s), however it is written', () => {
    for (const url of ['javascript:alert(1)', ' JavaScript:alert(1)', '\tjavascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd', 'mailto:a@b.c']) {
      expect(httpHref(url, 'https://www.example.com/'), url).toBeNull();
    }
  });

  it('is null for what is not an address at all, or relative with no base', () => {
    expect(httpHref('http://')).toBeNull();
    expect(httpHref('/contact/')).toBeNull();
    expect(httpHref('')).toBeNull();
  });

  it('returns the PARSED address, so what reaches the href is normalised, never the raw text', () => {
    expect(httpHref('HTTPS://Example.COM/a b')).toBe('https://example.com/a%20b');
    // Tabs and newlines inside a scheme are stripped by the parser: the result is then judged by its real scheme.
    expect(httpHref('java\tscript:alert(1)')).toBeNull();
    expect(httpHref('java\nscript:alert(1)')).toBeNull();
    expect(httpHref('https://exa\nmple.com/')).toBe('https://example.com/');
  });

  it('treats protocol-relative and backslashed addresses as the host they name (an off-site page, still http(s))', () => {
    expect(httpHref('//elsewhere.example/x', 'https://www.example.com/')).toBe('https://elsewhere.example/x');
    expect(httpHref('\\\\elsewhere.example\\x', 'https://www.example.com/')).toBe('https://elsewhere.example/x');
  });

  it('links an absolute address even when the base is no URL (a Search Console domain property)', () => {
    expect(httpHref('https://www.example.com/a', 'sc-domain:example.com')).toBe('https://www.example.com/a');
    expect(httpHref('/a', 'sc-domain:example.com')).toBeNull();
    expect(httpHref('https://www.example.com/a', 'not a url')).toBe('https://www.example.com/a');
  });
});
