import { describe, it, expect } from 'vitest';
import { AGENT_GUIDES, GUIDE_TOPICS, type GuideTopic } from '../src/agent.js';
import {
  GUIDE_SECTIONS,
  DEFAULT_SECTION,
  guideBlocks,
  sectionGuide,
  resolveSection,
} from '../src/guide-sections.js';

describe('sectionGuide', () => {
  it('only maps guides that are actually big enough to hurt', () => {
    // A second round-trip costs more than it saves on a small guide, so the map stays deliberately short.
    for (const topic of Object.keys(GUIDE_SECTIONS)) {
      expect(GUIDE_TOPICS).toContain(topic);
      expect(AGENT_GUIDES[topic as GuideTopic].body.length).toBeGreaterThan(20_000);
    }
  });

  it('returns nothing for an unmapped guide, so it is served whole', () => {
    expect(sectionGuide('icons', AGENT_GUIDES.icons.body)).toEqual([]);
  });

  // THE safety property. Sectioning must never make a rule unreachable: every block of the original
  // body has to survive into exactly one section. If a lead phrase is reworded, the block must fall
  // into `overview` (which is always served) rather than vanish.
  it('accounts for every block exactly once', () => {
    const body = AGENT_GUIDES.import.body;
    const all = guideBlocks(body);
    const sections = sectionGuide('import', body);
    const emitted = sections.flatMap((s) => s.blocks);

    expect(emitted.length).toBe(all.length);
    expect([...emitted].sort()).toEqual([...all].sort());
    expect(new Set(emitted).size).toBe(emitted.length); // no block claimed twice
  });

  it('puts the default section first and never lets it be empty', () => {
    const sections = sectionGuide('import', AGENT_GUIDES.import.body);
    expect(sections[0]?.key).toBe(DEFAULT_SECTION);
    expect(sections[0]?.blocks.length).toBeGreaterThan(0);
  });

  it('an unmatched lead phrase degrades into the default section rather than disappearing', () => {
    const body = 'PORT CHECKLIST (per page):\n  do the thing\n\nSOME LATER REWORDING. still important';
    const sections = sectionGuide('import', body);
    const overview = sections.find((s) => s.key === DEFAULT_SECTION);
    expect(overview?.blocks.join('')).toContain('SOME LATER REWORDING');
    expect(sections.find((s) => s.key === 'pages')?.blocks.join('')).toContain('PORT CHECKLIST');
  });

  it('actually cuts the bytes an agent pays for', () => {
    const body = AGENT_GUIDES.import.body;
    const sections = sectionGuide('import', body);
    const biggest = Math.max(...sections.map((s) => s.chars));
    // The whole point: no single section costs anything like the full guide.
    expect(biggest).toBeLessThan(body.length * 0.45);
    expect(sections.find((s) => s.key === DEFAULT_SECTION)?.chars).toBeLessThan(6_000);
  });

  it('every declared section claims at least one block', () => {
    // A section whose leads all went stale would silently vanish from the index; catch that here.
    const keys = sectionGuide('import', AGENT_GUIDES.import.body).map((s) => s.key);
    for (const def of GUIDE_SECTIONS.import ?? []) expect(keys).toContain(def.key);
  });
});

describe('resolveSection', () => {
  const sections = sectionGuide('import', AGENT_GUIDES.import.body);

  it('no request means no section — the caller gets the index', () => {
    expect(resolveSection(sections, undefined).all).toBe(false);
    expect(resolveSection(sections, '  ').match).toBeUndefined();
  });

  it('matches a section by key, case- and space-insensitively', () => {
    expect(resolveSection(sections, ' Chrome ').match?.key).toBe('chrome');
  });

  it('"all" is the escape hatch back to the whole body', () => {
    expect(resolveSection(sections, 'all').all).toBe(true);
    expect(resolveSection(sections, 'full').all).toBe(true);
  });

  it('reports an unknown section instead of silently serving the wrong thing', () => {
    const r = resolveSection(sections, 'chrom');
    expect(r.unknown).toBe('chrom');
    expect(r.match).toBeUndefined();
    expect(r.all).toBe(false);
  });
});
