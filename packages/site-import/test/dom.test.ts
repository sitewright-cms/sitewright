import { describe, expect, it } from 'vitest';
import { getBody, parse, restoreMustacheEntities, serialize, serializeTemplate } from '../src/dom.js';

/** Parse an HTML fragment and return the `<body>` child nodes (asserted present for the fixtures below). */
const kids = (html: string) => getBody(parse(html))!.children;

describe('restoreMustacheEntities', () => {
  it('un-escapes a partial token that serialize() HTML-escaped', () => {
    // serialize() turns the `>` of an emitted `{{> logo-marquee}}` into `&gt;` (it is text, so it is HTML).
    const escaped = serialize(kids('<body><div>{{> logo-marquee}}</div></body>'));
    expect(escaped).toContain('{{&gt; logo-marquee}}'); // the corruption serialize() introduces
    expect(restoreMustacheEntities(escaped)).toContain('{{> logo-marquee}}');
    expect(restoreMustacheEntities(escaped)).not.toContain('{{&gt;');
  });

  it('decodes <, >, & ONLY inside mustache spans — surrounding page text is untouched', () => {
    const input = 'a &lt;b&gt; c {{helper "x &gt; y"}} &amp; d {{> part}}';
    expect(restoreMustacheEntities(input)).toBe('a &lt;b&gt; c {{helper "x > y"}} &amp; d {{> part}}');
  });

  it('decodes &amp; last so a genuine &amp; in a helper arg round-trips to a single &', () => {
    // serialize() would have written a literal `&` (an emitter helper arg) as `&amp;`; restore → `&`.
    expect(restoreMustacheEntities('{{sw-translate "R &amp; D"}}')).toBe('{{sw-translate "R & D"}}');
  });

  it('is a no-op when a mustache carries no escaped entities', () => {
    const clean = '<a href="{{sw-url \'/\'}}">{{title}}</a>{{#each dataset.x}}{{name}}{{/each}}';
    expect(restoreMustacheEntities(clean)).toBe(clean);
  });

  it('leaves literal angle brackets in real markup escaped (they are outside any mustache)', () => {
    const html = serialize(kids('<body><p>1 &lt; 2 &amp;&amp; 3 &gt; 0</p></body>'));
    expect(restoreMustacheEntities(html)).toBe(html); // no mustache → nothing decoded
  });

  it('DOCUMENTED LIMITATION: only decodes up to the first `}}` — a token body must carry no literal `}}`', () => {
    // The nativizer never emits a mustache whose body contains `}}` (no sub-expressions), so `[^{}]*`
    // covers every real token. This pins the boundary: were such a token ever emitted, only its head
    // (up to the first `}}`) would be decoded — a signal to revisit the regex if the emitter changes.
    expect(restoreMustacheEntities('{{a "&gt;}}b&gt;"}}')).toBe('{{a ">}}b&gt;"}}'); // tail `&gt;` NOT decoded
  });
});

describe('serializeTemplate', () => {
  it('serializes AND preserves emitted mustache tokens (serialize alone corrupts the partial)', () => {
    const nodes = kids('<body><section>{{> logo-marquee}}<a href="{{sw-url \'/\'}}">{{title}}</a></section></body>');
    expect(serialize(nodes)).toContain('{{&gt; logo-marquee}}'); // plain serialize corrupts …
    const tpl = serializeTemplate(nodes);
    expect(tpl).toContain('{{> logo-marquee}}'); // … serializeTemplate does not
    expect(tpl).toContain("{{sw-url '/'}}"); // other tokens unaffected either way
    expect(tpl).not.toContain('&gt;');
  });
});
