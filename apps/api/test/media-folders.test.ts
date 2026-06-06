import { describe, it, expect } from 'vitest';
import { ancestorPaths, isUnderFolder, reparentPath, validateFolderMove } from '../src/media/folders.js';

describe('media folder path math', () => {
  it('isUnderFolder: at-or-below, root matches all', () => {
    expect(isUnderFolder('A', 'A')).toBe(true);
    expect(isUnderFolder('A/B', 'A')).toBe(true);
    expect(isUnderFolder('AB', 'A')).toBe(false); // prefix but not a path boundary
    expect(isUnderFolder('A', 'A/B')).toBe(false);
    expect(isUnderFolder('anything', '')).toBe(true); // root contains everything
  });

  it('reparentPath: re-roots a path under a new parent', () => {
    expect(reparentPath('A', 'A', 'C')).toBe('C'); // exact match
    expect(reparentPath('A/B/x', 'A', 'C')).toBe('C/B/x'); // descendant
    expect(reparentPath('A/B', 'A/B', 'A/Renamed')).toBe('A/Renamed'); // rename in place
  });

  it('ancestorPaths: root-first, excludes self', () => {
    expect(ancestorPaths('A')).toEqual([]);
    expect(ancestorPaths('A/B')).toEqual(['A']);
    expect(ancestorPaths('A/B/C')).toEqual(['A', 'A/B']);
  });

  it('validateFolderMove: rejects empties, no-ops, and self-nesting', () => {
    expect(validateFolderMove('', 'X')).toBeTruthy();
    expect(validateFolderMove('X', '')).toBeTruthy();
    expect(validateFolderMove('A', 'A')).toBeTruthy(); // no-op
    expect(validateFolderMove('A', 'A/B')).toBeTruthy(); // into itself
    expect(validateFolderMove('A', 'A/B/C')).toBeTruthy(); // into a descendant
    expect(validateFolderMove('A', 'B')).toBeNull(); // ok
    expect(validateFolderMove('A/B', 'A/C')).toBeNull(); // sibling rename ok
    expect(validateFolderMove('A/B', 'C/B')).toBeNull(); // move to another parent ok
  });
});
