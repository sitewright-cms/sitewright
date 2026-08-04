import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImageMapArtboard, ImageMapObject } from '@sitewright/schema';
import {
  artboardSize,
  artboardToPolyPoint,
  boundsFromDrag,
  clampPct,
  DRAG_THRESHOLD,
  insertPolyVertex,
  normalizePoly,
  objectBounds,
  polyPointToArtboard,
  removePolyVertex,
  round,
  type Bounds,
  type DrawableType,
  type Point,
} from './model';

/**
 * The Studio canvas: the artboard background with every hotspot drawn over it, selectable, draggable
 * and resizable — and the surface the author traces new hotspots onto.
 *
 * DRAWN IN PERCENT, NOT PIXELS. Each hotspot is positioned with percentage CSS inside a box that has
 * the artboard's aspect ratio, which is exactly how the published runtime lays them out — so what
 * the author positions here is what a visitor sees at any width, and no conversion can drift.
 * Pointer coordinates are converted to percent against the drawn box on the fly.
 *
 * Pointer handling uses setPointerCapture, so a fast drag that leaves the element still tracks (and
 * still ends) — the usual mousemove-on-window dance isn't needed and can't leak a listener.
 */

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** What a finished draw gesture produced. The parent turns it into an object, so it owns naming. */
export type DrawSpec =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'bounds'; bounds: Bounds }
  | { kind: 'poly'; points: Point[] };

/** What a pointer press grabbed: the whole shape, a resize handle, or one polygon vertex. */
type DragTarget = Handle | 'move' | { vertex: number };

const HANDLES: ReadonlyArray<{ id: Handle; x: number; y: number; cursor: string }> = [
  { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { id: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { id: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { id: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { id: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { id: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { id: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { id: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
];

/** Smallest a hotspot may be dragged to, in percent — below this it becomes unselectable. */
const MIN_SIZE = 1;

/**
 * How close to the first vertex a click closes the trace, in SCREEN pixels.
 *
 * Pixels, not percent: percent is anisotropic on a non-square artboard (1% of width ≠ 1% of height)
 * and it shrinks as the author zooms in — exactly when they are placing vertices most precisely.
 */
const CLOSE_RADIUS_PX = 11;

interface CanvasProps {
  artboard: ImageMapArtboard;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Commit a geometry change. Called on every pointer move, so the parent should keep it cheap. */
  onChange: (id: string, patch: Partial<ImageMapObject>) => void;
  /** The tool in hand: null = select/move, otherwise the next gesture draws this shape. */
  drawing: DrawableType | null;
  onDraw: (type: DrawableType, spec: DrawSpec) => void;
  /** Open the media picker for this artboard's background. */
  onPickImage: () => void;
  /** An image file dropped straight onto the canvas. */
  onDropImage: (file: File) => void;
  /** A dropped file is on its way into the media library. */
  uploading?: boolean;
}

/**
 * A hotspot's fill for the CANVAS — its own styling, but never fully invisible.
 *
 * Plenty of real maps style a region at `background_opacity: 0` so it only appears on hover (every
 * polygon in the Real Estate template does). Faithful on the published page, useless in an editor:
 * the author would have nothing to see or grab. So the editor floors the opacity — what is drawn
 * here is the region, not a preview of the published styling.
 */
const EDITOR_MIN_OPACITY = 0.18;

function fillOf(obj: ImageMapObject): string {
  const style = (obj.default_style ?? {}) as { background_color?: unknown; background_opacity?: unknown };
  const color = typeof style.background_color === 'string' ? style.background_color : '#0a7a5a';
  const raw = typeof style.background_opacity === 'number' ? style.background_opacity : 0.35;
  const opacity = Math.max(EDITOR_MIN_OPACITY, raw);
  return `color-mix(in srgb, ${color} ${Math.round(opacity * 100)}%, transparent)`;
}

export function Canvas({
  artboard,
  selectedId,
  onSelect,
  onChange,
  drawing,
  onDraw,
  onPickImage,
  onDropImage,
  uploading = false,
}: CanvasProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  // A drag in flight. Held in a ref, not state: it changes on every pointer move and must not
  // re-render on its own — the object's own coordinates already do that.
  const dragRef = useRef<{ id: string; target: DragTarget; startX: number; startY: number; origin: ImageMapObject } | null>(null);
  // Vertices placed so far in a polygon trace, in artboard percent. Null = not tracing.
  const [trace, setTrace] = useState<Point[] | null>(null);
  // The live pointer, for the rubber-band segment and the drag-to-size preview.
  const [cursor, setCursor] = useState<Point | null>(null);
  const [boxDraft, setBoxDraft] = useState<{ start: Point; end: Point } | null>(null);
  // Which vertex of the selected polygon is armed for Delete.
  const [vertex, setVertex] = useState<number | null>(null);
  const [dropping, setDropping] = useState(false);

  const { width: aw, height: ah } = artboardSize(artboard);
  const ratio = ah / Math.max(1, aw);
  const tracing = drawing === 'poly';
  const hasImage = artboard.background_type === 'image' && Boolean(artboard.image_url);

  /** Pointer position as a percentage of the artboard box. */
  const pctFromEvent = useCallback((e: { clientX: number; clientY: number }): Point => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 };
    return { x: ((e.clientX - box.left) / box.width) * 100, y: ((e.clientY - box.top) / box.height) * 100 };
  }, []);

  /** How far apart two artboard-percent points are on screen. */
  const pxApart = useCallback((a: Point, b: Point): number => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return Number.POSITIVE_INFINITY;
    return Math.hypot(((a.x - b.x) / 100) * box.width, ((a.y - b.y) / 100) * box.height);
  }, []);

  const objects = useMemo(() => {
    const list: ImageMapObject[] = [];
    const walk = (objs: readonly ImageMapObject[] | undefined): void => {
      for (const o of objs ?? []) {
        // A group is a container, not a drawn shape — its children are what the author manipulates.
        if (o.type !== 'group') list.push(o);
        walk(o.children);
      }
    };
    walk(artboard.children);
    return list;
  }, [artboard]);

  // Leaving the polygon tool abandons a half-finished trace rather than stranding it.
  useEffect(() => {
    if (!tracing) setTrace(null);
  }, [tracing]);

  useEffect(() => setVertex(null), [selectedId]);

  /**
   * Close the trace into a polygon.
   *
   * Trailing near-duplicates are dropped: the double-click that ends a trace also places a vertex
   * on top of the one before it, and a zero-length edge is invisible but real.
   */
  const finishTrace = useCallback(() => {
    if (!trace) return;
    // Read from the render's own `trace`, NOT from inside a setTrace updater: React double-invokes
    // updaters under StrictMode, and onDraw in there would commit two polygons per trace.
    const points = trace.filter((p, i) => i === 0 || pxApart(p, trace[i - 1]!) > CLOSE_RADIUS_PX / 2);
    setTrace(null);
    if (points.length >= 3) onDraw('poly', { kind: 'poly', points });
  }, [trace, onDraw, pxApart]);

  function beginDrag(e: React.PointerEvent, obj: ImageMapObject, target: DragTarget, origin = obj): void {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const start = pctFromEvent(e);
    dragRef.current = { id: obj.id, target, startX: start.x, startY: start.y, origin };
    onSelect(obj.id);
  }

  /** A press on a midpoint handle inserts a vertex there and drags the new one straight away. */
  function beginInsert(e: React.PointerEvent, obj: ImageMapObject, edge: number): void {
    const points = insertPolyVertex(obj, edge);
    onChange(obj.id, { points });
    setVertex(edge + 1);
    // The drag's origin must be the object as it is AFTER the insert — the parent's state update
    // hasn't landed yet, and the drag maths reads this snapshot, not the rendered object.
    beginDrag(e, obj, { vertex: edge + 1 }, { ...obj, points });
  }

  function onPointerMove(e: React.PointerEvent): void {
    if (boxDraft) {
      const at = pctFromEvent(e);
      setCursor(at);
      setBoxDraft({ ...boxDraft, end: at });
      return;
    }
    if (tracing) setCursor(pctFromEvent(e));

    const drag = dragRef.current;
    if (!drag) return;
    const at = pctFromEvent(e);
    const dx = at.x - drag.startX;
    const dy = at.y - drag.startY;
    const o = drag.origin;

    // A polygon vertex. `points` are box-relative, so the pointer's artboard position is converted
    // back into that space rather than nudged directly.
    if (typeof drag.target === 'object') {
      const index = drag.target.vertex;
      // Clamped here, where the author watches the handle stop at the edge — rather than on drag
      // end, which would silently move a vertex they had already placed.
      const inside = { x: clampPct(at.x), y: clampPct(at.y) };
      const points = (o.points ?? []).map((p, i) => (i === index ? artboardToPolyPoint(o, inside) : p));
      onChange(drag.id, { points });
      return;
    }

    if (drag.target === 'move') {
      const b = objectBounds(o);
      onChange(drag.id, {
        x: round(clampPct(b.x + dx, b.width)),
        y: round(clampPct(b.y + dy, b.height)),
      });
      return;
    }

    // A resize handle. Each edge moves independently so a corner drags both.
    const b = objectBounds(o);
    let { x, y, width, height } = b;
    const h = drag.target;
    if (h.includes('w')) {
      const nx = Math.min(b.x + dx, b.x + b.width - MIN_SIZE);
      width = b.width + (b.x - nx);
      x = nx;
    }
    if (h.includes('e')) width = Math.max(MIN_SIZE, b.width + dx);
    if (h.includes('n')) {
      const ny = Math.min(b.y + dy, b.y + b.height - MIN_SIZE);
      height = b.height + (b.y - ny);
      y = ny;
    }
    if (h.includes('s')) height = Math.max(MIN_SIZE, b.height + dy);

    onChange(drag.id, {
      x: round(clampPct(x)),
      y: round(clampPct(y)),
      width: round(Math.max(MIN_SIZE, Math.min(100 - x, width))),
      height: round(Math.max(MIN_SIZE, Math.min(100 - y, height))),
    });
  }

  function onCanvasPointerDown(e: React.PointerEvent): void {
    const at = pctFromEvent(e);

    if (tracing) {
      // Clicking the first vertex again closes the shape.
      if (trace && trace.length >= 3 && pxApart(at, trace[0]!) <= CLOSE_RADIUS_PX) {
        finishTrace();
        return;
      }
      setTrace([...(trace ?? []), { x: round(clampPct(at.x)), y: round(clampPct(at.y)) }]);
      setCursor(at);
      return;
    }

    if (drawing) {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      setBoxDraft({ start: at, end: at });
      return;
    }

    // A click on the background clears the selection.
    if (e.target === e.currentTarget) onSelect(null);
  }

  function endDrag(e: React.PointerEvent): void {
    if (boxDraft && drawing) {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      const { start, end } = boxDraft;
      setBoxDraft(null);
      // A drag sizes the shape; a plain click drops it at its default size. A PIN has no size to
      // drag out — the runtime draws it at its icon size — so it is always placed at the press.
      const dragged =
        drawing !== 'spot' &&
        Math.abs(end.x - start.x) >= DRAG_THRESHOLD &&
        Math.abs(end.y - start.y) >= DRAG_THRESHOLD;
      onDraw(drawing, dragged ? { kind: 'bounds', bounds: boundsFromDrag(start, end) } : { kind: 'point', x: start.x, y: start.y });
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
    // A moved vertex leaves the box describing the shape's old extent. Re-derive it now the drag has
    // settled, rather than on every move — which would fight the pointer.
    if (typeof drag.target === 'object') {
      const obj = objects.find((o) => o.id === drag.id);
      if (obj) {
        const next = normalizePoly(obj);
        onChange(obj.id, { x: next.x, y: next.y, width: next.width, height: next.height, points: next.points });
      }
    }
  }

  // Tracing keys, bound only while a trace is open so Enter/Escape/Backspace mean the trace and not
  // the selection. Ignored while typing in a field.
  useEffect(() => {
    if (!trace) return;
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        finishTrace();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setTrace(null);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        setTrace((current) => (current && current.length > 1 ? current.slice(0, -1) : null));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [trace, finishTrace]);

  // Delete / nudge the selection. Bound to the window so it works wherever focus sits inside the
  // Studio, but ignored while typing in a field.
  useEffect(() => {
    if (!selectedId || trace) return;
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
      const obj = objects.find((o) => o.id === selectedId);
      if (!obj) return;
      // A polygon vertex is armed: Delete takes the point, not the whole hotspot.
      if (vertex !== null && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        const points = removePolyVertex(obj, vertex);
        if (points) {
          onChange(obj.id, { points });
          setVertex(null);
        }
        return;
      }
      const step = e.shiftKey ? 1 : 0.2;
      const nudge = (dx: number, dy: number): void => {
        e.preventDefault();
        const b = objectBounds(obj);
        onChange(obj.id, { x: round(clampPct(b.x + dx, b.width)), y: round(clampPct(b.y + dy, b.height)) });
      };
      if (e.key === 'ArrowLeft') nudge(-step, 0);
      else if (e.key === 'ArrowRight') nudge(step, 0);
      else if (e.key === 'ArrowUp') nudge(0, -step);
      else if (e.key === 'ArrowDown') nudge(0, step);
      else if (e.key === 'Escape') onSelect(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, objects, onChange, onSelect, trace, vertex]);

  function onDrop(e: React.DragEvent): void {
    e.preventDefault();
    setDropping(false);
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
    if (file) onDropImage(file);
  }

  const background = hasImage
    ? { backgroundImage: `url(${JSON.stringify(artboard.image_url)})`, backgroundSize: '100% 100%' }
    : { background: artboard.background_color ?? '#f1f5f9' };

  const draftBounds = boxDraft ? boundsFromDrag(boxDraft.start, boxDraft.end) : null;
  const traceClosable = Boolean(trace && trace.length >= 3 && cursor && pxApart(cursor, trace[0]!) <= CLOSE_RADIUS_PX);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-1.5 text-xs dark:border-slate-700">
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-2 py-0.5 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          onClick={onPickImage}
        >
          {hasImage ? 'Replace image' : 'Add image'}
        </button>
        <span className="text-slate-500 dark:text-slate-400">
          {aw} × {ah}
        </span>
        {trace ? (
          <span className="text-sky-600 dark:text-sky-400">
            {trace.length} point{trace.length === 1 ? '' : 's'} — click the first point or press Enter to close, Backspace to
            undo one, Esc to cancel
          </span>
        ) : tracing ? (
          <span className="text-sky-600 dark:text-sky-400">Click along the outline you want to make clickable</span>
        ) : drawing ? (
          <span className="text-sky-600 dark:text-sky-400">Drag to size it, or click to drop one</span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" aria-label="Zoom out" className="rounded px-2 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>
            −
          </button>
          <span className="w-12 text-center tabular-nums text-slate-500 dark:text-slate-400">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" className="rounded px-2 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>
            +
          </button>
          <button type="button" className="rounded px-2 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setZoom(1)}>
            Fit
          </button>
        </div>
      </div>

      <div
        className={`min-h-0 flex-1 overflow-auto p-6 ${dropping ? 'bg-sky-50 dark:bg-sky-950/40' : 'bg-slate-100 dark:bg-slate-900'}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDropping(false);
        }}
        onDrop={onDrop}
      >
        <div className="mx-auto" style={{ width: `${zoom * 100}%`, maxWidth: zoom <= 1 ? '100%' : 'none' }}>
          <div
            ref={boxRef}
            data-testid="imap-artboard"
            className="relative select-none shadow-sm ring-1 ring-slate-300 dark:ring-slate-700"
            style={{ ...background, paddingTop: `${ratio * 100}%`, cursor: drawing ? 'crosshair' : 'default' }}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerDown={onCanvasPointerDown}
            onDoubleClick={() => {
              if (trace) finishTrace();
            }}
          >
            {objects.map((obj) => (
              <Shape
                key={obj.id}
                obj={obj}
                selected={obj.id === selectedId}
                inert={drawing !== null}
                activeVertex={obj.id === selectedId ? vertex : null}
                onPointerDown={(e, target) => {
                  if (typeof target === 'object') setVertex(target.vertex);
                  beginDrag(e, obj, target);
                }}
                onRemoveVertex={(index) => {
                  const points = removePolyVertex(obj, index);
                  if (points) onChange(obj.id, { points });
                }}
                onInsertVertex={(e, edge) => beginInsert(e, obj, edge)}
              />
            ))}

            {/* The trace in progress, and the box being dragged out — drawn over everything else. */}
            {(trace || draftBounds) && (
              <svg className="pointer-events-none absolute inset-0 z-30 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {trace && trace.length > 0 && (
                  <polyline
                    data-testid="imap-trace"
                    points={[...trace, ...(cursor && !traceClosable ? [cursor] : []), ...(trace.length >= 2 ? [trace[0]!] : [])]
                      .map((p) => `${round(p.x)},${round(p.y)}`)
                      .join(' ')}
                    fill="rgba(14,165,233,0.18)"
                    stroke="#0ea5e9"
                    strokeWidth={2}
                    strokeDasharray="5 3"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {draftBounds && (
                  <rect
                    x={draftBounds.x}
                    y={draftBounds.y}
                    width={draftBounds.width}
                    height={draftBounds.height}
                    fill="rgba(14,165,233,0.18)"
                    stroke="#0ea5e9"
                    strokeWidth={2}
                    strokeDasharray="5 3"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </svg>
            )}

            {/* Placed vertices. Outside the svg so they stay round — it is stretched by
                preserveAspectRatio="none", which squashes anything drawn inside it. */}
            {trace?.map((p, i) => (
              <span
                key={i}
                data-testid="imap-trace-point"
                className={`pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ${
                  i === 0 && traceClosable ? 'h-4 w-4 bg-emerald-500' : 'h-2.5 w-2.5 bg-sky-500'
                }`}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              />
            ))}

            {!hasImage && !trace && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                <div className="pointer-events-auto max-w-sm rounded-2xl border-2 border-dashed border-slate-400 bg-white/85 px-6 py-5 text-center backdrop-blur dark:border-slate-500 dark:bg-slate-900/85">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                    {uploading ? 'Adding your image…' : 'Start with the image you want to make interactive'}
                  </p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    Drop a file here, or pick one from this project’s library. The artboard takes the image’s own size, so
                    what you draw lands where you drew it.
                  </p>
                  <button
                    type="button"
                    className="mt-3 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-60"
                    disabled={uploading}
                    onClick={onPickImage}
                  >
                    Choose an image
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Shape({
  obj,
  selected,
  inert,
  activeVertex,
  onPointerDown,
  onRemoveVertex,
  onInsertVertex,
}: {
  obj: ImageMapObject;
  selected: boolean;
  /** A draw tool is active: the shape stays visible but lets the pointer through to the canvas. */
  inert: boolean;
  /** Which vertex is armed for Delete, when this shape is the selected one. */
  activeVertex: number | null;
  onPointerDown: (e: React.PointerEvent, target: DragTarget) => void;
  onRemoveVertex: (index: number) => void;
  onInsertVertex: (e: React.PointerEvent, edge: number) => void;
}) {
  const b = objectBounds(obj);
  const ring = selected ? 'outline outline-2 outline-offset-1 outline-sky-500' : '';
  const inertStyle: React.CSSProperties = inert ? { pointerEvents: 'none' } : {};

  if (obj.type === 'poly') {
    // Stored vertices are box-relative; the canvas draws in artboard space.
    const pts = (obj.points ?? []).map((p) => polyPointToArtboard(obj, p));
    const midpoints = pts.map((p, i) => {
      const next = pts[(i + 1) % pts.length]!;
      return { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 };
    });
    return (
      <>
        {/* The polygon itself. An SVG overlay spanning the whole artboard keeps the point
            coordinates in the same percentage space as every other shape. */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polygon
            className="cursor-move"
            style={{ pointerEvents: inert ? 'none' : 'all' }}
            points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
            fill={fillOf(obj)}
            stroke={selected ? '#0ea5e9' : '#0f172a'}
            strokeWidth={selected ? 2 : 1}
            strokeDasharray={selected ? undefined : '4 3'}
            vectorEffect="non-scaling-stroke"
            onPointerDown={(e) => onPointerDown(e, 'move')}
          />
        </svg>
        {/* Vertex handles sit OUTSIDE the svg so they keep a circular shape — the svg is stretched
            by preserveAspectRatio="none", which would squash anything drawn inside it. */}
        {selected && !inert && (
          <>
            {midpoints.map((p, i) => (
              <button
                key={`mid-${i}`}
                type="button"
                aria-label={`Add a point on edge ${i + 1}`}
                title="Drag to add a point here"
                className="absolute z-20 h-2 w-2 -translate-x-1/2 -translate-y-1/2 cursor-copy rounded-full border border-sky-500 bg-white/90 opacity-70 hover:opacity-100 dark:bg-slate-900/90"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                onPointerDown={(e) => onInsertVertex(e, i)}
              />
            ))}
            {pts.map((p, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Point ${i + 1}`}
                title="Drag to move. Alt-click to remove."
                className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border border-white shadow ${
                  i === activeVertex ? 'h-3.5 w-3.5 bg-sky-400 ring-2 ring-sky-300' : 'h-2.5 w-2.5 bg-sky-500'
                }`}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                onPointerDown={(e) => {
                  // Alt-click removes a vertex — the convention every vector editor uses, and the
                  // only way to thin out an over-detailed trace without starting again.
                  if (e.altKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    onRemoveVertex(i);
                    return;
                  }
                  onPointerDown(e, { vertex: i });
                }}
              />
            ))}
            {/* The box handles resize the whole polygon — its relative points ride along. */}
            <div className="pointer-events-none absolute" style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.width}%`, height: `${b.height}%` }}>
              {HANDLES.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  aria-label={`Resize ${h.id}`}
                  className="pointer-events-auto absolute z-20 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white bg-slate-700 shadow"
                  style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, cursor: h.cursor }}
                  onPointerDown={(e) => onPointerDown(e, h.id)}
                />
              ))}
            </div>
          </>
        )}
      </>
    );
  }

  if (obj.type === 'spot') {
    return (
      <button
        type="button"
        aria-label={obj.title || 'Pin'}
        className={`absolute z-10 h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-white shadow ${ring}`}
        style={{ left: `${b.x}%`, top: `${b.y}%`, background: fillOf(obj) || '#0a7a5a', ...inertStyle }}
        onPointerDown={(e) => onPointerDown(e, 'move')}
      />
    );
  }

  // rect / oval / text / svg — an absolutely-positioned percentage box.
  return (
    <div
      className={`absolute z-10 ${ring}`}
      style={{
        left: `${b.x}%`,
        top: `${b.y}%`,
        width: `${b.width}%`,
        height: `${b.height}%`,
        background: fillOf(obj),
        border: selected ? '2px solid #0ea5e9' : '1px dashed #0f172a',
        borderRadius: obj.type === 'oval' ? '50%' : 4,
        ...inertStyle,
      }}
    >
      <button
        type="button"
        aria-label={obj.title || 'Hotspot'}
        className="absolute inset-0 cursor-move"
        onPointerDown={(e) => onPointerDown(e, 'move')}
      />
      {obj.type === 'text' && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center truncate px-1 text-xs">
          {String((obj.text as { text?: unknown } | undefined)?.text ?? obj.title ?? '')}
        </span>
      )}
      {selected &&
        HANDLES.map((h) => (
          <button
            key={h.id}
            type="button"
            aria-label={`Resize ${h.id}`}
            className="absolute z-20 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white bg-sky-500 shadow"
            style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, cursor: h.cursor }}
            onPointerDown={(e) => onPointerDown(e, h.id)}
          />
        ))}
    </div>
  );
}
