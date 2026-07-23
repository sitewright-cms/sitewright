import { describe, it, expect } from 'vitest';
import {
  RICH_TOOLBAR,
  RICH_COLORS,
  RICH_HIGHLIGHTS,
  RICH_SIZES,
  RICH_ALIGNS,
  RICH_INDENT_STEPS,
  RICH_COLOR_CLASSES,
  RICH_SIZE_CLASSES,
  RICH_INDENT_CLASSES,
  RICH_CONTENT_SAFELIST,
  isRichContentClass,
  setGroupClass,
  stepIndentClass,
  ciRichPalette,
  ciRichClasses,
  type RichCmd,
} from '../src/rich-toolbar.js';

describe('setGroupClass', () => {
  it('adds a class when none of the group is present', () => {
    expect(setGroupClass('font-bold', RICH_COLOR_CLASSES, 'text-red-600')).toBe('font-bold text-red-600');
  });
  it('replaces an existing member of the same group', () => {
    expect(setGroupClass('font-bold text-blue-600', RICH_COLOR_CLASSES, 'text-red-600')).toBe('font-bold text-red-600');
  });
  it('removes the group member when add is empty/undefined', () => {
    expect(setGroupClass('font-bold text-blue-600', RICH_COLOR_CLASSES)).toBe('font-bold');
  });
  it('leaves classes from OTHER groups untouched', () => {
    // text-lg is a SIZE class, not a colour class — a colour toggle must not strip it.
    expect(setGroupClass('text-lg text-blue-600', RICH_COLOR_CLASSES, 'text-red-600')).toBe('text-lg text-red-600');
  });
  it('dedupes and tolerates whitespace/empty input', () => {
    expect(setGroupClass('  a   a  b ', RICH_SIZE_CLASSES, 'text-lg')).toBe('a b text-lg');
    expect(setGroupClass(null, RICH_SIZE_CLASSES, 'text-sm')).toBe('text-sm');
    expect(setGroupClass('', RICH_SIZE_CLASSES)).toBe('');
  });
});

describe('stepIndentClass', () => {
  it('steps up through the indent scale', () => {
    expect(stepIndentClass('', 1)).toBe('pl-4');
    expect(stepIndentClass('pl-4', 1)).toBe('pl-8');
    expect(stepIndentClass('pl-8', 1)).toBe('pl-12');
  });
  it('steps down and clamps at zero (removes the class)', () => {
    expect(stepIndentClass('pl-8', -1)).toBe('pl-4');
    expect(stepIndentClass('pl-4', -1)).toBe('');
    expect(stepIndentClass('', -1)).toBe('');
  });
  it('clamps at the top of the scale', () => {
    const top = RICH_INDENT_STEPS[RICH_INDENT_STEPS.length - 1];
    expect(stepIndentClass(top, 1)).toBe(top);
  });
  it('preserves unrelated classes', () => {
    expect(stepIndentClass('font-bold pl-4', 1)).toBe('font-bold pl-8');
    expect(stepIndentClass('font-bold pl-4', -1)).toBe('font-bold');
  });
});

describe('RICH_CONTENT_SAFELIST', () => {
  it('covers every palette class and is free of empties/dupes', () => {
    expect(RICH_CONTENT_SAFELIST).not.toContain('');
    expect(new Set(RICH_CONTENT_SAFELIST).size).toBe(RICH_CONTENT_SAFELIST.length);
    for (const s of [...RICH_COLORS, ...RICH_HIGHLIGHTS, ...RICH_SIZES, ...RICH_ALIGNS]) {
      if (s.cls) expect(RICH_CONTENT_SAFELIST).toContain(s.cls);
    }
    for (const c of RICH_INDENT_CLASSES) expect(RICH_CONTENT_SAFELIST).toContain(c);
  });
  it('isRichContentClass matches palette classes only', () => {
    expect(isRichContentClass('text-red-600')).toBe(true);
    expect(isRichContentClass('pl-8')).toBe(true);
    expect(isRichContentClass('text-primary')).toBe(false); // CI class — per-project, not in the static list
    expect(isRichContentClass('font-bold')).toBe(false);
  });
});

describe('RICH_TOOLBAR', () => {
  it('has unique command ids and valid kinds', () => {
    const cmds = RICH_TOOLBAR.filter((c): c is RichCmd => c !== null);
    const ids = cmds.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const kinds = new Set(['exec', 'color', 'highlight', 'size', 'font', 'align', 'indent', 'link', 'table', 'source']);
    for (const c of cmds) expect(kinds.has(c.kind)).toBe(true);
  });
  it('every exec command carries a cmd; indent carries a direction', () => {
    for (const c of RICH_TOOLBAR) {
      if (c === null) continue;
      if (c.kind === 'exec') expect(typeof c.cmd).toBe('string');
      if (c.kind === 'indent') expect(c.cmd === '1' || c.cmd === '-1').toBe(true);
    }
  });
  it('includes the headline additions the feature promised', () => {
    const ids = RICH_TOOLBAR.filter(Boolean).map((c) => (c as RichCmd).id);
    for (const id of ['color', 'highlight', 'font', 'size', 'align', 'indent', 'outdent', 'link', 'table']) {
      expect(ids).toContain(id);
    }
  });
});

describe('ciRichPalette', () => {
  const identity = {
    colors: {
      primary: '#0a7',
      accent: '#f50',
      brandBlue: '#0055ff',
      'base-100': '#fff', // surface → excluded from the text palette
      'base-content': '#111', // content role → excluded
    },
    typography: {
      named: { display: {} as unknown },
      fontFamilies: { mono: 'monospace' },
    },
  };

  it('maps brand colours to text-<token>, excluding surfaces + *-content', () => {
    const { colors } = ciRichPalette(identity);
    const classes = colors.map((c) => c.cls);
    expect(classes).toContain('text-primary');
    expect(classes).toContain('text-accent');
    expect(classes).toContain('text-brandBlue');
    expect(classes).not.toContain('text-base-100');
    expect(classes).not.toContain('text-base-content');
  });
  it('orders the well-known accent roles first', () => {
    const order = ciRichPalette(identity).colors.map((c) => c.cls);
    expect(order.indexOf('text-primary')).toBeLessThan(order.indexOf('text-accent'));
    expect(order.indexOf('text-accent')).toBeLessThan(order.indexOf('text-brandBlue'));
  });
  it('carries the literal colour value for swatch preview', () => {
    const primary = ciRichPalette(identity).colors.find((c) => c.cls === 'text-primary');
    expect(primary?.value).toBe('#0a7');
  });
  it('always offers heading + body fonts, then named + fontFamilies slots', () => {
    const fonts = ciRichPalette(identity).fonts.map((f) => f.cls);
    expect(fonts.slice(0, 2)).toEqual(['font-heading', 'font-body']);
    expect(fonts).toContain('font-display');
    expect(fonts).toContain('font-mono');
  });
  it('degrades gracefully with no identity', () => {
    expect(ciRichPalette(null)).toEqual({ colors: [], fonts: [] });
    expect(ciRichPalette(undefined)).toEqual({ colors: [], fonts: [] });
    expect(ciRichPalette({})).toEqual({ colors: [], fonts: ['font-heading', 'font-body'].map((cls) => ({ label: expect.any(String), cls })) });
  });
  it('ciRichClasses is the flat class list (colours + fonts)', () => {
    const classes = ciRichClasses(identity);
    expect(classes).toContain('text-primary');
    expect(classes).toContain('font-heading');
    expect(classes).toContain('font-mono');
  });
});
