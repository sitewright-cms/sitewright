import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { tailwindReference } from '@sitewright/tailwind-reference';
import { TailwindPreview, paintableDeclarations } from '../src/views/library/TailwindPreview';

/**
 * Does every previewable class in the real dataset actually draw something?
 *
 * This exists because the repo has already shipped the failure it guards against: the rich-text
 * toolbars emitted Tailwind classes into a surface whose stylesheet had no rule for them, and 14 of
 * 44 rendered nothing at all — silently, with every unit test green, because the tests asserted the
 * class was applied rather than that anything was drawn. Preview rendering has several ways to go
 * quietly dead: a value guard that rejects more than it should, the conditional-declaration skip
 * swallowing a whole topic, or a data-shape change leaving `decls` empty.
 *
 * Split in two on purpose. Rendering all 15k classes through React costs ~6s alone but blows the
 * suite's 20s ceiling under parallel load (many vitest workers oversubscribing CPU), so the
 * EXHAUSTIVE pass runs the pure predicate that decides whether anything paints, and a SAMPLED pass
 * drives the real component once per topic to prove the predicate and the render agree.
 *
 * Reads the package ROOT deliberately — this is a test, not shipped editor code, so the import
 * boundary in `tailwind-reference-import.test.ts` (which scans `src/` only) does not apply.
 */
describe('preview coverage over the real dataset', () => {
  it('yields at least one paintable declaration for every previewable class', () => {
    let previewable = 0;
    const dead: string[] = [];
    for (const topic of tailwindReference().topics) {
      if (topic.preview === 'none') continue;
      for (const [name, decls] of topic.classes) {
        previewable++;
        if (paintableDeclarations(decls).length === 0 && dead.length < 20) dead.push(`${topic.title}/${name}`);
      }
    }
    expect(previewable).toBeGreaterThan(10_000);
    expect(dead, `${dead.length} classes would paint nothing`).toEqual([]);
  });

  it('really renders a preview element for a class from every previewable topic', () => {
    const topics = tailwindReference().topics.filter((t) => t.preview !== 'none');
    const missing: string[] = [];
    for (const topic of topics) {
      const first = topic.classes[0];
      if (!first) continue;
      const { container } = render(<TailwindPreview kind={topic.preview} decls={first[1]} name={first[0]} />);
      if (!container.querySelector('span[role="img"]')) missing.push(`${topic.title}/${first[0]}`);
      container.remove();
    }
    expect(topics.length).toBeGreaterThan(100);
    expect(missing, `${missing.length} topics render no preview`).toEqual([]);
  });
});
