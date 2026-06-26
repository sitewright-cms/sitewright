import { describe, expect, it } from 'vitest';
import { renderTemplate, validateTemplate } from '@sitewright/blocks';
import { extractTemplates } from '../src/nativize/templatize.js';

const probe = (t: string, extra: Record<string, unknown>): Promise<string> => Promise.resolve(renderTemplate(t, extra as never));

// A "service page" skeleton: hero title + intro (both varying), a refolded projects loop (varying slug/data), static CTA.
const svc = (title: string, intro: string, slug: string): string =>
  `<section class="hero"><h1>${title}</h1></section><section class="intro"><p>${intro}</p></section>` +
  `<div class="projects"><h2>RECENT PROJECTS</h2>{{#each dataset.${slug}}}<div class="row"><span>{{name}}</span><span>{{sw-icon "eye"}} VIEW</span></div>{{/each}}</div>` +
  `<div class="cta"><a href="/apply">Apply now</a></div>`;

const ITEMS: Record<string, Record<string, string>[]> = { p1: [{ name: 'Alpha' }, { name: 'Beta' }], p2: [{ name: 'Gamma' }], p3: [{ name: 'Delta' }, { name: 'Eps' }] };

describe('extractTemplates', () => {
  it('collapses same-skeleton pages into ONE template + per-page page.data + consumed loops', async () => {
    const pages = [
      { id: 'agri', group: 'services', source: svc('Agri Industrial', 'Agri intro text', 'p1') },
      { id: 'energy', group: 'services', source: svc('Energy', 'Energy intro text', 'p2') },
      { id: 'mining', group: 'services', source: svc('Mining', 'Mining intro text', 'p3') },
    ];
    const groups = await extractTemplates(pages, (slug) => ITEMS[slug] ?? [], probe);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.members).toHaveLength(3);
    expect(g.templateSource).toContain('data-sw-text="page.data.'); // varying hero/intro → editable regions
    expect(g.templateSource).toContain('{{#each page.data.projects}}'); // the projects loop is now page-data driven
    expect(g.templateSource).toContain('{{sw-icon "eye"}}'); // constant action cell stays literal in the loop body
    // member-0's content stays as the data-sw-text DEFAULT (the fallback), but the OTHER members' varying
    // content is NOT baked into the shared template (it lives in their page.data).
    expect(g.templateSource).not.toContain('Energy');
    expect(g.templateSource).not.toContain('Mining');

    const agri = g.members.find((m) => m.id === 'agri')!;
    expect(agri.consumedSlugs).toEqual(['p1']);
    expect(agri.data.projects).toEqual([{ name: 'Alpha' }, { name: 'Beta' }]);
    expect(Object.values(agri.data)).toContain('Agri Industrial'); // hero title captured into page.data
    expect(() => validateTemplate(g.templateSource)).not.toThrow();

    // Render-equivalence: template + agri data reproduces the agri page.
    const fromTpl = renderTemplate(g.templateSource, { page: { data: agri.data } } as never);
    expect(fromTpl).toContain('Agri Industrial');
    expect(fromTpl).toContain('Alpha');
    expect(fromTpl).toContain('Apply now');
  });

  it('does NOT template a group below the minimum', async () => {
    const pages = [{ id: 'a', group: 'services', source: svc('A', 'x', 'p1') }, { id: 'b', group: 'services', source: svc('B', 'y', 'p2') }];
    expect(await extractTemplates(pages, (s) => ITEMS[s] ?? [], probe)).toHaveLength(0);
  });

  it('does NOT emit a template when siblings are structurally too different (quality/render gate)', async () => {
    const pages = [
      { id: 'a', group: 'services', source: svc('A', 'x', 'p1') },
      { id: 'b', group: 'services', source: svc('B', 'y', 'p2') },
      { id: 'c', group: 'services', source: '<section class="hero"><h1>C</h1></section><div class="other"><p>totally</p><p>different</p><ul><li>1</li><li>2</li></ul></div>' },
    ];
    // same parent group, but c shares almost no structure → bind/LOC/render gate rejects → no template.
    expect(await extractTemplates(pages, (s) => ITEMS[s] ?? [], probe)).toHaveLength(0);
  });
});
