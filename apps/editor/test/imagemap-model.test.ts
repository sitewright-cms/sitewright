import { describe, it, expect } from 'vitest';
import type { ImageMapArtboard, ImageMapObject } from '@sitewright/schema';
import {
  artboardToPolyPoint,
  clampPct,
  countHotspots,
  emptyMap,
  findObject,
  flattenObjects,
  mapArtboard,
  mapObject,
  newObject,
  objectBounds,
  polyPointToArtboard,
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
    const pin = newObject('spot', 99, 99, 'Pin');
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
});
