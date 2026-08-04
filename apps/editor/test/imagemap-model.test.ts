import { describe, it, expect } from 'vitest';
import type { ImageMapArtboard, ImageMapObject } from '@sitewright/schema';
import {
  artboardSize,
  DEFAULT_ICON_NAME,
  ICON_SIZE_PX,
  iconNameOf,
  isIconSpot,
  storedType,
  artboardToPolyPoint,
  boundsFromDrag,
  clampPct,
  countHotspots,
  emptyMap,
  findObject,
  flattenObjects,
  insertPolyVertex,
  mapArtboard,
  mapObject,
  newArtboard,
  newObject,
  normalizePoly,
  objectBounds,
  polyFromPoints,
  polyPointToArtboard,
  removePolyVertex,
  RUNTIME_ARTBOARD_SIZE,
  sizedObject,
  walkObjects,
} from '../src/views/library/imagemap/model';

const obj = (over: Partial<ImageMapObject> & { id: string }): ImageMapObject => ({
  title: over.id,
  type: 'rect',
  ...over,
});

const artboard = (children: ImageMapObject[]): ImageMapArtboard => ({
  id: 'a1',
  title: 'A',
  background_type: 'color',
  image_url: '',
  children,
});

describe('polygon coordinates', () => {
  // ★ THE ONE THAT BIT. A polygon's `points` are percentages of the object's OWN BOUNDING BOX, not
  // of the artboard — the runtime's Poly renderer computes
  //   x = artboardW * (obj.x/100) + (point.x/100) * (artboardW * obj.width/100)
  // Reading them as artboard percentages draws a wildly distorted shape that still looks plausible
  // over a busy photograph, which is exactly how it survived a first visual check.
  const poly = obj({ id: 'p', type: 'poly', x: 20, y: 10, width: 40, height: 30, points: [] });

  it('maps a box-relative vertex onto the artboard', () => {
    expect(polyPointToArtboard(poly, { x: 0, y: 0 })).toEqual({ x: 20, y: 10 });
    expect(polyPointToArtboard(poly, { x: 100, y: 100 })).toEqual({ x: 60, y: 40 });
    expect(polyPointToArtboard(poly, { x: 50, y: 50 })).toEqual({ x: 40, y: 25 });
  });

  it('round-trips back to box-relative', () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 37.5, y: 62.5 },
    ]) {
      expect(artboardToPolyPoint(poly, polyPointToArtboard(poly, point))).toEqual(point);
    }
  });

  it('does not divide by zero on a degenerate box', () => {
    const flat = obj({ id: 'f', type: 'poly', x: 5, y: 5, width: 0, height: 0 });
    expect(artboardToPolyPoint(flat, { x: 50, y: 50 })).toEqual({ x: 0, y: 0 });
  });

  it('gives a polygon a real box, so moving and resizing it never touch its points', () => {
    // The payoff of the correct model: a drag changes x/y only.
    const created = newObject('poly', 50, 50, 'Region');
    expect(created.width).toBeGreaterThan(0);
    expect(created.height).toBeGreaterThan(0);
    expect(objectBounds(created).width).toBe(created.width);
    // Its points are box-relative (0–100), NOT artboard positions near 50.
    for (const p of created.points ?? []) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
  });
});

describe('clampPct', () => {
  it('keeps a position inside the artboard', () => {
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(120)).toBe(100);
    expect(clampPct(42)).toBe(42);
  });

  it('leaves room for the object’s own size, so it can’t be dragged fully out', () => {
    expect(clampPct(95, 20)).toBe(80);
    expect(clampPct(-5, 20)).toBe(0);
  });
});

describe('object tree', () => {
  const tree = artboard([
    obj({ id: 'a' }),
    obj({ id: 'g', type: 'group', children: [obj({ id: 'g1' }), obj({ id: 'g2', type: 'group', children: [obj({ id: 'g2a' })] })] }),
  ]);

  it('walks nested group children', () => {
    const seen: string[] = [];
    walkObjects(tree.children, (o) => seen.push(o.id));
    expect(seen).toEqual(['a', 'g', 'g1', 'g2', 'g2a']);
  });

  it('flattens with depth for the list', () => {
    expect(flattenObjects(tree).map((r) => [r.obj.id, r.depth])).toEqual([
      ['a', 0],
      ['g', 0],
      ['g1', 1],
      ['g2', 1],
      ['g2a', 2],
    ]);
  });

  it('finds an object at any depth', () => {
    expect(findObject(tree, 'g2a')?.id).toBe('g2a');
    expect(findObject(tree, 'nope')).toBeUndefined();
  });

  it('counts every hotspot in a map', () => {
    const map = { ...emptyMap('m', 'M'), artboards: [tree] };
    expect(countHotspots(map)).toBe(5);
  });
});

describe('immutable edits', () => {
  const tree = artboard([obj({ id: 'a', x: 1 }), obj({ id: 'g', type: 'group', children: [obj({ id: 'g1', x: 2 })] })]);

  it('replaces a nested object without mutating the original', () => {
    const next = mapObject(tree, 'g1', (o) => ({ ...o, x: 99 }));
    expect(findObject(next, 'g1')?.x).toBe(99);
    // The source tree is untouched — React state and any undo stack depend on this.
    expect(findObject(tree, 'g1')?.x).toBe(2);
    expect(next).not.toBe(tree);
  });

  it('deletes when the updater returns null', () => {
    const next = mapObject(tree, 'g1', () => null);
    expect(findObject(next, 'g1')).toBeUndefined();
    expect(findObject(next, 'g')).toBeDefined();
  });

  it('leaves untouched branches referentially equal, so React can skip them', () => {
    const next = mapObject(tree, 'a', (o) => ({ ...o, x: 5 }));
    expect(findObject(next, 'g')).toBe(findObject(tree, 'g'));
  });

  it('replaces one artboard only', () => {
    const map = { ...emptyMap('m', 'M'), artboards: [tree, { ...tree, id: 'a2' }] };
    const next = mapArtboard(map, 'a2', (a) => ({ ...a, title: 'Renamed' }));
    expect(next.artboards[1]!.title).toBe('Renamed');
    expect(next.artboards[0]).toBe(map.artboards[0]);
  });
});

describe('newObject', () => {
  it('centres a pin on the click and keeps it inside the artboard', () => {
    const pin = newObject('icon', 99, 99, 'Pin');
    expect(pin.x).toBeLessThanOrEqual(100);
    expect(pin.y).toBeLessThanOrEqual(100);
    expect(pin.type).toBe('spot');
  });

  it('starts every hotspot with a tooltip enabled and no action', () => {
    const rect = newObject('rect', 10, 10, 'R');
    expect(rect.tooltip).toEqual({ enable_tooltip: true });
    expect(rect.actions?.click).toBe('no-action');
    // Never `run-script` — the runtime cannot execute one and the schema rejects it.
    expect(JSON.stringify(rect)).not.toContain('run-script');
  });
});

describe('emptyMap', () => {
  it('has exactly one artboard, ready for a background', () => {
    const map = emptyMap('m1', 'My map');
    expect(map.id).toBe('m1');
    expect(map.general.name).toBe('My map');
    expect(map.artboards).toHaveLength(1);
    expect(map.artboards[0]!.children).toEqual([]);
    // An artboard id is REQUIRED — without one a floor switcher silently does nothing.
    expect(map.artboards[0]!.id).toBeTruthy();
  });

  it('sizes its artboard explicitly, and puts no size on the map', () => {
    const map = emptyMap('m1', 'My map');
    expect(map.artboards[0]).toMatchObject(RUNTIME_ARTBOARD_SIZE);
    // ★ `general.width`/`height` are a fiction: imageMapDefaults.general has neither, and the
    // runtime sizes from the artboard alone. Writing them there would look authoritative and do
    // nothing.
    expect(map.general).not.toHaveProperty('width');
    expect(map.general).not.toHaveProperty('height');
  });
});

describe('artboard size', () => {
  it('is the artboard’s own, when it has one', () => {
    expect(artboardSize({ ...newArtboard('A'), width: 1365, height: 768 })).toEqual({ width: 1365, height: 768 });
  });

  it('falls back to exactly what the runtime would use', () => {
    // The runtime deep-extends every artboard against artboardDefaults (848×480) and never consults
    // `general` — so any other fallback here would draw an aspect ratio visitors never see.
    expect(artboardSize({ id: 'a', title: 'A', background_type: 'color', image_url: '', children: [] })).toEqual({
      width: 848,
      height: 480,
    });
    expect(artboardSize(undefined)).toEqual(RUNTIME_ARTBOARD_SIZE);
  });

  it('gives every new artboard a size, so the Studio and the page cannot drift apart', () => {
    expect(newArtboard('Second')).toMatchObject(RUNTIME_ARTBOARD_SIZE);
  });
});

describe('tracing a polygon', () => {
  // Vertices as the author clicked them: positions on the ARTBOARD, in percent.
  const traced = [
    { x: 20, y: 30 },
    { x: 60, y: 25 },
    { x: 70, y: 70 },
    { x: 25, y: 65 },
  ];

  it('boxes the trace and stores the vertices relative to that box', () => {
    const poly = polyFromPoints(traced, 'Roof');
    expect(poly.type).toBe('poly');
    expect(poly.title).toBe('Roof');
    // The box is the extent of what was traced: x 20–70, y 25–70.
    expect(poly).toMatchObject({ x: 20, y: 25, width: 50, height: 45 });
    expect(poly.points).toEqual([
      { x: 0, y: 11.1111 },
      { x: 80, y: 0 },
      { x: 100, y: 100 },
      { x: 10, y: 88.8889 },
    ]);
  });

  it('draws back exactly where it was traced', () => {
    // The whole point of the box-relative form: it must survive the round trip, or a traced outline
    // lands somewhere other than the contour the author followed.
    const poly = polyFromPoints(traced, 'Roof');
    const back = (poly.points ?? []).map((p) => polyPointToArtboard(poly, p));
    for (const [i, point] of traced.entries()) {
      expect(back[i]!.x).toBeCloseTo(point.x, 3);
      expect(back[i]!.y).toBeCloseTo(point.y, 3);
    }
  });

  it('survives a trace with no width — a straight line does not divide by zero', () => {
    const line = polyFromPoints([{ x: 40, y: 10 }, { x: 40, y: 50 }, { x: 40, y: 90 }], 'Edge');
    expect(line.width).toBeGreaterThan(0);
    expect(line.points!.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it('keeps a trace that ran off the artboard inside it', () => {
    const poly = polyFromPoints([{ x: -20, y: 50 }, { x: 50, y: 130 }, { x: 90, y: 40 }], 'Clamped');
    expect(poly.x).toBeGreaterThanOrEqual(0);
    expect(poly.y).toBeGreaterThanOrEqual(0);
    expect(poly.x! + poly.width!).toBeLessThanOrEqual(100);
    expect(poly.y! + poly.height!).toBeLessThanOrEqual(100);
  });
});

describe('polygon vertices', () => {
  const poly = polyFromPoints(
    [
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 50 },
      { x: 10, y: 50 },
    ],
    'Square',
  );

  it('inserts a vertex at the midpoint of the edge it was asked for', () => {
    const points = insertPolyVertex(poly, 0);
    expect(points).toHaveLength(5);
    expect(points[1]).toEqual({ x: 50, y: 0 }); // halfway along the top edge, in box space
  });

  it('inserts on the closing edge, back to the first vertex', () => {
    const points = insertPolyVertex(poly, 3);
    expect(points).toHaveLength(5);
    expect(points[4]).toEqual({ x: 0, y: 50 }); // halfway down the left edge
  });

  it('removes the vertex asked for', () => {
    expect(removePolyVertex(poly, 1)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]);
  });

  it('refuses to take a triangle below three points, or to touch an index that isn’t there', () => {
    const triangle = polyFromPoints([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 25, y: 40 }], 'Tri');
    expect(removePolyVertex(triangle, 0)).toBeNull();
    expect(removePolyVertex(poly, 9)).toBeNull();
    expect(removePolyVertex(poly, -1)).toBeNull();
  });
});

describe('normalizePoly', () => {
  it('shrinks the box back onto the shape without moving the shape', () => {
    const poly = polyFromPoints([{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }], 'Wedge');
    // Drag one vertex well outside the box — points may legitimately leave 0–100.
    const dragged = { ...poly, points: [{ x: -50, y: 0 }, ...poly.points!.slice(1)] };
    const before = (dragged.points ?? []).map((p) => polyPointToArtboard(dragged, p));

    const tidy = normalizePoly(dragged);
    const after = (tidy.points ?? []).map((p) => polyPointToArtboard(tidy, p));
    for (const [i, point] of before.entries()) {
      expect(after[i]!.x).toBeCloseTo(point.x, 3);
      expect(after[i]!.y).toBeCloseTo(point.y, 3);
    }
    // The box now hugs the vertices, so the resize handles sit on the shape again.
    expect(Math.min(...tidy.points!.map((p) => p.x))).toBeCloseTo(0, 3);
    expect(Math.max(...tidy.points!.map((p) => p.x))).toBeCloseTo(100, 3);
  });

  it('leaves a degenerate polygon alone rather than inventing a box for it', () => {
    const two = { ...newObject('poly', 10, 10, 'P'), points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] };
    expect(normalizePoly(two)).toBe(two);
  });
});

describe('drag-to-size', () => {
  it('reads a box out of a drag in any direction', () => {
    expect(boundsFromDrag({ x: 10, y: 10 }, { x: 40, y: 50 })).toEqual({ x: 10, y: 10, width: 30, height: 40 });
    // Dragged up and to the left — same box.
    expect(boundsFromDrag({ x: 40, y: 50 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10, width: 30, height: 40 });
  });

  it('keeps the box on the artboard', () => {
    const b = boundsFromDrag({ x: 80, y: 80 }, { x: 140, y: 140 });
    expect(b.x + b.width).toBeLessThanOrEqual(100);
    expect(b.y + b.height).toBeLessThanOrEqual(100);
  });

  it('never produces a zero-sized shape', () => {
    const b = boundsFromDrag({ x: 50, y: 50 }, { x: 50, y: 50 });
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
  });

  it('builds a hotspot at the dragged size, with a tooltip and no action', () => {
    const rect = sizedObject('rect', { x: 5, y: 6, width: 30, height: 20 }, 'Wing');
    expect(rect).toMatchObject({ type: 'rect', x: 5, y: 6, width: 30, height: 20, title: 'Wing' });
    expect(rect.tooltip).toEqual({ enable_tooltip: true });
    expect(rect.actions?.click).toBe('no-action');
    expect(sizedObject('text', { x: 0, y: 0, width: 10, height: 5 }, 'Label').text).toMatchObject({ text: 'Label' });
  });
});

describe('the ICON hotspot', () => {
  // ★ It replaced separate Pin and Dot tools. Both were one fixed icon each, so a map that wanted a
  // bed, a car or a flag was stuck — and the two disagreed with the page in different ways.
  it('stores as the `spot` the runtime already knows, with the icon turned on', () => {
    const icon = newObject('icon', 40, 50, 'Icon');
    expect(icon.type).toBe('spot');
    expect(storedType('icon')).toBe('spot');
    const style = icon.default_style as Record<string, unknown>;
    expect(style.use_icon).toBe(true);
    expect(style.icon_type).toBe('library');
    expect(isIconSpot(icon)).toBe(true);
  });

  it('defaults to a filled map pin', () => {
    const icon = newObject('icon', 10, 10, 'Icon');
    expect(iconNameOf(icon)).toBe(DEFAULT_ICON_NAME);
    expect(DEFAULT_ICON_NAME).toBe('map-pin:fill');
  });

  it('carries its ARTWORK, not just the icon name', () => {
    // The runtime cannot resolve a name against the platform's icon library — a bundled runtime has
    // no access to it — so a hotspot that stored only the name would render nothing on the page.
    const style = newObject('icon', 10, 10, 'Icon').default_style as Record<string, unknown>;
    expect(String(style.icon_svg)).toContain('<svg');
    expect(String(style.icon_svg)).toContain('path');
  });

  it('is sized in PIXELS, which is what the runtime reads for a spot', () => {
    const icon = newObject('icon', 0, 0, 'Icon');
    expect(icon.width).toBe(ICON_SIZE_PX);
    expect((icon.default_style as Record<string, unknown>).icon_size).toBe(ICON_SIZE_PX);
  });

  it('takes the project palette: CI primary at rest, secondary on hover', () => {
    const icon = newObject('icon', 0, 0, 'Icon', { fill: '#123456', hoverFill: '#abcdef' });
    expect((icon.default_style as Record<string, unknown>).icon_fill).toBe('#123456');
    expect((icon.mouseover_style as Record<string, unknown>).icon_fill).toBe('#abcdef');
  });

  it('reads an imported non-icon spot as NOT an icon, so it keeps drawing as its own box', () => {
    expect(isIconSpot({ id: 'x', type: 'spot', default_style: { use_icon: false } })).toBe(false);
  });

  it('every drawable tool maps to a type the runtime knows', () => {
    for (const tool of ['rect', 'oval', 'poly', 'icon', 'text'] as const) {
      expect(['rect', 'oval', 'poly', 'spot', 'text']).toContain(storedType(tool));
    }
  });
});
