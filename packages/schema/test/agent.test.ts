import { describe, it, expect } from 'vitest';
import { DEFAULT_AGENT_INSTRUCTIONS, AGENT_GUIDES, GUIDE_TOPICS } from '../src/agent.js';

describe('DEFAULT_AGENT_INSTRUCTIONS', () => {
  it('stays brand-neutral — no hardcoded platform name (white-label safe)', () => {
    // The agent/MCP instructions must read generically ("this server"/"this project") so a
    // white-labeled instance never leaks the "SiteWright" brand to a connected agent.
    expect(DEFAULT_AGENT_INSTRUCTIONS.toLowerCase()).not.toContain('sitewright');
    for (const t of GUIDE_TOPICS) expect(AGENT_GUIDES[t].body.toLowerCase()).not.toContain('sitewright');
  });

  it('still describes the core authoring workflow', () => {
    expect(DEFAULT_AGENT_INSTRUCTIONS).toContain('get_scope');
    expect(DEFAULT_AGENT_INSTRUCTIONS).toContain('CODE-FIRST static website');
  });

  it('is a SMALL core (feature how-tos moved to on-demand guides)', () => {
    // The served instructions are the core + a generated topic index — kept well under the old ~24k
    // monolith so it isn't a heavy up-front prompt.
    expect(DEFAULT_AGENT_INSTRUCTIONS.length).toBeLessThan(13_000);
    // and it advertises the on-demand guide mechanism + every topic with its (drift-free) summary.
    expect(DEFAULT_AGENT_INSTRUCTIONS).toContain('get_guide');
    for (const t of GUIDE_TOPICS) {
      expect(DEFAULT_AGENT_INSTRUCTIONS).toContain(`- ${t} — ${AGENT_GUIDES[t].summary}`);
    }
  });

  it('the design guide leads the index and the core steers the agent to it', () => {
    // Design is the first (most foundational) guide.
    expect(GUIDE_TOPICS[0]).toBe('design');
    // The core nudges the agent to read it before laying out a page (so it is not under-used).
    expect(DEFAULT_AGENT_INSTRUCTIONS).toContain('get_guide("design")');
    // It carries the flagship section toolkit, not just prose.
    const body = AGENT_GUIDES.design.body;
    for (const probe of ['HERO', 'ALTERNATING FEATURE ROWS', 'STATS BAND', 'CLOSING CTA', 'type scale', '6-9']) {
      expect(body).toContain(probe);
    }
  });

  it('every guide has a title, summary, and non-trivial body', () => {
    expect(GUIDE_TOPICS).toEqual(['design', 'components', 'images', 'effects', 'i18n', 'shop', 'templates', 'icons', 'nav', 'import']);
    for (const t of GUIDE_TOPICS) {
      const g = AGENT_GUIDES[t];
      expect(g.title).toBeTruthy();
      expect(g.summary).toBeTruthy();
      expect(g.body.trim().length).toBeGreaterThan(200);
    }
  });

  it('the import guide teaches the rewrite handoff (marker, draft, checklist) and the core points at it', () => {
    expect(DEFAULT_AGENT_INSTRUCTIONS).toContain('get_guide("import")');
    expect(DEFAULT_AGENT_INSTRUCTIONS).toContain('data.swImport');
    const body = AGENT_GUIDES.import.body;
    for (const probe of ['swImport', 'rewritten:false', 'status:"draft"', 'import_image', 'STRIPPED']) {
      expect(body).toContain(probe);
    }
  });

  it('preserves the original feature content (each section lives in core or a guide)', () => {
    // A distinctive phrase from each former section must survive somewhere (the split lost nothing).
    const all = DEFAULT_AGENT_INSTRUCTIONS + Object.values(AGENT_GUIDES).map((g) => g.body).join('\n');
    for (const probe of [
      'data-sw-component', // components
      'FORMS (contact', // forms (folded into components)
      'search_stock_images', // images
      'data-aos=', // animations (effects)
      'waves-effect', // ripple (effects)
      'sw-nav-', // nav effects (effects)
      'CUSTOM EFFECT', // custom code (effects)
      'translationGroup', // i18n
      'LOCALIZED DATA', // i18n
      'sw-add-to-cart', // shop
      'global:landing', // templates
      'sw-flag', // icons
      'NAV PLACEHOLDERS', // nav
      'sw-active', // nav
      'sw-control', // core
      'SET THE BRAND', // core
    ]) {
      expect(all).toContain(probe);
    }
  });
});
