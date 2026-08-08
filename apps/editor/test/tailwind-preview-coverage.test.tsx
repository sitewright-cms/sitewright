import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { tailwindReference } from '@sitewright/tailwind-reference';
import { TailwindPreview } from '../src/views/library/TailwindPreview';

/**
 * A sweep of EVERY previewable class in the real dataset, asserting each one actually produces a
 * preview element.
 *
 * This exists because the repo has already shipped the failure it guards against once: the rich-text
 * toolbars emitted Tailwind classes into a surface whose stylesheet had no rule for them, and 14 of
 * 44 rendered nothing at all — silently, with every unit test passing, because the tests asserted the
 * class was applied rather than that anything was drawn. Preview rendering here has several ways to
 * go quietly dead: a value guard that rejects more than it should, the conditional-declaration skip
 * swallowing a whole topic, or a data-shape change that leaves `decls` empty. Any of those turns rows
 * into blanks with nothing failing.
 *
 * The whole-dataset sweep costs ~6s, which buys a hard number instead of a spot check. It reads the
 * package ROOT on purpose — this is a test, not shipped editor code, so the import-boundary rule in
 * `tailwind-reference-import.test.ts` (which scans `src/` only) does not apply.
 */
describe('preview coverage over the real dataset', () => {
  it('paints a preview for every previewable class', () => {
    let previewable = 0;
    let painted = 0;
    const dead: string[] = [];
    for (const topic of tailwindReference().topics) {
      if (topic.preview === 'none') continue;
      for (const [name, decls] of topic.classes) {
        previewable++;
        const { container } = render(<TailwindPreview kind={topic.preview} decls={decls} name={name} />);
        if (container.querySelector('span[role="img"]')) painted++;
        else if (dead.length < 20) dead.push(`${topic.title}/${name}`);
        container.remove();
      }
    }
    expect(previewable).toBeGreaterThan(10_000);
    expect(dead, `${dead.length} classes render no preview`).toEqual([]);
    expect(painted).toBe(previewable);
  });
});
