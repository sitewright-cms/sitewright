/**
 * Section-addressable guides.
 *
 * `get_guide("import")` returns 54k characters. An agent that needs one fact — how a chrome slot
 * differs from a page, say — pays for all of it, and in the measured clone runs the response
 * overflowed the tool-output cap, spilled to a file, and had to be re-read. Every agent in the fleet
 * paid that toll at least once.
 *
 * So a large guide becomes addressable: ask for a section, get that section. The split is by
 * EXTRACTION, never by classification — a section owns a block only when the block's opening phrase
 * matches a declared prefix. That direction matters. A guide edit that rewrites a lead phrase
 * un-claims its block, and an un-claimed block lands in the default section, which is always
 * returned. The failure mode is "you were shown something you didn't ask for", never "a rule was
 * silently withheld".
 */

/** Blank-line-separated blocks, which is how every guide body is already written. */
export function guideBlocks(body: string): string[] {
  return body
    .trim()
    .split(/\n\s*\n/)
    .map((b) => b.trimEnd())
    .filter((b) => b.trim().length > 0);
}

/** The first line of a block, which every guide uses as its topic sentence. */
export function blockLead(block: string): string {
  return (block.split('\n')[0] ?? '').trim();
}

export interface GuideSectionDef {
  readonly key: string;
  readonly summary: string;
  /** A block belongs here when its lead line starts with one of these (case-sensitive — the leads are SHOUTED). */
  readonly leads: readonly string[];
}

/**
 * Only guides big enough to hurt get a map. Everything else stays whole, because a second round-trip
 * costs more than the bytes it saves.
 */
export const GUIDE_SECTIONS: Readonly<Record<string, readonly GuideSectionDef[]>> = {
  import: [
    {
      key: 'pages',
      summary: 'Porting one page to native markup: the per-page checklist and container patterns.',
      leads: ['NATIVIZE =', 'FIND THEM:', 'PORT CHECKLIST'],
    },
    {
      key: 'chrome',
      summary: 'Header/footer slots, the default nav, and signature chrome CSS via website.criticalCss.',
      leads: ['CHROME (', 'SIGNATURE CHROME CSS'],
    },
    {
      key: 'fidelity',
      summary: 'The misses that keep recurring, plus the by-measurement polish pass.',
      leads: ['COMMON FIDELITY MISSES', 'FINE POLISH'],
    },
    {
      key: 'verify',
      summary: 'Proving a page is done: clone_audit, visual_audit, and the per-page acceptance bar.',
      leads: [
        'VERIFY AGAINST THE SOURCE',
        'Each page has ONE visual terminator',
        'The STRUCTURE + BEHAVIOUR facts',
        'WHEN A PAGE IS DONE',
      ],
    },
    {
      key: 'cleanup',
      summary: 'Deleting the foreign files, re-enabling stripped site-wide features, and what import made inert.',
      leads: ['CLEAN UP THE FOREIGN FILES', 'RE-ENABLE SITE-WIDE FEATURES', 'SAFETY:'],
    },
  ],
};

/** The section every unclaimed block falls into. Returned whenever no section is requested. */
export const DEFAULT_SECTION = 'overview';

export interface SectionedGuide {
  readonly key: string;
  readonly summary: string;
  readonly blocks: readonly string[];
  readonly chars: number;
}

/**
 * Group a body into its declared sections. `overview` comes first and collects everything unclaimed;
 * declared sections follow in map order. Sections that ended up empty are dropped.
 */
export function sectionGuide(topic: string, body: string): SectionedGuide[] {
  // eslint-disable-next-line security/detect-object-injection -- reading a fixed literal map by guide topic
  const defs = GUIDE_SECTIONS[topic];
  if (!defs) return [];

  const overview: string[] = [];
  const claimed = new Map<string, string[]>(defs.map((d) => [d.key, []]));

  for (const block of guideBlocks(body)) {
    const lead = blockLead(block);
    const owner = defs.find((d) => d.leads.some((p) => lead.startsWith(p)));
    if (owner) claimed.get(owner.key)?.push(block);
    else overview.push(block);
  }

  const chars = (blocks: string[]): number => blocks.reduce((n, b) => n + b.length + 2, 0);
  const out: SectionedGuide[] = [
    {
      key: DEFAULT_SECTION,
      summary: 'What an import is, how to run the clone, and anything not claimed by a section below.',
      blocks: overview,
      chars: chars(overview),
    },
  ];
  for (const d of defs) {
    const blocks = claimed.get(d.key) ?? [];
    if (blocks.length > 0) out.push({ key: d.key, summary: d.summary, blocks, chars: chars(blocks) });
  }
  return out;
}

/** Resolve a caller-supplied section name against a guide. `all` is the escape hatch for the whole body. */
export function resolveSection(
  sections: readonly SectionedGuide[],
  requested: string | undefined,
): { readonly match?: SectionedGuide; readonly all: boolean; readonly unknown?: string } {
  const want = (requested ?? '').trim().toLowerCase();
  if (!want) return { all: false };
  if (want === 'all' || want === 'full') return { all: true };
  const match = sections.find((s) => s.key === want);
  return match ? { match, all: false } : { all: false, unknown: want };
}
