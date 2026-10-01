/**
 * What changed between two stored snapshots of one content entity.
 *
 * ★ WHY NOT JUST SHOW THE JSON. A revision row says a page was saved; it cannot say that the only
 * thing that moved was the meta description. Reading that out of two snapshots means reading two
 * documents side by side and spotting the difference by eye, which for a page `source` is hopeless.
 * So the History row's Details view needs a FIELD-LEVEL answer — and that is a pure function of the
 * two snapshots, which is why it lives here, away from React, and is tested as one.
 *
 * Deliberately NOT a general-purpose diff library:
 *  - Scalars are reported as before → after, which is the whole story for a title or a flag.
 *  - Multi-LINE strings get a line diff, because a page's source is the field people actually need
 *    to inspect and "the string changed" tells them nothing.
 *  - Arrays are compared by INDEX. Honest and cheap; an insertion at the front reads as "everything
 *    after it changed", which is wrong-ish but never misleading in the way a silent omission is.
 *  - Depth and volume are bounded (see MAX_DEPTH / MAX_CHANGES), because a snapshot can be megabytes
 *    and this renders inside a modal.
 */

export type ChangeKind = 'added' | 'removed' | 'changed';

export interface FieldChange {
  /** Dotted path into the document, e.g. `seo.description` or `artboards.0.title`. */
  path: string;
  kind: ChangeKind;
  /** Rendered values — `undefined` when the side does not exist. */
  before?: string;
  after?: string;
  /** Present when both sides are multi-line text: a line-level diff. */
  lines?: LineChange[];
  /** True when the rendered value was shortened for display. */
  truncated?: boolean;
}

export interface LineChange {
  kind: 'add' | 'remove' | 'context';
  text: string;
}

const MAX_DEPTH = 4;
const MAX_CHANGES = 200;
const MAX_VALUE_CHARS = 2000;
const MAX_LINES = 400;
/** Context lines kept either side of a run of changes, so a line diff stays readable. */
const CONTEXT = 2;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A value as the UI should show it: strings verbatim, everything else as compact JSON. */
export function renderValue(v: unknown): string {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

const clip = (s: string): { text: string; truncated: boolean } =>
  s.length > MAX_VALUE_CHARS ? { text: `${s.slice(0, MAX_VALUE_CHARS)}…`, truncated: true } : { text: s, truncated: false };

/**
 * A line diff over two multi-line strings — longest-common-subsequence on LINES, which is small
 * enough to compute here (bounded by MAX_LINES) and is what makes a source edit legible.
 */
export function diffLines(before: string, after: string): LineChange[] {
  const a = before.split('\n').slice(0, MAX_LINES);
  const b = after.split('\n').slice(0, MAX_LINES);
  // LCS table. |a|,|b| <= MAX_LINES so this is at most 400x400 cells.
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      // eslint-disable-next-line security/detect-object-injection -- numeric loop indices
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: LineChange[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'context', text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: 'remove', text: a[i]! });
      i++;
    } else {
      out.push({ kind: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ kind: 'remove', text: a[i++]! });
  while (j < m) out.push({ kind: 'add', text: b[j++]! });
  return trimContext(out);
}

/** Keep only CONTEXT lines around each run of changes — an unchanged 300-line file is not the news. */
function trimContext(lines: LineChange[]): LineChange[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, idx) => {
    if (l.kind === 'context') return;
    for (let k = Math.max(0, idx - CONTEXT); k <= Math.min(lines.length - 1, idx + CONTEXT); k++) keep[k] = true;
  });
  const out: LineChange[] = [];
  let skipping = false;
  lines.forEach((l, idx) => {
    // eslint-disable-next-line security/detect-object-injection -- numeric index over a local array
    if (keep[idx]) {
      out.push(l);
      skipping = false;
    } else if (!skipping) {
      out.push({ kind: 'context', text: '…' });
      skipping = true;
    }
  });
  return out;
}

/**
 * Compare two snapshots and return the fields that differ.
 *
 * `before === undefined` means this is the FIRST revision of the entity: everything in `after` reads
 * as added, which is the truthful answer rather than an empty diff.
 */
export function diffSnapshots(before: unknown, after: unknown): FieldChange[] {
  const changes: FieldChange[] = [];
  walk(before, after, '', 0, changes);
  return changes.slice(0, MAX_CHANGES);
}

function push(changes: FieldChange[], c: FieldChange): void {
  if (changes.length < MAX_CHANGES) changes.push(c);
}

function leaf(path: string, before: unknown, after: unknown, changes: FieldChange[]): void {
  const kind: ChangeKind = before === undefined ? 'added' : after === undefined ? 'removed' : 'changed';
  const b = clip(renderValue(before));
  const a = clip(renderValue(after));
  const change: FieldChange = {
    path,
    kind,
    ...(before === undefined ? {} : { before: b.text }),
    ...(after === undefined ? {} : { after: a.text }),
    ...(b.truncated || a.truncated ? { truncated: true } : {}),
  };
  // A multi-line string on BOTH sides is where a line diff earns its place.
  if (typeof before === 'string' && typeof after === 'string' && (before.includes('\n') || after.includes('\n'))) {
    change.lines = diffLines(before, after);
  }
  push(changes, change);
}

function walk(beforeIn: unknown, after: unknown, path: string, depth: number, changes: FieldChange[]): void {
  if (Object.is(beforeIn, after)) return;
  if (changes.length >= MAX_CHANGES) return;

  // A FIRST revision has no `before` at all. At the document root, descend anyway with an empty
  // object on the missing side, so it reads as one row per field rather than one row holding the
  // whole document. Deeper down the opposite is true — a newly added nested object is more legible
  // as a single JSON value than as twenty separate "added" rows — so this applies at depth 0 only.
  // A const, not a reassigned parameter: the narrowing below depends on it.
  const before =
    depth === 0 && beforeIn === undefined && (isRecord(after) || Array.isArray(after))
      ? Array.isArray(after)
        ? []
        : {}
      : beforeIn;

  const bothRecords = isRecord(before) && isRecord(after);
  const bothArrays = Array.isArray(before) && Array.isArray(after);

  if (depth >= MAX_DEPTH || (!bothRecords && !bothArrays)) {
    // One side is a scalar, the shapes differ, or we are as deep as this view goes: report the value.
    if (JSON.stringify(before) !== JSON.stringify(after)) leaf(path, before, after, changes);
    return;
  }

  if (bothArrays) {
    const len = Math.max(before.length, after.length);
    for (let i = 0; i < len; i++) {
      // eslint-disable-next-line security/detect-object-injection -- numeric loop index
      walk(before[i], after[i], path ? `${path}.${i}` : String(i), depth + 1, changes);
    }
    return;
  }

  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    walk(b[key], a[key], path ? `${path}.${key}` : key, depth + 1, changes);
  }
}

/** A one-line summary for the modal header — "3 fields changed, 1 added". */
export function summarise(changes: FieldChange[]): string {
  if (changes.length === 0) return 'No field-level differences';
  const n = (k: ChangeKind) => changes.filter((c) => c.kind === k).length;
  const parts: string[] = [];
  const changed = n('changed');
  const added = n('added');
  const removed = n('removed');
  if (changed) parts.push(`${changed} changed`);
  if (added) parts.push(`${added} added`);
  if (removed) parts.push(`${removed} removed`);
  const total = changes.length;
  return `${total} field${total === 1 ? '' : 's'} — ${parts.join(', ')}`;
}
