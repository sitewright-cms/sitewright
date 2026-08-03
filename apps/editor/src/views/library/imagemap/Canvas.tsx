import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImageMap, ImageMapArtboard, ImageMapObject } from '@sitewright/schema';
import { artboardSize, artboardToPolyPoint, clampPct, objectBounds, polyPointToArtboard, round, type DrawableType } from './model';

/**
 * The Studio canvas: the artboard background with every hotspot drawn over it, selectable, draggable
 * and resizable.
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

interface CanvasProps {
  map: ImageMap;
  artboard: ImageMapArtboard;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Commit a geometry change. Called on every pointer move, so the parent should keep it cheap. */
  onChange: (id: string, patch: Partial<ImageMapObject>) => void;
  /** The tool in hand: null = select/move, otherwise the next click draws this shape. */
  drawing: DrawableType | null;
  onDraw: (type: DrawableType, xPct: number, yPct: number) => void;
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

export function Canvas({ map, artboard, selectedId, onSelect, onChange, drawing, onDraw }: CanvasProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  // A drag in flight. Held in a ref, not state: it changes on every pointer move and must not
  // re-render on its own — the object's own coordinates already do that.
  const dragRef = useRef<{
    id: string;
    handle: Handle | 'move' | number; // a number = the index of a polygon vertex
    startX: number;
    startY: number;
    origin: ImageMapObject;
  } | null>(null);

  const { width: aw, height: ah } = artboardSize(map, artboard);
  const ratio = ah / Math.max(1, aw);

  /** Pointer position as a percentage of the artboard box. */
  const pctFromEvent = useCallback((e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 };
    return { x: ((e.clientX - box.left) / box.width) * 100, y: ((e.clientY - box.top) / box.height) * 100 };
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

  function beginDrag(e: React.PointerEvent, obj: ImageMapObject, handle: Handle | 'move' | number): void {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const start = pctFromEvent(e);
    dragRef.current = { id: obj.id, handle, startX: start.x, startY: start.y, origin: obj };
    onSelect(obj.id);
  }

  function onPointerMove(e: React.PointerEvent): void {
    const drag = dragRef.current;
    if (!drag) return;
    const at = pctFromEvent(e);
    const dx = at.x - drag.startX;
    const dy = at.y - drag.startY;
    const o = drag.origin;

    // A polygon vertex. `points` are box-relative, so the pointer's artboard position is converted
    // back into that space rather than nudged directly.
    if (typeof drag.handle === 'number') {
      const points = (o.points ?? []).map((p, i) => (i === drag.handle ? artboardToPolyPoint(o, at) : p));
      onChange(drag.id, { points });
      return;
    }

    if (drag.handle === 'move') {
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
    const h = drag.handle;
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

  function endDrag(e: React.PointerEvent): void {
    if (!dragRef.current) return;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  }

  // Delete / nudge the selection. Bound to the window so it works wherever focus sits inside the
  // Studio, but ignored while typing in a field.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
      const step = e.shiftKey ? 1 : 0.2;
      const obj = objects.find((o) => o.id === selectedId);
      if (!obj) return;
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
  }, [selectedId, objects, onChange, onSelect]);

  const background =
    artboard.background_type === 'image' && artboard.image_url
      ? { backgroundImage: `url(${JSON.stringify(artboard.image_url)})`, backgroundSize: '100% 100%' }
      : { background: artboard.background_color ?? '#f1f5f9' };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-1.5 text-xs dark:border-slate-700">
        <span className="text-slate-500 dark:text-slate-400">
          {aw} × {ah}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" className="rounded px-2 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>
            −
          </button>
          <span className="w-12 text-center tabular-nums text-slate-500 dark:text-slate-400">{Math.round(zoom * 100)}%</span>
          <button type="button" className="rounded px-2 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>
            +
          </button>
          <button type="button" className="rounded px-2 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setZoom(1)}>
            Fit
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-6 dark:bg-slate-900">
        <div className="mx-auto" style={{ width: `${zoom * 100}%`, maxWidth: zoom <= 1 ? '100%' : 'none' }}>
          <div
            ref={boxRef}
            className="relative select-none shadow-sm ring-1 ring-slate-300 dark:ring-slate-700"
            style={{ ...background, paddingTop: `${ratio * 100}%`, cursor: drawing ? 'crosshair' : 'default' }}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerDown={(e) => {
              if (drawing) {
                const at = pctFromEvent(e);
                onDraw(drawing, at.x, at.y);
                return;
              }
              // A click on the background clears the selection.
              if (e.target === e.currentTarget) onSelect(null);
            }}
          >
            {objects.map((obj) => (
              <Shape
                key={obj.id}
                obj={obj}
                selected={obj.id === selectedId}
                inert={drawing !== null}
                onPointerDown={(e, handle) => beginDrag(e, obj, handle)}
              />
            ))}
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
  onPointerDown,
}: {
  obj: ImageMapObject;
  selected: boolean;
  /** A draw tool is active: the shape stays visible but lets the pointer through to the canvas. */
  inert: boolean;
  onPointerDown: (e: React.PointerEvent, handle: Handle | 'move' | number) => void;
}) {
  const b = objectBounds(obj);
  const ring = selected ? 'outline outline-2 outline-offset-1 outline-sky-500' : '';
  const inertStyle: React.CSSProperties = inert ? { pointerEvents: 'none' } : {};

  if (obj.type === 'poly') {
    // Stored vertices are box-relative; the canvas draws in artboard space.
    const pts = (obj.points ?? []).map((p) => polyPointToArtboard(obj, p));
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
        {selected && (
          <>
            {pts.map((p, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Point ${i + 1}`}
                className="absolute z-20 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border border-white bg-sky-500 shadow"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                onPointerDown={(e) => onPointerDown(e, i)}
              />
            ))}
            {/* The box handles resize the whole polygon — its relative points ride along. */}
            <div className="pointer-events-none absolute" style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.width}%`, height: `${b.height}%`, ...inertStyle }}>
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
