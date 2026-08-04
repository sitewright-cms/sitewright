// Pure model helpers for the Image Map Studio — everything that reasons about a map's config
// without touching React or the DOM, so it can be unit-tested on its own.
//
// GEOMETRY IS PERCENT. Every x/y/width/height on a hotspot is a percentage of the artboard, which is
// what makes a map resolution-independent: the runtime scales the artboard to its container and the
// hotspots follow. The Studio therefore converts to pixels only at the moment it draws or drags.
import type { ImageMap, ImageMapArtboard, ImageMapObject, ImageMapTooltipBlock } from '@sitewright/schema';

/** The hotspot shapes the Studio can create. (`svg`/`svg-single`/`group` come from imports.) */
export const DRAWABLE_TYPES = ['rect', 'oval', 'poly', 'spot', 'text'] as const;
export type DrawableType = (typeof DRAWABLE_TYPES)[number];

export const TYPE_LABELS: Record<string, string> = {
  rect: 'Rectangle',
  oval: 'Oval',
  poly: 'Polygon',
  spot: 'Pin',
  text: 'Text',
  svg: 'SVG group',
  'svg-single': 'SVG shape',
  group: 'Group',
};

/** A short, collision-free id. Not a UUID — these are only unique within one map. */
export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Depth-first walk over an artboard's object tree, including nested group children. */
export function walkObjects(
  objects: readonly ImageMapObject[] | undefined,
  visit: (obj: ImageMapObject, parent: ImageMapObject | null) => void,
  parent: ImageMapObject | null = null,
): void {
  for (const obj of objects ?? []) {
    visit(obj, parent);
    walkObjects(obj.children, visit, obj);
  }
}

/** Every object in an artboard, flattened, with its nesting depth — what the object list renders. */
export function flattenObjects(artboard: ImageMapArtboard | undefined): Array<{ obj: ImageMapObject; depth: number }> {
  const out: Array<{ obj: ImageMapObject; depth: number }> = [];
  const walk = (objects: readonly ImageMapObject[] | undefined, depth: number): void => {
    for (const obj of objects ?? []) {
      out.push({ obj, depth });
      walk(obj.children, depth + 1);
    }
  };
  walk(artboard?.children, 0);
  return out;
}

/** Find one object anywhere in an artboard. */
export function findObject(artboard: ImageMapArtboard | undefined, id: string): ImageMapObject | undefined {
  let found: ImageMapObject | undefined;
  walkObjects(artboard?.children, (obj) => {
    if (obj.id === id) found = obj;
  });
  return found;
}

/**
 * Replace one object in an artboard, returning a NEW artboard.
 *
 * `update` returning null DELETES the object. Immutable throughout: React state and the undo stack
 * both depend on a changed object producing a changed reference all the way to the root.
 */
export function mapObject(
  artboard: ImageMapArtboard,
  id: string,
  update: (obj: ImageMapObject) => ImageMapObject | null,
): ImageMapArtboard {
  // `changed` is threaded through so an untouched branch keeps its IDENTITY, not just its value:
  // cloning every ancestor-with-children on each edit would re-render the whole tree, and on a map
  // with hundreds of hotspots that is the difference between a smooth drag and a stuttering one.
  let changed = false;
  const walk = (objects: readonly ImageMapObject[] | undefined): ImageMapObject[] => {
    const out: ImageMapObject[] = [];
    for (const obj of objects ?? []) {
      if (obj.id === id) {
        changed = true;
        const next = update(obj);
        if (next) out.push(next);
        continue;
      }
      if (!obj.children) {
        out.push(obj);
        continue;
      }
      const before = changed;
      const children = walk(obj.children);
      out.push(changed === before ? obj : { ...obj, children });
    }
    return out;
  };
  const children = walk(artboard.children);
  return changed ? { ...artboard, children } : artboard;
}

/** Replace one artboard, returning a NEW map. */
export function mapArtboard(
  map: ImageMap,
  artboardId: string,
  update: (artboard: ImageMapArtboard) => ImageMapArtboard,
): ImageMap {
  return {
    ...map,
    artboards: map.artboards.map((a) => (a.id === artboardId ? update(a) : a)),
  };
}

/**
 * The runtime's artboard size when the config doesn't give one.
 *
 * ★ AN ARTBOARD OWNS ITS PIXEL SIZE — `general` does not. The runtime deep-extends every artboard
 * against `artboardDefaults` (shared/import.js) and then reads `artboard.width`/`height` directly
 * (imageMap.js), with no fallback; `imageMapDefaults.general` has no width or height at all. So an
 * artboard with no explicit size is 848×480 on the published page whatever the map-level config
 * says, and a Studio that previewed `general` instead was drawing a different aspect ratio from the
 * one visitors get — every hotspot landing somewhere else. Only these two numbers are real.
 */
export const RUNTIME_ARTBOARD_SIZE = { width: 848, height: 480 } as const;

/** The artboard's pixel size, exactly as the runtime resolves it. */
export function artboardSize(artboard: ImageMapArtboard | undefined): { width: number; height: number } {
  return {
    width: artboard?.width ?? RUNTIME_ARTBOARD_SIZE.width,
    height: artboard?.height ?? RUNTIME_ARTBOARD_SIZE.height,
  };
}

/** A new artboard, sized explicitly so the Studio and the published page can never disagree. */
export function newArtboard(title: string): ImageMapArtboard {
  return {
    id: newId('artboard'),
    title,
    background_type: 'color',
    background_color: '#f1f5f9',
    image_url: '',
    width: RUNTIME_ARTBOARD_SIZE.width,
    height: RUNTIME_ARTBOARD_SIZE.height,
    children: [],
  };
}

/** Clamp a percentage into the artboard, leaving `size` room so an object can't be dragged fully out. */
export function clampPct(value: number, size = 0): number {
  return Math.min(100 - size, Math.max(0, value));
}

/** Round to 4 decimals — enough for sub-pixel accuracy at any sane artboard size, without noise. */
export function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * A new hotspot of `type`, centred on (x, y) in percent.
 *
 * Only the fields that differ from the runtime's own objectDefaults are set: it deep-extends every
 * object against them, so writing the full default set here would be a second copy to keep in step.
 */
export function newObject(type: DrawableType, x: number, y: number, title: string): ImageMapObject {
  const base = baseObject(type, x, y, title);
  if (type === 'poly') {
    // A click with the polygon tool that never became a trace. Three vertices the author can
    // reshape — but tracing (see {@link polyFromPoints}) is the path this tool is really for.
    return {
      ...base,
      x: round(clampPct(x - 7, 14)),
      y: round(clampPct(y - 6, 12)),
      width: 14,
      height: 12,
      points: [
        { x: 50, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    };
  }
  if (type === 'spot') {
    // A pin is drawn at its icon size, not as a percentage box.
    return { ...base, width: 4, height: 4 };
  }
  if (type === 'text') {
    return { ...base, width: 20, height: 6, text: { text: title, font_size: 16, text_color: '#111111' } };
  }
  return { ...base, width: 14, height: 12 };
}

/**
 * Everything a hotspot has before its shape decides its geometry.
 *
 * Only the fields that differ from the runtime's own objectDefaults are set: it deep-extends every
 * object against them, so writing the full default set here would be a second copy to keep in step.
 */
function baseObject(type: DrawableType, x: number, y: number, title: string): ImageMapObject {
  return {
    id: newId(type),
    title,
    type,
    x: round(clampPct(x)),
    y: round(clampPct(y)),
    default_style: { background_color: '#0a7a5a', background_opacity: 0.35 },
    mouseover_style: { background_color: '#0a7a5a', background_opacity: 0.6 },
    tooltip: { enable_tooltip: true },
    tooltip_content: [],
    actions: { click: 'no-action' },
  };
}

/** A hotspot sized by a drag rather than dropped at a default size. */
export function sizedObject(type: DrawableType, bounds: Bounds, title: string): ImageMapObject {
  const base = baseObject(type, bounds.x, bounds.y, title);
  const sized = { ...base, width: bounds.width, height: bounds.height };
  return type === 'text' ? { ...sized, text: { text: title, font_size: 16, text_color: '#111111' } } : sized;
}

export interface Point {
  x: number;
  y: number;
}

export interface Bounds extends Point {
  width: number;
  height: number;
}

/**
 * Smallest box a shape may be drawn or normalised to, in percent of the artboard.
 *
 * A polygon traced as a straight line has no height; without a floor its box would be zero and
 * every box-relative vertex would divide by it.
 */
export const MIN_BOX = 0.5;

/**
 * How far the pointer must travel before a press-drag-release is read as SIZING the shape rather
 * than as a click that drops one at its default size. In percent of the artboard.
 */
export const DRAG_THRESHOLD = 1.5;

/** The box a press-drag-release describes, in whichever direction it was dragged. */
export function boundsFromDrag(start: Point, end: Point): Bounds {
  const x = clampPct(Math.min(start.x, end.x));
  const y = clampPct(Math.min(start.y, end.y));
  return {
    x: round(x),
    y: round(y),
    width: round(Math.max(MIN_BOX, Math.min(100 - x, Math.abs(end.x - start.x)))),
    height: round(Math.max(MIN_BOX, Math.min(100 - y, Math.abs(end.y - start.y)))),
  };
}

/**
 * The box and box-relative vertices for a polygon given its vertices in ARTBOARD percent — the form
 * tracing produces, and the inverse of what {@link polyPointToArtboard} does when drawing.
 */
export function polyGeometry(points: ReadonlyArray<Point>): Bounds & { points: Point[] } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(MIN_BOX, Math.max(...xs) - minX);
  const height = Math.max(MIN_BOX, Math.max(...ys) - minY);
  return {
    x: round(minX),
    y: round(minY),
    width: round(width),
    height: round(height),
    points: xs.map((x, i) => ({
      x: round(((x - minX) / width) * 100),
      y: round((((ys[i] ?? 0) - minY) / height) * 100),
    })),
  };
}

/**
 * A polygon traced vertex by vertex over the artboard — the tool's whole reason for existing.
 *
 * This is the boundary where a pointer becomes geometry, so it is where a stray vertex is pulled
 * back onto the artboard. {@link polyGeometry} itself stays pure, because {@link normalizePoly}
 * re-derives an existing shape's box with it and must not move the shape while doing so.
 */
export function polyFromPoints(points: ReadonlyArray<Point>, title: string): ImageMapObject {
  const geometry = polyGeometry(points.map((p) => ({ x: clampPct(p.x), y: clampPct(p.y) })));
  return { ...baseObject('poly', geometry.x, geometry.y, title), ...geometry };
}

/**
 * A polygon's box shrunk back onto its vertices, with the shape left exactly where it was.
 *
 * Dragging a vertex changes only that vertex, so the box slowly stops describing the shape — the
 * resize handles drift away from it and a later box-resize scales from the wrong origin. Re-deriving
 * the box from the artboard-space vertices is value-preserving: the transform is affine, so the
 * points move into the new box by exactly the amount the box moved.
 */
export function normalizePoly(obj: ImageMapObject): ImageMapObject {
  const points = obj.points ?? [];
  if (points.length < 3) return obj;
  return { ...obj, ...polyGeometry(points.map((p) => polyPointToArtboard(obj, p))) };
}

/** A vertex inserted at the midpoint of the edge leaving vertex `index`, wrapping at the end. */
export function insertPolyVertex(obj: ImageMapObject, index: number): Point[] {
  const points = obj.points ?? [];
  if (points.length < 2) return [...points];
  const a = points[index % points.length]!;
  const b = points[(index + 1) % points.length]!;
  const next = [...points];
  // Points are box-relative and the box-to-artboard transform is affine, so the midpoint of two
  // vertices is the midpoint of the drawn edge — no conversion needed.
  next.splice(index + 1, 0, { x: round((a.x + b.x) / 2), y: round((a.y + b.y) / 2) });
  return next;
}

/** A polygon without vertex `index`, or null when removing it would leave fewer than three. */
export function removePolyVertex(obj: ImageMapObject, index: number): Point[] | null {
  const points = obj.points ?? [];
  if (points.length <= 3 || index < 0 || index >= points.length) return null;
  return points.filter((_, i) => i !== index);
}

/**
 * An object's box, in percent of the ARTBOARD. Every type — polygons included — carries its own
 * x/y/width/height; see {@link polyPointToArtboard} for why a polygon's `points` are not it.
 */
export function objectBounds(obj: ImageMapObject): { x: number; y: number; width: number; height: number } {
  return { x: obj.x ?? 0, y: obj.y ?? 0, width: obj.width ?? 0, height: obj.height ?? 0 };
}

/**
 * A polygon vertex converted from its stored form to a position on the artboard, both in percent.
 *
 * ★ A polygon's `points` are percentages of the object's OWN BOUNDING BOX, not of the artboard —
 * this is what the runtime's Poly renderer does:
 *
 *     x = artboardWidth * (obj.x / 100) + (point.x / 100) * (artboardWidth * obj.width / 100)
 *
 * which reduces to the artboard percentage below. Treating `points` as artboard percentages draws a
 * wildly distorted shape (and it looks plausible enough on a busy background to miss). The upside of
 * the real model: moving or resizing a polygon only touches x/y/width/height, and the points come
 * along untouched.
 */
export function polyPointToArtboard(
  obj: ImageMapObject,
  point: { x: number; y: number },
): { x: number; y: number } {
  const b = objectBounds(obj);
  return { x: b.x + (point.x / 100) * b.width, y: b.y + (point.y / 100) * b.height };
}

/** The inverse of {@link polyPointToArtboard}: an artboard position back to a box-relative vertex. */
export function artboardToPolyPoint(
  obj: ImageMapObject,
  at: { x: number; y: number },
): { x: number; y: number } {
  const b = objectBounds(obj);
  return {
    x: b.width === 0 ? 0 : round(((at.x - b.x) / b.width) * 100),
    y: b.height === 0 ? 0 : round(((at.y - b.y) / b.height) * 100),
  };
}

/** A blank map, ready for its first artboard image. */
export function emptyMap(id: string, name: string): ImageMap {
  return {
    id,
    general: { name },
    artboards: [newArtboard('Artboard 1')],
  };
}

/** A new tooltip content block of `type`, with the minimum a renderer needs. */
export function newTooltipBlock(type: ImageMapTooltipBlock['type']): ImageMapTooltipBlock {
  switch (type) {
    case 'Heading':
      return { type: 'Heading', text: 'Heading', heading: 'h3' };
    case 'Paragraph':
      return { type: 'Paragraph', text: 'Some text.' };
    case 'Button':
      return { type: 'Button', text: 'Learn more', url: '#', newTab: false };
    case 'Image':
      return { type: 'Image', url: '', linkUrl: '' };
    case 'Video':
      return { type: 'Video', src: { mp4: '' }, linkUrl: '', controls: true };
    case 'YouTube':
      return { type: 'YouTube', embedCode: '', allowFullscreen: true };
  }
}

/** Human label for a tooltip block in the builder list. */
export function blockLabel(block: ImageMapTooltipBlock): string {
  if (block.type === 'Heading' || block.type === 'Paragraph' || block.type === 'Button') {
    return block.text?.replace(/<[^>]*>/g, '').slice(0, 40) || block.type;
  }
  if (block.type === 'Image') return block.url ? block.url.split('/').pop() ?? 'Image' : 'Image';
  return block.type;
}

/** Total hotspots in a map, nested children included — the count the map list shows. */
export function countHotspots(map: ImageMap): number {
  let n = 0;
  for (const artboard of map.artboards) walkObjects(artboard.children, () => n++);
  return n;
}
