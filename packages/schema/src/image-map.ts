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

/**
 * SVG elements an `svg` hotspot may be BUILT from, and the attributes it may carry.
 *
 * ★ The runtime constructs these itself rather than parsing markup:
 *
 *     createElementNS(SVG_NS, options.svg.tagName)
 *     for (const p of options.svg.properties) element.setAttribute(p.name, p.value)
 *
 * so the config chooses the element NAME and every attribute NAME. Unrestricted that is a code
 * path, not data: `tagName: "script"` builds an executable SVG script element, and
 * `{name: "onload", value: "…"}` sets an inline handler. It is the same hole as the tooltip
 * Button's `onclick`, but structured — no markup-string sanitizer would ever see it.
 *
 * The allowlists below are the fix, applied at BOTH ends: sanitizeImageMapConfig strips anything
 * outside them, and the runtime re-checks at the point of use (see UI/objects/svg.js, which pins
 * itself to these lists in the test suite). Every bundled template uses only `path`/`polyline`
 * with `d`/`id`/`fill-rule`/`points`, so nothing real is lost.
 */
/**
 * The marker artwork a PIN is drawn with — by the runtime on a published page, and by the Studio
 * on its canvas, which is the point: the two used to disagree (a pointer on the page, a plain dot
 * in the editor), so an author positioned one shape and published another.
 *
 * The tip is at the BOTTOM CENTRE of the 24×24 box, because a pin is anchored by its tip: the
 * runtime offsets it a full icon-height upward so the point lands on the hotspot's coordinate.
 *
 * ★ A COPY. The bundled runtime cannot import TypeScript, so the original lives in
 * `packages/blocks/vendor-src/image-map/src/scripts/icons.js`; `image-map.test.ts` reads that file
 * and fails if the two drift. Change one, change the other.
 */
export const IMAGE_MAP_PIN_ICON_PATH =
  'M12 1a8 8 0 0 0-8 8c0 5.4 6.9 13.1 7.2 13.4a1 1 0 0 0 1.6 0C13.1 22.1 20 14.4 20 9a8 8 0 0 0-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z';

export const SVG_SHAPE_TAGS = [
  'path', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'line',
  'g', 'defs', 'use', 'symbol', 'clipPath', 'mask',
  'linearGradient', 'radialGradient', 'stop', 'pattern',
  'text', 'tspan', 'title', 'desc',
] as const;

/**
 * Attribute names an `svg` hotspot may set. Presentation + geometry only: no `on*` handler can
 * appear because none is listed, and no `href` because a link inside a region has no purpose here
 * and is the one remaining way an SVG attribute can carry a `javascript:` URL.
 */
export const SVG_SHAPE_ATTRS = [
  'd', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height',
  'transform', 'viewBox', 'preserveAspectRatio',
  'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'clip-rule', 'clip-path',
  'id', 'class', 'style', 'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'patternUnits', 'spreadMethod',
] as const;

/** Is this a tag an `svg` hotspot may be built from? */
export function isSvgShapeTag(tag: unknown): boolean {
  return typeof tag === 'string' && (SVG_SHAPE_TAGS as readonly string[]).includes(tag);
}

/** Is this an attribute an `svg` hotspot may set? */
export function isSvgShapeAttr(name: unknown): boolean {
  return typeof name === 'string' && (SVG_SHAPE_ATTRS as readonly string[]).includes(name);
}

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
  svg?: {
    html?: string;
    tagName?: (typeof SVG_SHAPE_TAGS)[number];
    viewBox?: string;
    properties?: Array<{ name: string; value: string }>;
  };
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
        // The ELEMENT the runtime builds — allowlisted; see SVG_SHAPE_TAGS for why this is not
        // merely a style choice.
        tagName: z.enum(SVG_SHAPE_TAGS).optional(),
        viewBox: z.string().max(200).optional(),
        // The attributes it sets. `name` is allowlisted for the same reason.
        properties: z
          .array(z.object({ name: z.string().max(100), value: z.string().max(64 * 1024) }).passthrough())
          .max(200)
          .optional(),
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
