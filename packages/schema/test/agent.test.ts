import { describe, it, expect } from 'vitest';
import { DEFAULT_AGENT_INSTRUCTIONS, AGENT_GUIDES, GUIDE_TOPICS, buildCapabilitiesIndex, CAPABILITY_MAP, WRITE_KINDS } from '../src/agent.js';
import { NAV_SLOTS } from '../src/page.js';
import { FieldTypeSchema } from '../src/dataset.js';
import { SW_HELPERS } from '../src/authoring-reference.js';

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

  it('tells the agent the connected project IS the authorization', () => {
    // A clone agent stopped after building only the chrome and declined to port 16 page bodies,
    // reasoning that nothing in the task established authorization from the site's owner. The
    // operator who granted the project token IS that party, and nothing said so.
    expect(DEFAULT_AGENT_INSTRUCTIONS).toContain('YOU ARE AUTHORIZED');
    // …without becoming a blanket "never refuse anything": impersonation stays the agent's call.
    expect(DEFAULT_AGENT_INSTRUCTIONS).toMatch(/impersonat/i);
  });

  it('is a SMALL core (feature how-tos moved to on-demand guides)', () => {
    // The served instructions are the core + a generated topic index — kept well under the old ~24k
    // monolith (and the 32k admin-override max) so it isn't a heavy up-front prompt. (Ceiling covers the
    // general behaviour directives — build-in-stages, editable, datasets, components, icons,
    // preview-sparingly, snappy-chat, the explicit write-tool argument shapes that keep weaker models from
    // omitting required args, the chrome-slot vs page distinction, the get_capabilities discovery index,
    // and the dataset write-shape gotcha — core rules that shape EVERY session, not feature how-tos.)
    // 18_800 -> 19_200 when patch_page joined the core: put_page is a TOTAL replace that silently deletes
    // omitted fields (data.swImport included, which makes a page un-auditable), so which of the two to
    // reach for is a destructive-write rule that has to be in the always-loaded core, not a guide.
    // 19_200 -> 19_800 for the authorization line: an agent stopped a clone half-way and handed back 16
    // pages of raw scaffold because nothing told it that a connected project IS the authorization. That
    // is a directive shaping whether a session COMPLETES AT ALL, so it belongs in the core, not a guide.
    // 19_800 -> 20_200 for the null-clears-a-field line: it is the same class of destructive-write rule
    // that put patch_page in the core in the first place. A field can only be REMOVED by sending it as
    // `null` (omitting means "leave unchanged", and `template:""` fails validation), and not knowing that
    // is precisely what sent three clone agents to put_page — the total replace that wipes data.swImport
    // and leaves the page un-auditable. The feature how-tos this unlocks room for stay in their guides.
    expect(DEFAULT_AGENT_INSTRUCTIONS.length).toBeLessThan(20_200);
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

  it('teaches CHROME SLOT authoring (website.mainNav/footer) so header/footer are not built as pages', () => {
    // The exact failure a weaker model hit: it made pages/templates named header/footer instead of
    // filling the site-wide slots. The core AND the nav guide must name the real mechanism.
    for (const probe of ['website.mainNav', 'website.footer']) {
      expect(DEFAULT_AGENT_INSTRUCTIONS).toContain(probe);
      expect(AGENT_GUIDES.nav.body).toContain(probe);
    }
    // and it must be framed as settings (not a page/template)
    expect(AGENT_GUIDES.nav.body).toMatch(/CHROME SLOTS/);
  });

  it('documents the nav-authoring gotchas that broke a real clone run', () => {
    const nav = AGENT_GUIDES.nav.body;
    // A kind:"link" placeholder still needs a (empty) path — the schema rejects a missing path.
    expect(nav).toMatch(/path:""/);
    // Home detection: path "/" is truthy, so {{#unless path}} never fires — must steer to @first/exact.
    expect(nav).toContain('{{#unless path}}');
    expect(nav).toMatch(/@first|exact=true/);
    // A header-triggered global modal lives in website.bottom, a validated slot (must be nativized).
    expect(nav).toContain('website.bottom');
  });

  it('documents the settings merge:true patch option in the core + nav guide', () => {
    expect(DEFAULT_AGENT_INSTRUCTIONS).toContain('merge:true');
    expect(AGENT_GUIDES.nav.body).toContain('merge:true');
  });

  // MCP agents only ever learn about a plain CSS class if a guide names it — there is no registry to
  // derive it from (unlike COMPONENT_CATALOG). Pin both the guide text and the capability index entry,
  // which is what an agent searches when the user asks for "an animated border".
  it('the effects guide teaches sw-border-beam, and the capability map routes to it', () => {
    const body = AGENT_GUIDES.effects.body;
    expect(body).toContain('sw-border-beam');
    for (const knob of ['--sw-beam-color', '--sw-beam-track', '--sw-beam-width', '--sw-beam-speed', '--sw-beam-arc']) {
      expect(body, knob).toContain(knob);
    }
    const hit = CAPABILITY_MAP.find((c) => c.where.includes('sw-border-beam'));
    expect(hit, 'no CAPABILITY_MAP entry points at sw-border-beam').toBeTruthy();
    expect(hit!.need).toMatch(/border/i);
  });

  it('every guide has a title, summary, and non-trivial body', () => {
    expect(GUIDE_TOPICS).toEqual(['design', 'components', 'images', 'effects', 'i18n', 'shop', 'consent', 'templates', 'icons', 'nav', 'import', 'datasets']);
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
    for (const probe of ['swImport', 'rewritten:false', 'status:"draft"', 'import_image', 'inert <div>']) {
      expect(body).toContain(probe);
    }
  });

  it('the import/nativize guide enumerates EVERY dataset field type + points at the datasets guide', () => {
    // The clone/nativize agent reads the import guide; it must know the FULL field-type palette so it
    // picks the most specific type (datetime/folder/reference/list…) instead of dumping all into text.
    const body = AGENT_GUIDES.import.body;
    for (const t of FieldTypeSchema.options) {
      expect(body, `import guide is missing field type "${t}"`).toMatch(new RegExp(`\\b${t}\\b`));
    }
    expect(body).toContain('get_guide("datasets")');
  });

  it('preserves the original feature content (each section lives in core or a guide)', () => {
    // A distinctive phrase from each former section must survive somewhere (the split lost nothing).
    const all = DEFAULT_AGENT_INSTRUCTIONS + Object.values(AGENT_GUIDES).map((g) => g.body).join('\n');
    for (const probe of [
      'data-sw-component', // components
      'FORMS (contact', // forms (folded into components)
      'search_stock_images', // images
      'data-sw-animation=', // animations (effects)
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

// The MCP docs (this CORE + every get_guide body, incl. the import/clone guide) are hand-written PROSE
// — unlike the get_reference registries (SW_HELPERS / BINDING_NAMESPACES / SW_DIRECTIVES) they are NOT
// otherwise pinned to the engine, so a binding rename can silently leave a guide EXAMPLE stale. These
// guards pin the docs' binding SYNTAX to the source of truth so that class of drift fails CI.
describe('MCP docs ↔ engine binding drift guards', () => {
  const allDocs = DEFAULT_AGENT_INSTRUCTIONS + '\n' + Object.values(AGENT_GUIDES).map((g) => g.body).join('\n');
  // Same chain scanner as @sitewright/core pages.ts: a `pages.<seg>(.<seg>)*` chain, each seg a dotted
  // identifier or a [bracketed] key.
  // eslint-disable-next-line security/detect-unsafe-regex -- linear (non-overlapping branches); same regex as @sitewright/core pages.ts
  const CHAIN_RE = /(?<![\w.-])pages((?:\.[A-Za-z_][\w-]*|\.\[[^\]]+\])+)/g;
  const SEG_RE = /\.\[([^\]]+)\]|\.([A-Za-z_][\w-]*)/g;

  it('no doc uses the retired pre-_attributes cross-page pages.<slug>.<field> syntax', () => {
    // Since #555 a node's OWN fields live under `_attributes`; a `pages.*` chain that reads one of these
    // fields WITHOUT the `_attributes` hop is the retired syntax and now renders empty.
    const NODE_FIELDS = new Set(['data', 'title', 'path', 'slug', 'locale', 'image', 'description', 'children', 'code', 'template']);
    const stale: string[] = [];
    for (const m of allDocs.matchAll(CHAIN_RE)) {
      const segs: string[] = [];
      for (const s of m[1]!.matchAll(SEG_RE)) segs.push((s[1] ?? s[2])!);
      if (!segs.includes('_attributes') && segs.some((x) => NODE_FIELDS.has(x))) stale.push(`pages${m[1]}`);
    }
    expect(stale, `retired pages.<slug>.<field> — use pages.<slug>._attributes.<field>: ${stale.join(', ')}`).toEqual([]);
  });

  it('every {{sw-*}} helper invoked in the docs is a real registered helper', () => {
    // SW_HELPERS is itself pinned to the engine's registered sw-* helpers (blocks authoring-reference.test),
    // so this transitively pins the docs to the engine. Matches ONLY helper INVOCATIONS ({{sw-x}}, {{#sw-x}},
    // {{/sw-x}}, or a (sw-x …) subexpression) — never a data-sw-* directive or a class="sw-*" effect.
    const known = new Set(SW_HELPERS.map((h) => h.name));
    const unknown = new Set<string>();
    for (const m of allDocs.matchAll(/(?:\{\{[#/]?\s*|\(\s*)(sw-[a-z][a-z-]*)/g)) if (!known.has(m[1]!)) unknown.add(m[1]!);
    expect([...unknown], `docs invoke unknown sw-* helper(s) (typo/renamed/removed?): ${[...unknown].join(', ')}`).toEqual([]);
  });

  it('every nav.<slot> looped in the docs is a real NAV_SLOT', () => {
    // The render binding `{{#each nav.<slot>}}` / `{{nav.<slot>}}` — NOT the page-settings `nav.slots`/
    // `nav.order`/`nav.dropdown` config fields (those never appear inside a mustache).
    const known = new Set<string>(NAV_SLOTS);
    const unknown = new Set<string>();
    for (const m of allDocs.matchAll(/\{\{(?:#each\s+|\s*)nav\.([a-z]+)/g)) if (!known.has(m[1]!)) unknown.add(m[1]!);
    expect([...unknown], `docs loop nav.<slot> that isn't a NAV_SLOT: ${[...unknown].join(', ')}`).toEqual([]);
  });
});

describe('datasets guide — the write shape a weak agent gets wrong', () => {
  const body = AGENT_GUIDES.datasets.body;
  it('teaches that entry row data goes under `values` (the read/write asymmetry)', () => {
    // The exact silent-failure: writing flat entry data strips the fields and saves values:{} empty.
    expect(body).toContain('values');
    expect(body).toMatch(/data = \{ values:/);
    expect(body).toMatch(/saves EMPTY|values:\{\}/);
  });
  it('teaches the underscore-identifier rule for slugs + entry ids (no hyphens)', () => {
    expect(body).toMatch(/faq_passengers/);
    expect(body).toMatch(/NOT ["“]?faq-passengers|not "?faq-passengers/i);
  });
  it('names the two-step write (dataset schema, then entries) and the dataset arg', () => {
    expect(body).toMatch(/put_content\(\{ kind: "dataset"/);
    expect(body).toMatch(/put_content\(\{ kind: "entry".*dataset:/);
  });
  it('the core bootstrap also flags the values gotcha + points at the guide', () => {
    expect(DEFAULT_AGENT_INSTRUCTIONS).toContain('data.values');
    expect(DEFAULT_AGENT_INSTRUCTIONS).toContain('get_guide("datasets")');
  });
  it('enumerates EVERY dataset field type (drift guard against FieldTypeSchema)', () => {
    // If a new type is added to the enum, the MCP-agent-facing guide MUST mention it so agents know it
    // exists (word-boundary so `time` isn't spuriously satisfied by `datetime`).
    for (const t of FieldTypeSchema.options) {
      expect(body, `datasets guide is missing field type "${t}"`).toMatch(new RegExp(`\\b${t}\\b`));
    }
  });
});

describe('get_capabilities index', () => {
  const idx = buildCapabilitiesIndex();
  it('composes guides + components + write kinds from the single sources of truth', () => {
    expect(idx.guides.map((g) => g.topic)).toEqual([...GUIDE_TOPICS]);
    expect(idx.components.length).toBeGreaterThan(0); // catalog present
    expect(idx.components.every((c) => c.type && c.marker)).toBe(true);
    expect(idx.writeKinds).toBe(WRITE_KINDS);
    expect(idx.writeKinds.find((w) => w.kind === 'entry')?.shape).toMatch(/values/);
  });
  it('the need→where map covers the primitives that were wrongly assumed missing', () => {
    const needs = CAPABILITY_MAP.map((c) => c.need.toLowerCase()).join(' | ');
    for (const probe of ['ripple', 'modal', 'drawer', 'carousel', 'collections', 'languages']) {
      expect(needs).toContain(probe);
    }
    // and it points ripple at the effects guide (not "unsupported")
    expect(CAPABILITY_MAP.find((c) => c.need.includes('ripple'))?.where).toMatch(/effects/);
  });
  it('the bootstrap advertises get_capabilities as the anti-"assume-missing" index', () => {
    expect(DEFAULT_AGENT_INSTRUCTIONS).toContain('get_capabilities');
  });
});
