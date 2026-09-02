import { describe, it, expect } from 'vitest';
import {
  RICH_TABLE_OPS,
  RICH_TABLE_OP_IDS,
  RICH_TABLE_SIZE_RE,
  RICH_TABLE_STARTER,
  RICH_TABLE_MIN_COL,
  RICH_TABLE_MAX,
  clampTableDim,
  setStyleDecl,
  getStyleDecl,
  type RichTableOp,
} from '../src/rich-table.js';
import { sanitizeRichHtml } from '../src/sanitize-rich.js';

describe('RICH_TABLE_OPS', () => {
  it('has a unique, non-empty id + label for every op', () => {
    const ops = RICH_TABLE_OPS.filter((o): o is RichTableOp => o !== null);
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      expect(op.id).toMatch(/^[a-z-]+$/);
      expect(op.label.length).toBeGreaterThan(0);
    }
    expect(new Set(ops.map((o) => o.id)).size).toBe(ops.length);
  });
  it('exposes the same ids through RICH_TABLE_OP_IDS', () => {
    const ops = RICH_TABLE_OPS.filter((o): o is RichTableOp => o !== null);
    expect(RICH_TABLE_OP_IDS.size).toBe(ops.length);
    for (const op of ops) expect(RICH_TABLE_OP_IDS.has(op.id)).toBe(true);
  });
  it('marks the destructive ops as danger', () => {
    const danger = RICH_TABLE_OPS.filter((o): o is RichTableOp => o !== null && !!o.danger).map((o) => o.id);
    expect(danger).toEqual(['row-delete', 'col-delete', 'table-delete']);
  });
});

describe('clampTableDim', () => {
  it('rounds and keeps a value inside the bounds', () => {
    expect(clampTableDim(120.4, RICH_TABLE_MIN_COL)).toBe(120);
  });
  it('clamps below the minimum up to it', () => {
    expect(clampTableDim(4, RICH_TABLE_MIN_COL)).toBe(RICH_TABLE_MIN_COL);
  });
  it('clamps an absurd width to the ceiling', () => {
    expect(clampTableDim(999999, RICH_TABLE_MIN_COL)).toBe(RICH_TABLE_MAX);
  });
  it('returns null for a non-finite input', () => {
    expect(clampTableDim(Number.NaN, RICH_TABLE_MIN_COL)).toBeNull();
    expect(clampTableDim(Number.POSITIVE_INFINITY, RICH_TABLE_MIN_COL)).toBeNull();
  });
});

describe('setStyleDecl / getStyleDecl', () => {
  it('adds a declaration to an empty attribute', () => {
    expect(setStyleDecl('', 'width', '120px')).toBe('width: 120px');
    expect(setStyleDecl(null, 'width', '120px')).toBe('width: 120px');
  });
  it('replaces an existing declaration in place, keeping the others', () => {
    expect(setStyleDecl('color: red; width: 80px; text-align: center', 'width', '200px')).toBe(
      'color: red; text-align: center; width: 200px',
    );
  });
  it('removes a declaration when the value is null, dropping to empty', () => {
    expect(setStyleDecl('width: 80px', 'width', null)).toBe('');
    expect(setStyleDecl('color: red; width: 80px', 'width', null)).toBe('color: red');
  });
  it('drops malformed fragments rather than re-emitting them', () => {
    expect(setStyleDecl('color: red; garbage; width: 8px', 'width', '9px')).toBe('color: red; width: 9px');
  });
  it('reads a declaration back, case-insensitively on the property', () => {
    expect(getStyleDecl('WIDTH: 120px', 'width')).toBe('120px');
    expect(getStyleDecl('color: red', 'width')).toBe('');
    expect(getStyleDecl(undefined, 'width')).toBe('');
  });
});

describe('RICH_TABLE_SIZE_RE', () => {
  it('accepts bounded px and percentage literals', () => {
    for (const v of ['120px', '1px', '9999px', '12.5px', '100%', '33.3%', '0%']) {
      expect(RICH_TABLE_SIZE_RE.test(v)).toBe(true);
    }
  });
  it('rejects anything that could reference the outside world', () => {
    for (const v of ['calc(100% - 10px)', 'var(--x)', 'url(x)', '10em', '100vw', 'auto', '101%', '10000px', 'expression(1)']) {
      expect(RICH_TABLE_SIZE_RE.test(v)).toBe(false);
    }
  });
});

describe('sanitizeRichHtml table sizing', () => {
  it('keeps a bounded width/height on table elements', () => {
    const html = '<table style="width: 100%"><tbody><tr style="height: 40px"><td style="width: 120px">a</td></tr></tbody></table>';
    const out = sanitizeRichHtml(html);
    expect(out).toContain('width:100%');
    expect(out).toContain('height:40px');
    expect(out).toContain('width:120px');
  });
  it('keeps table-layout: fixed so dragged column widths hold', () => {
    expect(sanitizeRichHtml('<table style="table-layout: fixed"><tbody><tr><td>a</td></tr></tbody></table>')).toContain(
      'table-layout:fixed',
    );
  });
  it('still allows the shared * styles on a table cell', () => {
    expect(sanitizeRichHtml('<table><tbody><tr><td style="text-align: center">a</td></tr></tbody></table>')).toContain(
      'text-align:center',
    );
  });
  it('does NOT let a non-table element carry width/height', () => {
    expect(sanitizeRichHtml('<div style="width: 500px">x</div>')).not.toContain('width');
    expect(sanitizeRichHtml('<span style="height: 500px">x</span>')).not.toContain('height');
  });
  it('rejects an unbounded or function-valued table width', () => {
    expect(sanitizeRichHtml('<table style="width: calc(100vw - 3px)"><tbody><tr><td>a</td></tr></tbody></table>')).not.toContain('calc');
    expect(sanitizeRichHtml('<table style="width: 99999px"><tbody><tr><td>a</td></tr></tbody></table>')).not.toContain('99999');
  });
  it('keeps every part of the starter table, and is idempotent over it', () => {
    const once = sanitizeRichHtml(RICH_TABLE_STARTER);
    // Only the void-tag spelling is normalized (`<br>` → `<br />`); nothing is dropped.
    expect(once).toBe(RICH_TABLE_STARTER.replace('<br>', '<br />'));
    expect(sanitizeRichHtml(once)).toBe(once);
  });
});
