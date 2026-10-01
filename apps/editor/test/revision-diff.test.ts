import { describe, it, expect } from 'vitest';
import { diffSnapshots, diffLines, summarise, renderValue } from '../src/lib/revision-diff';

describe('diffSnapshots', () => {
  it('reports only what moved, by path', () => {
    const before = { title: 'About', seo: { description: 'old', robots: 'index' }, draft: false };
    const after = { title: 'About', seo: { description: 'new', robots: 'index' }, draft: true };
    expect(diffSnapshots(before, after)).toEqual([
      { path: 'seo.description', kind: 'changed', before: 'old', after: 'new' },
      { path: 'draft', kind: 'changed', before: 'false', after: 'true' },
    ]);
  });

  it('distinguishes added from removed from changed', () => {
    const d = diffSnapshots({ a: 1, gone: 'x' }, { a: 2, fresh: 'y' });
    expect(d.find((c) => c.path === 'a')).toMatchObject({ kind: 'changed', before: '1', after: '2' });
    expect(d.find((c) => c.path === 'gone')).toMatchObject({ kind: 'removed', before: 'x' });
    expect(d.find((c) => c.path === 'gone')?.after).toBeUndefined();
    expect(d.find((c) => c.path === 'fresh')).toMatchObject({ kind: 'added', after: 'y' });
    expect(d.find((c) => c.path === 'fresh')?.before).toBeUndefined();
  });

  it('treats a FIRST revision as everything added, not as no changes', () => {
    // The oldest revision of an entity has no predecessor. An empty diff would read as "nothing
    // happened", which is the opposite of what that revision is.
    const d = diffSnapshots(undefined, { title: 'New page', path: 'about' });
    expect(d.map((c) => c.kind)).toEqual(['added', 'added']);
  });

  it('says nothing when nothing changed', () => {
    expect(diffSnapshots({ a: [1, 2], b: { c: 'x' } }, { a: [1, 2], b: { c: 'x' } })).toEqual([]);
  });

  it('walks arrays by index and names the element that moved', () => {
    const d = diffSnapshots({ items: [{ t: 'a' }, { t: 'b' }] }, { items: [{ t: 'a' }, { t: 'B' }] });
    expect(d).toEqual([{ path: 'items.1.t', kind: 'changed', before: 'b', after: 'B' }]);
  });

  it('reports a length change as the missing index, not as a silent omission', () => {
    const d = diffSnapshots({ xs: [1, 2] }, { xs: [1, 2, 3] });
    expect(d).toEqual([{ path: 'xs.2', kind: 'added', after: '3' }]);
  });

  it('attaches a LINE diff when both sides are multi-line text', () => {
    const before = 'line one\nline two\nline three';
    const after = 'line one\nline 2\nline three';
    const [change] = diffSnapshots({ source: before }, { source: after });
    expect(change!.path).toBe('source');
    expect(change!.lines).toEqual([
      { kind: 'context', text: 'line one' },
      { kind: 'remove', text: 'line two' },
      { kind: 'add', text: 'line 2' },
      { kind: 'context', text: 'line three' },
    ]);
  });

  it('bounds a huge value rather than rendering it whole into a modal', () => {
    const [change] = diffSnapshots({ blob: 'a' }, { blob: 'b'.repeat(5000) });
    expect(change!.truncated).toBe(true);
    expect(change!.after!.length).toBeLessThan(2100);
  });

  it('stops descending at a sensible depth instead of walking forever', () => {
    const deep = (v: unknown) => ({ a: { b: { c: { d: { e: v } } } } });
    const d = diffSnapshots(deep(1), deep(2));
    expect(d).toHaveLength(1);
    // Reported as the deepest path it walks to, with the subtree as the value.
    expect(d[0]!.path.split('.').length).toBeLessThanOrEqual(5);
  });
});

describe('diffLines', () => {
  it('elides long unchanged stretches, keeping context around each change', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 20', 'line twenty');
    const lines = diffLines(before, after);
    expect(lines.some((l) => l.kind === 'remove' && l.text === 'line 20')).toBe(true);
    expect(lines.some((l) => l.kind === 'add' && l.text === 'line twenty')).toBe(true);
    expect(lines.some((l) => l.text === '…')).toBe(true); // the elision marker
    expect(lines.length).toBeLessThan(15); // not all 40 lines
  });

  it('handles a pure addition and a pure deletion', () => {
    expect(diffLines('', 'a\nb').filter((l) => l.kind === 'add')).toHaveLength(2);
    expect(diffLines('a\nb', '').filter((l) => l.kind === 'remove')).toHaveLength(2);
  });
});

describe('summarise / renderValue', () => {
  it('counts by kind', () => {
    expect(summarise([])).toMatch(/No field-level differences/);
    expect(summarise(diffSnapshots({ a: 1, b: 1 }, { a: 2, c: 3 }))).toBe('3 fields — 1 changed, 1 added, 1 removed');
  });

  it('shows a string as itself and everything else as JSON', () => {
    expect(renderValue('hi')).toBe('hi');
    expect(renderValue({ a: 1 })).toBe('{"a":1}');
    expect(renderValue(null)).toBe('null');
    expect(renderValue(undefined)).toBe('');
  });
});
