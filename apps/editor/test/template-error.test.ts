import { describe, it, expect } from 'vitest';
import { parseTemplateErrorPosition } from '../src/lib/template-error';

describe('parseTemplateErrorPosition', () => {
  it('extracts the 1-based line/column the validator appends to its message', () => {
    // The validator appends the position LAST (no trailing punctuation after it).
    expect(
      parseTemplateErrorPosition('unsafe template: a bare value in the URL attribute "href" (use {{sw-url …}}). (line 3, column 12)'),
    ).toEqual({ line: 3, column: 12 });
  });

  it('reads the position even behind a wrapper prefix (publish wraps the message)', () => {
    expect(parseTemplateErrorPosition('page "home" template error: unsafe template: … (line 7, column 2)')).toEqual({
      line: 7,
      column: 2,
    });
  });

  it('only matches the position at the END (not a (line …)-looking substring mid-message)', () => {
    // A snippet name etc. that merely mentions "(line 9, column 9)" mid-text must not be mistaken
    // for the appended position; with no trailing position, there's nothing to mark.
    expect(parseTemplateErrorPosition('weird (line 9, column 9) snippet name with no real position')).toBeNull();
  });

  it('returns null when there is no position, or no message', () => {
    expect(parseTemplateErrorPosition('failed to save')).toBeNull();
    expect(parseTemplateErrorPosition('')).toBeNull();
    expect(parseTemplateErrorPosition(null)).toBeNull();
    expect(parseTemplateErrorPosition(undefined)).toBeNull();
  });
});
