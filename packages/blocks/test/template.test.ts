import { describe, it, expect } from 'vitest';
import { renderTemplate, TemplateError, type TemplateContext } from '../src/template.js';

const ctx: TemplateContext = {
  company: { name: 'Acme', address: { city: 'Berlin' } },
  website: { siteUrl: 'https://acme.test' },
  page: { title: 'Home & Co' },
  data: {
    products: [
      { name: 'Widget', price: 9 },
      { name: 'Gadget', price: 12 },
    ],
    tags: ['a', 'b'],
    featured: true,
    empty: [],
  },
};

describe('renderTemplate — literals + interpolation', () => {
  it('passes literal HTML through verbatim', () => {
    expect(renderTemplate('<div class="grid md:grid-cols-2">hi</div>')).toBe('<div class="grid md:grid-cols-2">hi</div>');
  });

  it('interpolates whitelisted paths and ESCAPES the value', () => {
    expect(renderTemplate('<h1>{{ page.title }}</h1>', ctx)).toBe('<h1>Home &amp; Co</h1>');
    expect(renderTemplate('{{ company.address.city }}', ctx)).toBe('Berlin');
    expect(renderTemplate('{{ website.siteUrl }}', ctx)).toBe('https://acme.test');
  });

  it('renders a missing path as an empty string (not the literal)', () => {
    expect(renderTemplate('[{{ page.nope }}]', ctx)).toBe('[]');
    expect(renderTemplate('[{{ nothing.here }}]', ctx)).toBe('[]');
  });

  it('escapes an HTML-bearing value (XSS-safe)', () => {
    const evil: TemplateContext = { page: { title: '<script>alert(1)</script>' } };
    expect(renderTemplate('{{ page.title }}', evil)).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes quotes so a value cannot break out of an attribute (attribute-context XSS)', () => {
    const evil: TemplateContext = { data: { cls: '" onmouseover="alert(1)' } };
    const out = renderTemplate('<div class="{{ data.cls }}">x</div>', evil);
    // The injected quote is neutralized → no attribute breakout.
    expect(out).toBe('<div class="&quot; onmouseover=&quot;alert(1)">x</div>');
    expect(out).not.toContain('onmouseover="');
  });

  it('renders numbers but not objects/arrays', () => {
    expect(renderTemplate('{{ data.products }}', ctx)).toBe(''); // array leaf → empty
    expect(renderTemplate('{{#each data.products}}{{ price }} {{/each}}', ctx)).toBe('9 12 ');
  });

  it('strips comments', () => {
    expect(renderTemplate('a{{! this is a note }}b', ctx)).toBe('ab');
  });
});

describe('renderTemplate — conditionals', () => {
  it('renders the block when the path is truthy', () => {
    expect(renderTemplate('{{#if data.featured}}YES{{/if}}', ctx)).toBe('YES');
    expect(renderTemplate('{{#if company.name}}has{{/if}}', ctx)).toBe('has');
  });

  it('hides the block when falsy/missing, and supports else', () => {
    expect(renderTemplate('{{#if page.missing}}Y{{else}}N{{/if}}', ctx)).toBe('N');
    expect(renderTemplate('{{#if data.empty}}Y{{else}}N{{/if}}', ctx)).toBe('N'); // empty array = falsy
  });
});

describe('renderTemplate — iteration', () => {
  it('iterates an array, resolving item fields, @index, and this', () => {
    expect(renderTemplate('{{#each data.products}}{{@index}}:{{ name }}@{{ price }};{{/each}}', ctx)).toBe(
      '0:Widget@9;1:Gadget@12;',
    );
    expect(renderTemplate('{{#each data.tags}}[{{ this }}]{{/each}}', ctx)).toBe('[a][b]');
  });

  it('still resolves OUTER scope paths inside each (scope stack)', () => {
    expect(renderTemplate('{{#each data.products}}{{ company.name }}:{{ name }} {{/each}}', ctx)).toBe(
      'Acme:Widget Acme:Gadget ',
    );
  });

  it('renders nothing for a non-array or empty collection', () => {
    expect(renderTemplate('{{#each data.empty}}x{{/each}}', ctx)).toBe('');
    expect(renderTemplate('{{#each page.title}}x{{/each}}', ctx)).toBe('');
  });

  it('supports nested each blocks', () => {
    const nested: TemplateContext = { data: { rows: [{ cells: ['1', '2'] }, { cells: ['3'] }] } };
    expect(renderTemplate('{{#each data.rows}}<tr>{{#each cells}}<td>{{ this }}</td>{{/each}}</tr>{{/each}}', nested)).toBe(
      '<tr><td>1</td><td>2</td></tr><tr><td>3</td></tr>',
    );
  });
});

describe('renderTemplate — partials', () => {
  it('includes a named partial, rendered in the current scope', () => {
    const c: TemplateContext = { ...ctx, partials: { card: '<li>{{ name }} ({{ price }})</li>' } };
    expect(renderTemplate('<ul>{{#each data.products}}{{> card}}{{/each}}</ul>', c)).toBe(
      '<ul><li>Widget (9)</li><li>Gadget (12)</li></ul>',
    );
  });

  it('resolves nested partials', () => {
    const c: TemplateContext = { company: { name: 'Acme' }, partials: { a: 'A{{> b}}', b: 'B{{ company.name }}' } };
    expect(renderTemplate('{{> a}}', c)).toBe('ABAcme');
  });

  it('throws a TemplateError for an unknown partial (dev typo)', () => {
    expect(() => renderTemplate('{{> missing}}', ctx)).toThrow(TemplateError);
  });
});

describe('renderTemplate — security + guards', () => {
  it('blocks prototype-pollution path segments', () => {
    expect(renderTemplate('[{{ company.__proto__ }}]', ctx)).toBe('[]');
    expect(renderTemplate('[{{ constructor.name }}]', ctx)).toBe('[]');
    expect(renderTemplate('[{{ company.constructor }}]', ctx)).toBe('[]');
  });

  it('throws on unbalanced/mismatched blocks (parse error)', () => {
    expect(() => renderTemplate('{{#each data.products}}x', ctx)).toThrow(TemplateError);
    expect(() => renderTemplate('{{#if a}}x{{/each}}', ctx)).toThrow(TemplateError);
    expect(() => renderTemplate('{{/if}}', ctx)).toThrow(TemplateError);
  });

  it('guards against runaway partial recursion (depth limit)', () => {
    const c: TemplateContext = { partials: { loop: 'x{{> loop}}' } };
    expect(() => renderTemplate('{{> loop}}', c)).toThrow(TemplateError);
  });

  it('guards against deeply-nested blocks (bounds parse/eval recursion)', () => {
    const deep = '{{#if a}}'.repeat(200) + 'x' + '{{/if}}'.repeat(200);
    expect(() => renderTemplate(deep, {}, { maxNestingDepth: 50 })).toThrow(TemplateError);
  });

  it('caps total output size to bound a runaway each', () => {
    const big: TemplateContext = { data: { items: Array.from({ length: 100000 }, () => ({ v: 'xxxxxxxxxx' })) } };
    expect(() => renderTemplate('{{#each data.items}}{{ v }}{{/each}}', big, { maxOutput: 1000 })).toThrow(TemplateError);
  });

  it('does NOT evaluate code in a value (no template injection from data)', () => {
    const c: TemplateContext = { page: { title: '{{ company.secret }}' }, company: { secret: 'LEAK' } };
    // An interpolated value that itself looks like a tag must NOT be re-evaluated.
    expect(renderTemplate('{{ page.title }}', c)).toBe('{{ company.secret }}');
  });

  it('caps total operations to stop a zero-output runaway each', () => {
    const big: TemplateContext = { data: { items: Array.from({ length: 1000 }, () => 1) } };
    // The body emits nothing, so the output cap never fires — the op counter must.
    expect(() => renderTemplate('{{#each data.items}}{{/each}}', big, { maxOperations: 50 })).toThrow(TemplateError);
  });
});

describe('renderTemplate — context-aware escaping (XSS)', () => {
  it('sanitizes a whole-value URL attribute (blocks javascript: / data:)', () => {
    expect(renderTemplate('<a href="{{ page.link }}">x</a>', { page: { link: 'javascript:alert(1)' } })).toBe(
      '<a href="#">x</a>',
    );
    expect(renderTemplate('<img src="{{ data.u }}">', { data: { u: 'https://cdn.test/a.png' } })).toBe(
      '<img src="https://cdn.test/a.png">',
    );
    expect(renderTemplate('<a href="{{ page.link }}">x</a>', { page: { link: '/about' } })).toBe(
      '<a href="/about">x</a>',
    );
  });

  it('does NOT over-sanitize a URL with a literal prefix (the scheme is fixed by the prefix)', () => {
    // The interpolation is only the path segment; the `/p/` prefix fixes the scheme, so
    // it is escaped (not safeUrl-mangled) and a bare value cannot become a javascript: URL.
    expect(renderTemplate('<a href="/p/{{ page.slug }}">x</a>', { page: { slug: 'about' } })).toBe(
      '<a href="/p/about">x</a>',
    );
  });

  it('rejects interpolation in an UNQUOTED attribute (attribute-injection XSS)', () => {
    expect(() => renderTemplate('<div class={{ data.cls }}>x</div>', { data: { cls: 'a' } })).toThrow(TemplateError);
  });

  it('rejects interpolation in event-handler and style attributes', () => {
    expect(() => renderTemplate('<button onclick="{{ data.x }}">x</button>', {})).toThrow(TemplateError);
    expect(() => renderTemplate('<div style="color:{{ data.c }}">x</div>', {})).toThrow(TemplateError);
  });

  it('rejects interpolation inside <script>, <style>, and HTML comments', () => {
    expect(() => renderTemplate('<script>var x = {{ data.x }};</script>', {})).toThrow(TemplateError);
    expect(() => renderTemplate('<style>.a { color: {{ data.c }} }</style>', {})).toThrow(TemplateError);
    expect(() => renderTemplate('<!-- {{ page.title }} -->', {})).toThrow(TemplateError);
  });

  it('still allows interpolation in element text and quoted non-URL attributes after the markup', () => {
    expect(renderTemplate('<p data-x="{{ data.v }}">{{ data.v }}</p>', { data: { v: 'hi' } })).toBe(
      '<p data-x="hi">hi</p>',
    );
  });
});
