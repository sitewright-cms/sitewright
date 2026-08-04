/**
 * The bundled IMAGE MAP starter templates — metadata only.
 *
 * Ported from the Image Map Pro demo set (the same examples its site shows), vendored under the
 * extended licence. Two of the five carry a background photograph; the other three are pure SVG
 * and fully self-contained.
 *
 * METADATA ONLY, on purpose. The five configs together are ~940 KB — inlining them here would put
 * that in every bundle of `@sitewright/schema`, which the editor ships to the browser. A picker
 * only needs the name, the shape and a count; the config itself is fetched on demand from
 * `GET /authoring/imagemaps/templates/<id>` and materialised into a project by
 * `POST /projects/:projectId/imagemaps/from-template` (which self-hosts `images` into the
 * project's media library, so a published site never points back at the platform).
 */
export interface ImageMapTemplate {
  /** Stable id — the filename under apps/api/assets/imagemaps/templates/. */
  id: string;
  /** Display name; also the map's `general.name` until the author renames it. */
  name: string;
  /** One line on what the template demonstrates, for the picker. */
  summary: string;
  /** How many artboards (floors / layers) it has. */
  artboards: number;
  /** Total hotspots across every artboard, nested groups included. */
  hotspots: number;
  /** Platform-hosted images the config references (`/authoring/imagemaps/<file>`); empty for the
   *  pure-SVG templates. Imported into the project's media library on materialisation. */
  images: readonly string[];
}

export const IMAGE_MAP_TEMPLATES: readonly ImageMapTemplate[] = [
  {
    id: 'real-estate',
    name: 'Real estate',
    summary:
      'A residential building whose floors are polygon hotspots; clicking one switches to that floor’s own plan. Ten artboards, tooltips with unit details.',
    artboards: 10,
    hotspots: 27,
    images: ['/authoring/imagemaps/v6-real-estate-4.jpg', '/authoring/imagemaps/v6-real-estate-6.jpg'],
  },
  {
    id: 'us-national-parks',
    name: 'US national parks',
    summary:
      'A vector map of the United States: every state is an SVG region and each park a pin, grouped by state in a searchable object list.',
    artboards: 1,
    hotspots: 130,
    images: [],
  },
  {
    id: 'engineering',
    name: 'Engineering diagram',
    summary:
      'A jet-engine blueprint on a dark canvas: a glowing pin on each component, a side list to jump between them, and zoom with a navigator thumbnail. The shape most product and technical diagrams need.',
    artboards: 1,
    hotspots: 12,
    images: ['/authoring/imagemaps/v6-engineering-2.jpg'],
  },
  {
    id: 'education',
    name: 'Education',
    summary:
      'A dental cross-section built entirely from SVG regions (no background photo) — 401 of them. Shows how a detailed vector illustration becomes an interactive diagram, the usual shape for anatomy and science content.',
    artboards: 1,
    hotspots: 401,
    images: [],
  },
  {
    id: 'business',
    name: 'Business',
    summary:
      'A 3D pie and bar chart as SVG regions, each slice and column its own hotspot — a starting point for infographics, process diagrams and org charts.',
    artboards: 1,
    hotspots: 10,
    images: [],
  },
];

/** Is `id` a bundled template? Allowlist — callers use it before touching the filesystem. */
export function isImageMapTemplateId(id: string): boolean {
  return IMAGE_MAP_TEMPLATES.some((t) => t.id === id);
}

/** Every platform-hosted image the templates reference, as bare filenames. */
export const IMAGE_MAP_TEMPLATE_IMAGES: readonly string[] = [
  ...new Set(IMAGE_MAP_TEMPLATES.flatMap((t) => t.images.map((u) => u.split('/').pop() as string))),
].sort();
