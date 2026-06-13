// Reference content for the "SiteWright Components" library modal — the first-party interactive
// components (data-sw-component="…"). Reuses the Template-reference shapes so it renders in the same
// tab-based ReferenceModal. One group per component; start with Lightbox. Each entry is a copy-paste
// example with usage notes. Keep in sync with COMPONENT_CATALOG (packages/schema) + the runtime.
import type { ReferenceGroup } from './reference';

export const SW_COMPONENT_GROUPS: ReferenceGroup[] = [
  {
    id: 'lightbox',
    title: 'Lightbox',
    blurb:
      'A full-screen image gallery: a bottom thumbnail strip, an enlarge-from-thumbnail open animation, a header image-counter + caption, swipe / pinch-zoom / keyboard nav, and a per-image loader. Put data-sw-component="lightbox" on a single <img>, on any container of images, or on the styled grid. The viewer DOM is built for you — there is no overlay to author.',
    entries: [
      {
        id: 'lb-single',
        name: 'Single image (one line)',
        syntax: '<img data-sw-component="lightbox" src="…" data-caption="…">',
        keywords: 'lightbox single image one line photo featured',
        description:
          'A lone image that opens full-screen on click — the whole lightbox in one element. Optional data-full points at a larger file than the thumbnail; omit it and the src is used full-size. data-thumbnails="false" hides the (single-thumb) strip.',
        example:
          '<img\n  data-sw-component="lightbox"\n  data-thumbnails="false"\n  src="{{sw-url thumb}}"\n  data-full="{{sw-url full}}"\n  data-caption="A quiet corner of the studio"\n  alt="Studio"\n  class="mx-auto block w-full max-w-3xl rounded-2xl shadow-sm" />',
      },
      {
        id: 'lb-gallery',
        name: 'Gallery (minimal)',
        syntax: '<div data-sw-component="lightbox"> <img> … </div>',
        keywords: 'lightbox gallery grid images div minimal',
        description:
          'A container whose <img> or <a href><img> children become one gallery. You style the container layout (grid / flex / columns). Bare <img>s are wrapped automatically; the full-size image is the anchor href, or data-full on a bare <img>.',
        example:
          '<div data-sw-component="lightbox" class="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Studio gallery">\n  {{#sw-folder "Studio" kind="image"}}\n  <a href="{{sw-url url}}" data-caption="{{alt}}">\n    <img src="{{sw-url url}}" alt="{{alt}}" loading="lazy" class="aspect-[4/3] w-full rounded-xl object-cover" />\n  </a>\n  {{/sw-folder}}\n</div>',
      },
      {
        id: 'lb-grid',
        name: 'Styled grid (batteries-included)',
        syntax: 'data-sw-block="Lightbox" + data-sw-part="grid" / "item"',
        keywords: 'lightbox grid styled default scaffolding data-sw-part data-sw-block',
        description:
          'The explicit form: adds a built-in uniform square-cover thumbnail grid (override the columns with !grid-cols-* utilities). Each item is an anchor to the full-size image, containing the <img> thumbnail.',
        example:
          '<div data-sw-component="lightbox" data-sw-block="Lightbox" aria-label="Gallery">\n  <div data-sw-part="grid" class="gap-3 !grid-cols-2 md:!grid-cols-4">\n    {{#sw-folder "Studio" kind="image"}}\n    <a data-sw-part="item" href="{{sw-url url}}" data-caption="{{alt}}" class="overflow-hidden rounded-2xl">\n      <img src="{{sw-url url}}" alt="{{alt}}" loading="lazy" />\n    </a>\n    {{/sw-folder}}\n  </div>\n</div>',
      },
      {
        id: 'lb-thumb-full',
        name: 'Thumbnail vs full-size',
        syntax: 'href / data-full = FULL   ·   <img src> = THUMBNAIL',
        keywords: 'lightbox thumbnail full size data-full href separate',
        description:
          'The viewer opens the full-size image — the anchor href, or data-full on a bare <img>. The inline <img src> is the smaller thumbnail shown in the grid + strip; the two may be different files. Every item MUST contain an <img> (the open animation clones it and the strip reuses its source).',
        example:
          '<!-- bare image: small thumb in the tile, large image in the viewer -->\n<img data-sw-component="lightbox" src="{{sw-url thumb}}" data-full="{{sw-url full}}" data-caption="…">\n\n<!-- anchor form: the href is the full image -->\n<a data-sw-part="item" href="{{sw-url full}}" data-caption="…">\n  <img src="{{sw-url thumb}}" alt="…">\n</a>',
      },
      {
        id: 'lb-masonry',
        name: 'Masonry layout',
        syntax: 'class="block columns-2 sm:columns-3"',
        keywords: 'lightbox masonry columns natural aspect uneven staggered no crop',
        description:
          'For a staggered masonry, put the lightbox on a CSS-columns container and let the images keep their natural aspect (no forced height) — no cropping. Give each item break-inside-avoid + a bottom margin. Add width/height on each <img> so the browser reserves the right space (no layout shift). Mixed aspect ratios make the columns genuinely stagger.',
        example:
          '<div data-sw-component="lightbox" class="block columns-2 gap-4 sm:columns-3" aria-label="Gallery">\n  {{#sw-folder "Projects" kind="image"}}\n  <a href="{{sw-url url}}" data-caption="{{alt}}" class="mb-4 block break-inside-avoid overflow-hidden rounded-xl">\n    <img src="{{sw-url url}}" alt="{{alt}}" width="{{width}}" height="{{height}}" loading="lazy" class="block w-full" />\n  </a>\n  {{/sw-folder}}\n</div>',
        note: 'A uniform square grid crops; match the tile aspect to the image (e.g. aspect-[4/3]) or use natural aspect (masonry) to avoid cropping AND get a seamless open animation.',
      },
      {
        id: 'lb-gallery-group',
        name: 'Group images across sections',
        syntax: 'data-gallery="name"',
        keywords: 'lightbox gallery group data-gallery merge sections combine one',
        description:
          'Give lightboxes a shared data-gallery name to MERGE them into one gallery — even when they live in different sections of the page and use different forms (single <img> / container / styled grid). Clicking any image opens the combined gallery at that image. Without data-gallery, each lightbox is its own gallery.',
        example:
          '<section> … <img data-sw-component="lightbox" data-gallery="tour" src="{{sw-url a}}" data-caption="Exterior"> </section>\n\n<section> … <img data-sw-component="lightbox" data-gallery="tour" src="{{sw-url b}}" data-caption="Interior"> </section>\n\n<!-- click either image → one combined 2-photo gallery -->',
      },
      {
        id: 'lb-options',
        name: 'Options (data-* on the root)',
        syntax: 'data-thumbnails · data-arrows · data-animation · data-fit · data-tilt · data-history',
        keywords: 'lightbox options switches attributes thumbnails arrows animation fit tilt history',
        description:
          'Toggle features by putting these on the lightbox root (the <img> or the container). All optional; sensible defaults.',
        args: [
          { name: 'data-thumbnails', desc: '"false" hides the bottom thumbnail strip (shown by default).' },
          { name: 'data-arrows', desc: '"false" hides the prev / next arrows (shown by default).' },
          { name: 'data-animation', desc: '"false" disables the enlarge-from-thumbnail open animation (auto-off under reduced motion).' },
          { name: 'data-fit', desc: '"fit" (default — the whole image) or "fill" (cover the screen on touch).' },
          { name: 'data-tilt', desc: '"true" pans the zoomed image with the device tilt on mobile (off by default).' },
          { name: 'data-history', desc: '"true" reflects the open image in the URL hash (off by default).' },
        ],
        example:
          '<div data-sw-component="lightbox" data-thumbnails="false" data-arrows="false" data-fit="fill">\n  <img src="{{sw-url a}}" data-caption="…">\n  <img src="{{sw-url b}}" data-caption="…">\n</div>',
      },
      {
        id: 'lb-notes',
        name: 'Captions, accessibility & no-JS',
        syntax: 'data-caption="…"   ·   progressive enhancement',
        keywords: 'lightbox caption accessibility a11y no-js progressive enhancement focus keyboard',
        description:
          'data-caption sets the header caption (author-trusted text — never bind visitor-submitted content). Without JavaScript the anchor forms simply open the full image (a bare <img> just shows in place). With JS the viewer is a role="dialog" with a live-region caption, Escape + arrow-key navigation, and focus returns to the clicked image on close.',
        noCopy: true,
      },
    ],
  },
];
