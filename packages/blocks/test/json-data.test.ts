import { describe, it, expect } from 'vitest';
import { renderTemplate, MAX_JSON_DATA_BYTES } from '../src/template.js';
import { jsonForScript } from '../src/escape.js';

/**
 * ON-PAGE JSON DATA ISLANDS — `{{sw-json-data value id="x"}}`.
 *
 * The feature exists because a template cannot hand structured data to a script any other way:
 * `checkOutput` rejects EVERY interpolation inside a `<script>` body, so `<script>{{sw-json x}}</script>`
 * is a template error by design. The helper therefore emits the whole element, and the tests below are
 * mostly about the two things that go wrong when a renderer writes a `<script>`:
 *
 *   1. BREAKOUT — a value closing the tag and dropping attacker text back into HTML.
 *   2. OVER-EXPOSURE — serializing more of the project than the author meant to publish.
 */
describe('jsonForScript', () => {
  it('makes </script> unrepresentable', () => {
    const out = jsonForScript({ evil: '</script><img src=x onerror=alert(1)>' });
    expect(out).toBeDefined();
    expect(out).not.toContain('</script');
    expect(out).not.toContain('<img');
    // …while still round-tripping byte-for-byte.
    expect(JSON.parse(out as string)).toEqual({ evil: '</script><img src=x onerror=alert(1)>' });
  });

  it('neutralises comment and script openers', () => {
    const out = jsonForScript({ a: '<!--', b: '<script>', c: '&' }) as string;
    expect(out).not.toContain('<!--');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('&');
    expect(JSON.parse(out)).toEqual({ a: '<!--', b: '<script>', c: '&' });
  });

  it('escapes U+2028/U+2029, which are legal JSON but break JS parsing', () => {
    const out = jsonForScript({ s: 'a b c' }) as string;
    expect(out).not.toContain(' ');
    expect(out).not.toContain(' ');
    expect(JSON.parse(out)).toEqual({ s: 'a b c' });
  });

  it('returns undefined rather than the string "undefined" for unserializable values', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(jsonForScript(cyclic)).toBeUndefined();
    expect(jsonForScript(() => {})).toBeUndefined();
    expect(jsonForScript(Symbol('x'))).toBeUndefined();
  });
});

describe('{{sw-json-data}}', () => {
  const render = (src: string, ctx: Record<string, unknown> = {}) => renderTemplate(src, ctx as never);

  it('emits an inert, parseable island', () => {
    const out = render('{{sw-json-data page.data.tiles id="tiles"}}', {
      page: { data: { tiles: [{ url: '/a.jpg' }, { url: '/b.jpg' }] } },
    });
    expect(out).toBe('<script type="application/json" id="tiles">[{"url":"/a.jpg"},{"url":"/b.jpg"}]</script>');
    const json = out.slice(out.indexOf('>') + 1, out.lastIndexOf('</script>'));
    expect(JSON.parse(json)).toHaveLength(2);
  });

  it('cannot be broken out of by content', () => {
    const payload = '</script><script>alert(1)</script>';
    const out = render('{{sw-json-data page.data.rows id="rows"}}', {
      page: { data: { rows: [{ t: payload }] } },
    });
    // Exactly one element — the attacker's tags did not become tags.
    expect(out.match(/<script/g)).toHaveLength(1);
    expect(out.match(/<\/script>/g)).toHaveLength(1);
    // ★ The BODY must contain no `<` at all. Asserting the absence of "alert(1)" would be wrong: the
    // text survives as DATA (that is the point of a data island) and is harmless precisely because it
    // can never be parsed as markup. The invariant is "no angle bracket escapes the escaping".
    const body = out.slice(out.indexOf('>') + 1, out.lastIndexOf('</script>'));
    expect(body).not.toContain('<');
    expect(JSON.parse(body)).toEqual([{ t: payload }]);
  });

  it('only allows the two inert script types', () => {
    expect(render('{{sw-json-data page.data.x id="a" type="text/javascript"}}', { page: { data: { x: 1 } } }))
      .toContain('sw-json-data: type= must be');
    expect(render('{{sw-json-data page.data.x id="a" type="application/ld+json"}}', { page: { data: { x: 1 } } }))
      .toContain('type="application/ld+json"');
  });

  it('requires a plain-token id', () => {
    // Only ids that actually REACH the helper are meaningful here. `id="a"onload="x"` does not: the
    // Handlebars parser closes the hash value at the second quote, so the helper is handed id="a" plus
    // an inert extra hash key — the attribute breakout is unreachable through the template grammar, not
    // merely rejected by this regex.
    for (const bad of ['', '1abc', 'a b', '-x']) {
      const out = render(`{{sw-json-data page.data.x id="${bad}"}}`, { page: { data: { x: 1 } } });
      expect(out).toContain('sw-json-data: id= must be');
      expect(out).not.toContain('<script');
    }
    expect(render('{{sw-json-data page.data.x id="ok_id-2"}}', { page: { data: { x: 1 } } }))
      .toContain('id="ok_id-2"');
  });

  // ── over-exposure ──
  it('refuses the ambient namespaces by identity, naming the one it refused', () => {
    // `settings` is in the deny list as defence-in-depth but is NOT a template binding today, so it is
    // not exercised here — asserting it would only prove that an unreachable name is unreachable.
    for (const ns of ['website', 'pages', 'dataset']) {
      const ctx = { website: { a: 1 }, pages: { c: 3 }, dataset: { d: 4 } };
      const out = render(`{{sw-json-data ${ns} id="x"}}`, ctx);
      expect(out).toContain(`refusing to serialize the whole "${ns}" namespace`);
      expect(out).not.toContain('<script');
    }
  });

  it('still serializes a PROJECTION of an ambient namespace', () => {
    const out = render('{{sw-json-data dataset.products id="products"}}', {
      dataset: { products: [{ name: 'Cap', price: 120 }] },
    });
    expect(out).toContain('<script type="application/json" id="products">');
    expect(out).toContain('"Cap"');
  });

  it('refuses a value carrying a credential-shaped key, at any depth', () => {
    for (const key of ['password', 'apiKey', 'api_key', 'accessToken', 'clientSecret', 'privateKey']) {
      const out = render('{{sw-json-data page.data.cfg id="cfg"}}', {
        page: { data: { cfg: { nested: { deeper: { [key]: 'hunter2' } } } } },
      });
      expect(out).toContain('credential-shaped key');
      expect(out).not.toContain('hunter2');
    }
  });

  it('does NOT refuse the ordinary field names that real data uses', () => {
    // The shop's own channels carry `key`; an over-broad guard would break real projects and teach
    // authors to rename their data to get around it.
    const out = render('{{sw-json-data page.data.rows id="rows"}}', {
      page: { data: { rows: [{ key: 'order', id: 7, keyword: 'x', monkey: 'y' }] } },
    });
    expect(out).toContain('<script');
    expect(out).toContain('"order"');
  });

  it('refuses an oversized value LOUDLY instead of truncating it', () => {
    const rows = Array.from({ length: 20_000 }, (_, i) => ({ url: `/media/img-${i}-abcdefghijklmnop.jpg` }));
    const out = render('{{sw-json-data page.data.rows id="rows"}}', { page: { data: { rows } } });
    expect(out).toContain('over the');
    expect(out).toContain('website.dataFiles');
    // Half an island is worse than none: a reading script would get valid JSON quietly missing rows.
    expect(out).not.toContain('<script');
  });

  it('accepts a value just under the cap', () => {
    const filler = 'x'.repeat(MAX_JSON_DATA_BYTES - 200);
    const out = render('{{sw-json-data page.data.s id="s"}}', { page: { data: { s: filler } } });
    expect(out.startsWith('<script type="application/json" id="s">')).toBe(true);
  });

  it('refuses an unserializable value', () => {
    const cyclic: Record<string, unknown> = { name: 'a' };
    cyclic.self = cyclic;
    const out = render('{{sw-json-data page.data.c id="c"}}', { page: { data: { c: cyclic } } });
    expect(out).toContain('not serializable');
    expect(out).not.toContain('<script');
  });

  it('says so when given no value at all', () => {
    expect(render('{{sw-json-data id="x"}}')).toContain('no value given');
  });
});
