import { describe, it, expect } from 'vitest';
import {
  SW_DIRECTIVES,
  BINDING_NAMESPACES,
  BINDING_NAMESPACE_NAMES,
  LOOP_VARIABLES,
  type BindingNamespaceName,
} from '@sitewright/schema';
import { DIRECTIVE_ATTRS } from '../src/directives.js';
import { renderTemplate, type TemplateContext } from '../src/template.js';

// The authoring-reference registries (@sitewright/schema) are the single source the editor's Template
// reference DERIVES its Directives / Bindings / Variables tabs from. These tests pin each registry to
// the engine's ACTUAL behavior so the docs can never drift from what ships — the analog of the
// component-catalog and helper drift tests.

// One dataset entry envelope (the shape `{{#each}}` flattens) — reused across the loop-variable cases.
const entry = (id: string, title: string) => ({ id, dataset: 'd', status: 'published', values: { title } });

describe('SW_DIRECTIVES ↔ the resolveDirectives pass', () => {
  it('documents exactly the directive attrs the engine processes (excluding the automatic ones)', () => {
    const processed = SW_DIRECTIVES.filter((d) => !d.automatic).map((d) => d.attr).sort();
    expect(processed).toEqual([...DIRECTIVE_ATTRS].sort());
  });

  it('every directive attr is unique and well-formed (data-sw-*)', () => {
    const attrs = SW_DIRECTIVES.map((d) => d.attr);
    expect(new Set(attrs).size).toBe(attrs.length);
    for (const a of attrs) expect(a, a).toMatch(/^data-sw-[a-z]+$/);
  });

  it('the automatic directive (data-sw-entry) is really emitted by the dataset loop in preview', () => {
    // markEntries (preview-only) makes the dataset `{{#each}}` wrap each row in data-sw-entry.
    const html = renderTemplate('{{#each dataset.posts}}<h3>{{title}}</h3>{{/each}}', {
      dataset: { posts: [entry('p1', 'Hello')] },
      markEntries: true,
      preview: true,
    });
    expect(html).toContain('data-sw-entry');
    const auto = SW_DIRECTIVES.filter((d) => d.automatic).map((d) => d.attr);
    expect(auto, 'data-sw-entry must be documented as an automatic directive').toContain('data-sw-entry');
  });
});

describe('BINDING_NAMESPACES ↔ the render context', () => {
  // Compile-time exhaustiveness: the documented namespace set must EQUAL the author-facing keys of
  // the render context. Keys that are infrastructure (passed to the engine's own passes, not read by
  // an author with `{{ … }}`) are excluded here; adding a key to TemplateContext forces it to be
  // classified as one of these OR documented as a binding namespace — or this file fails to compile.
  //
  // PEER-REVIEW OBLIGATION: this list is load-bearing. Adding a key to InfraContextKey is a claim
  // that the key is NOT author-readable — scrutinize it as hard as adding a binding doc, because
  // misclassifying an author-facing key as infra would silently drop it from the Template reference
  // (it's the one drift this assertion cannot catch — it pins names, not the infra/author split).
  type InfraContextKey =
    | 'partials'
    | 'media'
    | 'preview'
    | 'markEntries'
    | 'forms'
    | 'hcaptchaSiteKey'
    | 'siteRoot'
    // A TRANSPORT input merged into the page object as the `page.parent` binding (documented under the
    // `page` namespace), NOT an author-facing top-level namespace itself.
    | 'parentPage';
  type AuthorFacingContextKey = Exclude<keyof TemplateContext, InfraContextKey>;
  type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

  it('the documented namespaces exactly equal the render context author-facing keys (compile-time)', () => {
    // If BINDING_NAMESPACE_NAMES and AuthorFacingContextKey diverge, AssertEqual is `never` and the
    // `= true` below is a compile error (caught by `pnpm --filter @sitewright/blocks typecheck`).
    const ok: AssertEqual<BindingNamespaceName, AuthorFacingContextKey> = true;
    expect(ok).toBe(true);
  });

  it('every namespace name has at least one doc, and every doc names a real namespace', () => {
    const names = new Set<string>(BINDING_NAMESPACE_NAMES);
    for (const n of BINDING_NAMESPACE_NAMES) {
      expect(BINDING_NAMESPACES.some((d) => d.namespace === n), `${n} has no doc`).toBe(true);
    }
    for (const d of BINDING_NAMESPACES) {
      expect(names.has(d.namespace), `${d.id} → unknown namespace ${d.namespace}`).toBe(true);
    }
  });

  it('every documented namespace actually resolves a value in a real render', () => {
    const html = renderTemplate(
      'C={{company.name}} W={{website.siteUrl}} P={{page.title}} PP={{page.parent.title}} ' +
        'D={{#each dataset.list}}{{title}}{{/each}} I={{item.set.k1.title}} N={{#each nav.header}}{{path}}{{/each}}',
      {
        company: { name: 'CO' },
        website: { siteUrl: 'WS' },
        page: { title: 'PG' },
        parentPage: { title: 'PRP' },
        dataset: { list: [{ id: 'k1', dataset: 'set', values: { title: 'DV' } }] },
        item: { set: { k1: { title: 'IV' } } },
        nav: { header: [{ path: '/NV' }] },
      },
    );
    for (const expected of ['C=CO', 'W=WS', 'P=PG', 'PP=PRP', 'D=DV', 'I=IV', 'N=/NV']) {
      expect(html, `binding did not resolve: ${expected}`).toContain(expected);
    }
  });
});

describe('LOOP_VARIABLES ↔ a real {{#each}} / {{#with}} render', () => {
  it('the engine frame variables (@index, @entry, @first, @last) + @root resolve as documented', () => {
    const html = renderTemplate(
      '{{#each dataset.list}}[{{@index}}|{{@entry.id}}|{{#if @first}}F{{/if}}{{#if @last}}L{{/if}}|{{@root.company.name}}]{{/each}}',
      { company: { name: 'ROOT' }, dataset: { list: [entry('a', 'A'), entry('b', 'B')] } },
    );
    expect(html).toContain('[0|a|F|ROOT]');
    expect(html).toContain('[1|b|L|ROOT]');
  });

  it('the parent-context variable (../) reaches the enclosing scope', () => {
    const html = renderTemplate('{{#with company}}{{name}}@{{../page.title}}{{/with}}', {
      company: { name: 'X' },
      page: { title: 'Y' },
    });
    expect(html).toContain('X@Y');
  });

  it('every loop variable is tagged with a known source', () => {
    // Validates the source ENUMERATION only (catches a typo), not the engine/builtin/context
    // CLASSIFICATION — that's a documentation judgement. The behavioral renders above are what tie
    // the engine-specific frame variable (@entry) and the builtins (@index/@first/@last/@root/../)
    // to real behavior.
    for (const v of LOOP_VARIABLES) {
      expect(['engine', 'builtin', 'context'], v.id).toContain(v.source);
    }
  });
});
