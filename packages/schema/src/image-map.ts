import { z } from 'zod';
import { IdSchema } from './primitives.js';

/**
 * An INTERACTIVE IMAGE MAP: a base image (or SVG) overlaid with hotspots that highlight, open
 * tooltips, follow links and switch "artboards" (floor plans, map layers).
 *
 * Stored as its own content kind and embedded with `{{sw-imagemap "<id>"}}` or `data-sw-imagemap`;
 * the render path serialises the config into the component's
 * `<script type="application/json" data-sw-part="config">` block, which the runtime reads. See
 * `@sitewright/blocks` vendor-src/image-map for the runtime and COMPONENT_CATALOG for the
 * authoring contract.
 *
 * HOW STRICT THIS IS, AND WHY. Two kinds of field are treated very differently:
 *
 *  - PRESENTATION (colours, opacities, offsets, font sizes, the box model) is `.passthrough()`d
 *    on bounded objects. The runtime deep-extends every style against its own defaults, so an
 *    unknown key is inert, and mirroring ~150 upstream style keys here would be a second source
 *    of truth that silently drifts from the runtime on the first upgrade.
 *  - ANYTHING WITH TEETH — links, media URLs, geometry, ids, tag names, and every string that
 *    reaches the DOM — is named and constrained explicitly. That is the half worth spelling out,
 *    and the half a Studio or an agent can get wrong.
 *
 * Note what is ABSENT: upstream's `custom_code` (custom_js / custom_css) and a hotspot's
 * `run-script` action. The runtime cannot execute either; accepting them here would only let a
 * config carry dead weight that looks like it does something.
 */

/** Percent-of-artboard geometry. Negative values are legal (an object may hang off an edge). */
const Pct = z.number().finite().min(-1000).max(1000);

/** A bounded, open-ended presentation object — see the note above. */
const StyleBag = z.object({}).passthrough();

/**
 * A link a hotspot or tooltip may point at. Validated for SHAPE here; the runtime independently
 * refuses to navigate to anything outside http/https/mailto/tel (safeLinkUrl), so this is the
 * outer of two gates rather than the only one.
 */
const LinkSchema = z
  .string()
  .max(2048)
  .refine((v) => !/^\s*(javascript|data|vbscript):/i.test(v), {
    message: 'link scheme is not allowed (javascript:, data: and vbscript: cannot be linked to)',
  });

/** The tags a Heading block may render as — mirrors HEADING_TAGS in the runtime. */
export const IMAGE_MAP_HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div'] as const;

/** Per-block presentation shared by every tooltip content block. */
const BlockChromeSchema = z
  .object({
    // Rendered into id / class / style attributes. Escaped by the runtime; still bounded here.
    other: z
      .object({
        id: z.string().max(200).default(''),
        classes: z.string().max(500).default(''),
        css: z.string().max(2000).default(''),
      })
      .partial()
      .optional(),
    style: StyleBag.optional(),
    boxModel: StyleBag.optional(),
  })
  .partial();

/**
 * A tooltip content block.
 *
 * `text` and `embedCode` are RICH: they carry authored markup on purpose (bold, links, an embed
 * iframe), so they are sanitised on write rather than escaped — see sanitizeImageMapConfig.
 *
 * Every field is `.optional()` rather than `.default()`: these blocks hang off the recursive
 * ImageMapObjectSchema, whose explicit interface annotation requires input and output types to
 * match, and a default makes them diverge. The runtime supplies the defaults (tooltipContentDefaults).
 */
export const ImageMapTooltipBlockSchema = z.discriminatedUnion('type', [
  BlockChromeSchema.extend({
    type: z.literal('Heading'),
    text: z.string().max(2000).optional(),
    heading: z.enum(IMAGE_MAP_HEADING_TAGS).optional(),
  }),
  BlockChromeSchema.extend({
    type: z.literal('Paragraph'),
    text: z.string().max(20_000).optional(),
  }),
  BlockChromeSchema.extend({
    type: z.literal('Button'),
    text: z.string().max(500).optional(),
    url: LinkSchema.optional(),
    newTab: z.boolean().optional(),
  }),
  BlockChromeSchema.extend({
    type: z.literal('Image'),
    url: LinkSchema.optional(),
    linkUrl: LinkSchema.optional(),
  }),
  BlockChromeSchema.extend({
    type: z.literal('Video'),
    src: z
      .object({ mp4: LinkSchema.optional(), webm: LinkSchema.optional(), ogv: LinkSchema.optional() })
      .partial()
      .optional(),
    linkUrl: LinkSchema.optional(),
    controls: z.boolean().optional(),
    autoplay: z.boolean().optional(),
    loop: z.boolean().optional(),
    muted: z.boolean().optional(),
  }),
  BlockChromeSchema.extend({
    type: z.literal('YouTube'),
    embedCode: z.string().max(4000).optional(),
    allowFullscreen: z.boolean().optional(),
  }),
]);
export type ImageMapTooltipBlock = z.infer<typeof ImageMapTooltipBlockSchema>;

/** The hotspot shapes the runtime can draw. */
export const IMAGE_MAP_OBJECT_TYPES = ['spot', 'rect', 'oval', 'poly', 'text', 'svg', 'svg-single', 'group'] as const;

/** What a click on a hotspot does. Upstream's `run-script` is deliberately not an option. */
const ObjectActionsSchema = z
  .object({
    click: z.enum(['no-action', 'follow-link', 'change-artboard']),
    link: LinkSchema,
    open_link_in_new_window: z.boolean(),
    // The artboard id `change-artboard` switches to.
    artboard: z.string().max(200),
  })
  .partial();

/**
 * A hotspot. Recursive: a `group` nests children.
 *
 * Zod cannot infer a recursive type, so the children are typed through an explicit interface —
 * the standard z.lazy pattern.
 */
export interface ImageMapObject {
  id: string;
  title?: string;
  type?: (typeof IMAGE_MAP_OBJECT_TYPES)[number];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  static?: boolean;
  single_object?: boolean;
  parent_id?: string;
  points?: Array<{ x: number; y: number }>;
  svg?: { html?: string; tagName?: string; viewBox?: string; properties?: unknown[] };
  default_style?: Record<string, unknown>;
  mouseover_style?: Record<string, unknown>;
  tooltip?: Record<string, unknown>;
  tooltip_style?: Record<string, unknown>;
  tooltip_content?: ImageMapTooltipBlock[];
  text?: Record<string, unknown>;
  actions?: z.infer<typeof ObjectActionsSchema>;
  children?: ImageMapObject[];
}

export const ImageMapObjectSchema: z.ZodType<ImageMapObject> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(200),
    // The handle every external trigger and the object list address the hotspot by.
    // .optional(), not .default(): a recursive z.lazy schema needs its input and output types to
    // match the interface exactly, and a default makes them diverge. The runtime deep-extends
    // every object against its own defaults regardless.
    title: z.string().max(500).optional(),
    // OPTIONAL: a child inside a group routinely omits it and inherits objectDefaults' 'spot'.
    type: z.enum(IMAGE_MAP_OBJECT_TYPES).optional(),
    x: Pct.optional(),
    y: Pct.optional(),
    width: Pct.optional(),
    height: Pct.optional(),
    static: z.boolean().optional(),
    single_object: z.boolean().optional(),
    parent_id: z.string().max(200).optional(),
    // Polygon vertices in percent — `{x, y}` objects, which is the shape the runtime's poly
    // renderer reads. Capped so one hotspot cannot carry a runaway path.
    points: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).max(2000).optional(),
    // An imported SVG region. `html` is markup by design — sanitised on write.
    svg: z
      .object({
        html: z.string().max(512 * 1024).optional(),
        tagName: z.string().max(50).optional(),
        viewBox: z.string().max(200).optional(),
        properties: z.array(z.unknown()).max(200).optional(),
      })
      .partial()
      .optional(),
    default_style: StyleBag.optional(),
    mouseover_style: StyleBag.optional(),
    tooltip: StyleBag.optional(),
    tooltip_style: StyleBag.optional(),
    tooltip_content: z.array(ImageMapTooltipBlockSchema).max(50).optional(),
    text: StyleBag.optional(),
    actions: ObjectActionsSchema.optional(),
    children: z.array(ImageMapObjectSchema).max(2000).optional(),
  })
);

/** One "floor" / layer: its own background and its own hotspots. */
export const ImageMapArtboardSchema = z.object({
  // REQUIRED and unique within the map. A hotspot's `change-artboard` action targets an artboard
  // by id, and the runtime assigns no ids of its own — every artboard in an id-less config takes
  // the same `default-id` from artboardDefaults, so the floor switcher silently does nothing.
  // (Vendor exports routinely omit it on the FIRST artboard only; the template materialiser fills
  // those in before storing, so a stored map always switches correctly.)
  id: z.string().min(1).max(200),
  title: z.string().max(500).default(''),
  background_type: z.enum(['none', 'color', 'image']).default('color'),
  background_color: z.string().max(100).optional(),
  image_url: LinkSchema.default(''),
  width: z.number().finite().positive().max(100_000).optional(),
  height: z.number().finite().positive().max(100_000).optional(),
  use_image_size: z.boolean().optional(),
  children: z.array(ImageMapObjectSchema).max(5000).default([]),
});
export type ImageMapArtboard = z.infer<typeof ImageMapArtboardSchema>;

/**
 * A stored image map.
 *
 * `id` is the entity id the page references. `general.name` is what a page's `data-sw-imap-map`
 * attribute resolves against at runtime, so it has to be stable once pages point at it.
 */
export const ImageMapSchema = z
  .object({
    id: IdSchema,
    general: z
      .object({
        name: z.string().min(1).max(200),
        width: z.number().finite().positive().max(100_000).optional(),
        height: z.number().finite().positive().max(100_000).optional(),
        ui_theme: z.enum(['light', 'dark']).optional(),
      })
      .passthrough(),
    image: StyleBag.optional(),
    tooltips: StyleBag.optional(),
    zooming: StyleBag.optional(),
    fullscreen: StyleBag.optional(),
    object_list: StyleBag.optional(),
    objectConfig: StyleBag.optional(),
    defaults: StyleBag.optional(),
    artboards: z.array(ImageMapArtboardSchema).min(1).max(200),
    // Written by the runtime's importer; present on anything the Studio has saved.
    version: z.string().max(20).optional(),
  })
  .superRefine((map, ctx) => {
    // Duplicate artboard ids are accepted by the runtime and then behave as ONE artboard: a
    // switch to the second resolves to an id equal to the current one and no-ops. Catch it here,
    // where the message can say so, rather than leaving an author with a dead floor switcher.
    const seen = new Set<string>();
    map.artboards.forEach((artboard, i) => {
      if (seen.has(artboard.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['artboards', i, 'id'],
          message: `duplicate artboard id "${artboard.id}" — ids must be unique within a map`,
        });
      }
      seen.add(artboard.id);
    });
  });

export type ImageMap = z.infer<typeof ImageMapSchema>;
