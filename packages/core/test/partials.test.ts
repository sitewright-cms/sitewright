import { describe, it, expect } from 'vitest';
import { reachablePartials } from '../src/index.js';

describe('reachablePartials', () => {
  it('follows every include form, transitively — a snippet may compose another', () => {
    const partials = {
      hero: '<div>{{> title}}</div>',
      title: '<h1>{{~> badge}}</h1>',
      badge: '<b>new</b>',
      card: '<div>{{#> frame}}x{{/frame}}</div>',
      frame: '<section>{{> @partial-block}}</section>',
    };
    expect(reachablePartials(['<main>{{> hero}}</main>'], partials)).toEqual({
      hero: partials.hero,
      title: partials.title,
      badge: partials.badge,
    });
    expect(Object.keys(reachablePartials(['{{#> card}}{{/card}}'], partials))).toEqual(['card', 'frame']);
  });

  it('follows a QUOTED name too — Handlebars renders `{{> "name"}}` exactly like `{{> name}}`', () => {
    const partials = { hero: '{{> \'title\' level=1}}', title: '<h1>{{page.parent.title}}</h1>', unused: 'x' };
    expect(Object.keys(reachablePartials(['{{> "hero"}}'], partials))).toEqual(['hero', 'title']);
  });

  it('keeps a defined-but-unincluded partial OUT — so an unused snippet adds nothing', () => {
    expect(reachablePartials(['<p>{{page.title}}</p>'], { unused: '{{page.parent.title}}' })).toEqual({});
  });

  it('terminates on a cycle and visits a shared partial once', () => {
    const partials = { a: '{{> b}}{{> shared}}', b: '{{> a}}{{> shared}}', shared: 'x' };
    expect(Object.keys(reachablePartials(['{{> a}}'], partials)).sort()).toEqual(['a', 'b', 'shared']);
  });

  it('skips a name the map does not define, and a missing root source', () => {
    expect(reachablePartials([undefined, null, '', '{{> missing}}{{> known}}'], { known: 'k' })).toEqual({ known: 'k' });
  });

  it('never reads an inherited Object property as a partial', () => {
    expect(reachablePartials(['{{> constructor}}{{> toString}}'], {})).toEqual({});
  });
});
