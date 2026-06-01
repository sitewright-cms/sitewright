import type { Pattern } from '@sitewright/schema';

// A built-in, version-controlled GLOBAL snippet library — curated, framework-free
// block compositions the author forks into a page as a starting point (the
// contentBase "snippet library", made global). Composed only from text/layout
// blocks (Section/Grid/Card/Hero/Heading/RichText/Button) so they always render
// cleanly with no external image/icon dependency. Inserted via the same
// fork-on-insert path as project patterns (ids are regenerated on insert), so the
// fixed ids here only need to be unique within each pattern.
//
// These are the platform's own original compositions (no third-party markup), so
// there is no licensing constraint.

const heading = (id: string, text: string, level: number) => ({ id, type: 'Heading', props: { text, level } });
const richText = (id: string, text: string) => ({ id, type: 'RichText', props: { text } });
const button = (id: string, text: string, href = '#') => ({ id, type: 'Button', props: { text, href } });

export const STARTER_PATTERNS: Pattern[] = [
  {
    id: 'starter-hero',
    name: 'Hero',
    root: {
      id: 'hero-root',
      type: 'Hero',
      props: {
        title: 'Build something people love',
        subtitle: 'A clear, benefit-led headline and a single call to action.',
        ctaText: 'Get started',
        ctaHref: '#',
      },
    },
  },
  {
    id: 'starter-features',
    name: 'Feature trio',
    root: {
      id: 'feat-root',
      type: 'Section',
      props: { tone: 'surface' },
      children: [
        heading('feat-h', 'Why choose us', 2),
        {
          id: 'feat-grid',
          type: 'Grid',
          props: { columns: 3 },
          children: [
            { id: 'feat-c1', type: 'Card', children: [heading('feat-c1h', 'Fast', 3), richText('feat-c1t', 'Optimised, static output with high Lighthouse scores.')] },
            { id: 'feat-c2', type: 'Card', children: [heading('feat-c2h', 'Flexible', 3), richText('feat-c2t', 'Reusable partials, templates, and brand tokens.')] },
            { id: 'feat-c3', type: 'Card', children: [heading('feat-c3h', 'Portable', 3), richText('feat-c3t', 'Export a self-contained site to your own webspace.')] },
          ],
        },
      ],
    },
  },
  {
    id: 'starter-cta',
    name: 'Call to action',
    root: {
      id: 'cta-root',
      type: 'Section',
      props: { tone: 'primary' },
      children: [heading('cta-h', 'Ready to get started?', 2), richText('cta-t', 'Launch your site in minutes.'), button('cta-b', 'Sign up')],
    },
  },
  {
    id: 'starter-split',
    name: 'Two-column split',
    root: {
      id: 'split-root',
      type: 'Section',
      props: { tone: 'surface' },
      children: [
        {
          id: 'split-grid',
          type: 'Grid',
          props: { columns: 2 },
          children: [
            { id: 'split-c1', type: 'Card', children: [heading('split-c1h', 'A focused headline', 2), richText('split-c1t', 'Supporting copy that explains the value in a sentence or two.'), button('split-c1b', 'Learn more')] },
            { id: 'split-c2', type: 'Card', children: [heading('split-c2h', 'A second column', 3), richText('split-c2t', 'Pair the copy with a feature list, image, or testimonial.')] },
          ],
        },
      ],
    },
  },
  {
    id: 'starter-testimonial',
    name: 'Testimonial',
    root: {
      id: 'quote-root',
      type: 'Section',
      props: { tone: 'muted' },
      children: [richText('quote-q', '“This is the fastest way we have shipped client sites — the output is clean and the editing is effortless.”'), richText('quote-a', '— A happy customer')],
    },
  },
];
