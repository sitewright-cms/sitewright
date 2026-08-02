/**
 * Subtract the ORIGINAL's clipping from the clone's.
 *
 * The clip check measures something real — an element cut off by an ancestor's overflow is invisible to
 * getBoundingClientRect, so no measurement an agent naturally reaches for can see it. But on its own it
 * cannot tell a BROKEN layout from a DELIBERATE bleed, and gating on that ambiguity did measurable
 * damage: to turn it green, agents replaced `<img>` elements with background-image divs (41 alt texts
 * down to 6 on one page, 18 down to 4 on another), swapped an accordion's `max-width:0` slide-open for
 * `display:none`, and shrank icons the design intentionally bleeds past a tile edge. Four fidelity
 * regressions, no real defect among them. The check was made advisory as damage control.
 *
 * The missing input was always the original. A clone is a PORT of a specific design — if that design
 * clips an image at the edge of a card, the clone doing the same is fidelity, not a defect. So: probe
 * both, and report only what the original does NOT do.
 *
 * PAIRING. Selectors cannot pair across the two renders — a faithful native port has entirely different
 * markup from the source, which is the whole point. What survives the rewrite is the DESIGN DECISION:
 * "this design cuts images off horizontally". So the signature is tag + clipped axis, deliberately
 * coarse. A coarse signature errs toward suppressing a finding rather than inventing one, which is the
 * correct direction for a check with this history.
 */

export interface ClipFinding {
  readonly el: string;
  readonly clippedBy: string;
  readonly box: string;
  readonly visible: string;
  readonly lost: string;
  /** Present on renders probed after the original-comparison change; absent on older cached results. */
  readonly tag?: string;
  readonly axis?: string;
}

/**
 * The pairing key. Falls back to parsing the leading token of `el` so a finding captured before the
 * probe emitted `tag`/`axis` still pairs instead of being treated as unmatched (which would report it).
 */
export function clipSignature(c: ClipFinding): string {
  const tag = (c.tag ?? c.el.split(/[.#]/)[0] ?? '').toLowerCase();
  const axis = c.axis ?? '?';
  return `${tag}|${axis}`;
}

export interface ClipDiff {
  /** Clone clips the original does NOT make — the only ones worth acting on. */
  readonly novel: readonly ClipFinding[];
  /** Clone clips the original makes too, suppressed as intended design. */
  readonly matchedOriginal: number;
  /** Whether an original-side probe actually ran. False means `novel` is simply everything. */
  readonly compared: boolean;
}

/**
 * Diff the clone's clipping against the original's.
 *
 * `original === null` means no source was available (no import provenance, or the source render failed).
 * That is reported honestly via `compared:false` rather than being papered over: without the original
 * there is no basis to call any of these a defect, so the caller keeps the check advisory.
 */
export function diffClips(
  clone: readonly ClipFinding[] | undefined,
  original: readonly ClipFinding[] | null | undefined,
): ClipDiff {
  const found = clone ?? [];
  if (!original) return { novel: found, matchedOriginal: 0, compared: false };

  const source = new Set(original.map(clipSignature));
  const novel = found.filter((c) => !source.has(clipSignature(c)));
  return { novel, matchedOriginal: found.length - novel.length, compared: true };
}

/** One line per finding, for an audit `detail` string. */
export function describeClips(findings: readonly ClipFinding[]): string {
  return findings.map((c) => `${c.el} cut ${c.lost} by ${c.clippedBy} (${c.box} -> ${c.visible})`).join('; ');
}
