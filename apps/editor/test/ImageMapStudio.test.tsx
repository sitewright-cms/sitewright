// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { StrictMode, type ComponentProps } from 'react';
import type { ImageMap, ImageMapObject } from '@sitewright/schema';
import { ToastProvider } from '../src/views/ui/Toast';
import { ImageMapStudio } from '../src/views/library/imagemap/ImageMapStudio';
import { ObjectDetails } from '../src/views/library/imagemap/ObjectDetails';
import { TooltipBuilder } from '../src/views/library/imagemap/TooltipBuilder';
import { Canvas } from '../src/views/library/imagemap/Canvas';
import { api } from '../src/api';

// The Studio's own surface. The canvas positions everything in PERCENT inside an aspect-ratio box,
// which jsdom lays out as zero-sized — so these tests assert the authored markup and the state
// transitions, and the geometry/drag behaviour is covered by model tests plus a real-browser pass.

const MAP: ImageMap = {
  id: 'floor',
  general: { name: 'Ground floor' },
  artboards: [
    {
      id: 'a1',
      title: 'Ground',
      background_type: 'image',
      image_url: '/media/acme/a1-ground.jpg',
      // An artboard OWNS its size — the runtime never consults `general`. See RUNTIME_ARTBOARD_SIZE.
      width: 800,
      height: 600,
      children: [
        {
          id: 'o1',
          title: 'Reception',
          type: 'rect',
          x: 10,
          y: 20,
          width: 30,
          height: 25,
          default_style: { background_color: '#0a7a5a', background_opacity: 0.4 },
          tooltip: { enable_tooltip: true },
          tooltip_content: [],
          actions: { click: 'no-action' },
        },
      ],
    },
    { id: 'a2', title: 'First', background_type: 'color', image_url: '', width: 800, height: 600, children: [] },
  ],
};

const TEMPLATES = [
  { id: 'business', name: 'Business', summary: 'Charts as SVG regions.', artboards: 1, hotspots: 10, images: [] },
];

function studio() {
  return render(
    <ToastProvider>
      <ImageMapStudio onClose={() => {}} projectId="p1" />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'listImageMaps').mockResolvedValue({ items: [MAP] });
  vi.spyOn(api, 'listImageMapTemplates').mockResolvedValue({ templates: TEMPLATES });
});

describe('ImageMapStudio — the map list', () => {
  it('lists stored maps with their shape, and the bundled templates', async () => {
    studio();
    expect(await screen.findByText('Ground floor')).toBeTruthy();
    expect(screen.getByText(/2 artboards · 1 hotspot$/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Examples' })).toBeTruthy();
    expect(screen.getByText('Business')).toBeTruthy();
    expect(screen.getByText(/1 artboard · 10 hotspots/)).toBeTruthy();
  });

  it('offers the embed code for a page', async () => {
    studio();
    await screen.findByText('Ground floor');
    expect(screen.getByTitle('Copy the embed code for a page')).toBeTruthy();
  });

  it('materialises a template through the API rather than writing one client-side', async () => {
    const create = vi
      .spyOn(api, 'createImageMapFromTemplate')
      .mockResolvedValue({ item: { ...MAP, id: 'business-1' }, importedImages: 0 });
    studio();
    fireEvent.click(await screen.findByRole('button', { name: /Business/ }));
    // The server copies any images into the project's media library — the client never does.
    await waitFor(() => expect(create).toHaveBeenCalledWith('p1', { template: 'business' }));
  });

  it('asks before deleting, and says what breaks', async () => {
    const del = vi.spyOn(api, 'deleteImageMap').mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    studio();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(confirm.mock.calls[0]?.[0]).toMatch(/page embedding it will fail to render/);
    expect(del).not.toHaveBeenCalled();
  });

  it('says so when there is no project', () => {
    render(
      <ToastProvider>
        <ImageMapStudio onClose={() => {}} />
      </ToastProvider>,
    );
    expect(screen.getByText(/Open a project to build image maps/)).toBeTruthy();
  });
});

describe('ImageMapStudio — the editor', () => {
  async function openEditor() {
    studio();
    fireEvent.click(await screen.findByText('Ground floor'));
    await screen.findByText('Artboards');
    // A hotspot's title names both its rail entry and its canvas shape; the rail is the list.
    return { rail: within(screen.getByText('Hotspots').closest('div')!) };
  }

  it('shows the artboards and the hotspots of the selected one', async () => {
    const { rail } = await openEditor();
    expect(screen.getByRole('button', { name: 'Ground' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'First' })).toBeTruthy();
    expect(rail.getByRole('button', { name: 'Reception' })).toBeTruthy();
  });

  it('opens the details panel on selecting a hotspot, and renames it in place', async () => {
    const { rail } = await openEditor();
    fireEvent.click(rail.getByRole('button', { name: 'Reception' }));
    const title = screen.getByLabelText('Title') as HTMLInputElement;
    expect(title.value).toBe('Reception');
    fireEvent.change(title, { target: { value: 'Lobby' } });
    expect(rail.getByRole('button', { name: 'Lobby' })).toBeTruthy();
  });

  it('enables Save only once something changed', async () => {
    const { rail } = await openEditor();
    expect(screen.getByRole('button', { name: 'Saved' })).toBeTruthy();
    fireEvent.click(rail.getByRole('button', { name: 'Reception' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Lobby' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('saves the whole map through the content API', async () => {
    const put = vi.spyOn(api, 'putImageMap').mockResolvedValue({ item: MAP });
    const { rail } = await openEditor();
    fireEvent.click(rail.getByRole('button', { name: 'Reception' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Lobby' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const saved = put.mock.calls[0]![1];
    expect(saved.artboards[0]!.children![0]!.title).toBe('Lobby');
  });

  it('refuses to delete the last artboard', async () => {
    await openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Delete First' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Ground' }));
    // One artboard always remains — a map with none cannot render.
    expect(screen.getByRole('button', { name: 'Ground' })).toBeTruthy();
  });

  it('warns before leaving with unsaved changes', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { rail } = await openEditor();
    fireEvent.click(rail.getByRole('button', { name: 'Reception' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Lobby' } });
    fireEvent.click(screen.getByRole('button', { name: '← All maps' }));
    expect(confirm).toHaveBeenCalled();
    // Declined → still in the editor.
    expect(screen.getByText('Artboards')).toBeTruthy();
  });

  it('exposes the map settings, including the visitor controls', async () => {
    await openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Map settings' }));
    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(screen.getByLabelText(/Zoom and pan/)).toBeTruthy();
    expect(screen.getByLabelText(/Fullscreen button/)).toBeTruthy();
    expect(screen.getByLabelText('Background image')).toBeTruthy();
  });
});

describe('ObjectDetails', () => {
  const object = MAP.artboards[0]!.children![0]!;
  const details = (over: Partial<ImageMapObject> = {}, onChange = vi.fn()) => {
    render(
      <ObjectDetails map={MAP} object={{ ...object, ...over }} projectId="p1" onChange={onChange} onDelete={() => {}} />,
    );
    return onChange;
  };

  it('edits geometry in percent', () => {
    const onChange = details();
    fireEvent.change(screen.getByLabelText('X (%)'), { target: { value: '42.5' } });
    expect(onChange).toHaveBeenCalledWith({ x: 42.5 });
  });

  it('ignores a non-numeric geometry entry rather than writing NaN', () => {
    const onChange = details();
    fireEvent.change(screen.getByLabelText('Width (%)'), { target: { value: 'abc' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('writes fill + opacity into the right style bag', () => {
    const onChange = details();
    fireEvent.click(screen.getByRole('button', { name: 'Style' }));
    const rest = within(screen.getByRole('group', { name: 'At rest' }));
    fireEvent.change(rest.getByLabelText('Fill'), { target: { value: '#ff0000' } });
    expect(onChange).toHaveBeenCalledWith({ default_style: expect.objectContaining({ background_color: '#ff0000' }) });
  });

  it('offers only actions the runtime can perform — never a script', () => {
    details();
    fireEvent.click(screen.getByRole('button', { name: 'Action' }));
    const options = [...(screen.getByLabelText('On click') as HTMLSelectElement).options].map((o) => o.value);
    expect(options).toEqual(['no-action', 'follow-link', 'change-artboard']);
    expect(options).not.toContain('run-script');
  });

  it('lists the map’s artboards as switch targets', () => {
    details({ actions: { click: 'change-artboard' } });
    fireEvent.click(screen.getByRole('button', { name: 'Action' }));
    const options = [...(screen.getByLabelText('Go to') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toContain('Ground');
    expect(options).toContain('First');
  });

  it('says which link schemes are followed', () => {
    details({ actions: { click: 'follow-link' } });
    fireEvent.click(screen.getByRole('button', { name: 'Action' }));
    expect(screen.getByText(/Only http, https, mailto and tel/)).toBeTruthy();
  });
});

describe('TooltipBuilder', () => {
  it('adds, reorders and removes blocks', () => {
    const onChange = vi.fn();
    const { rerender } = render(<TooltipBuilder blocks={[]} projectId="p1" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Heading' }));
    expect(onChange.mock.calls[0]![0]).toEqual([expect.objectContaining({ type: 'Heading' })]);

    const two = [
      { type: 'Heading' as const, text: 'One', heading: 'h3' as const },
      { type: 'Paragraph' as const, text: 'Two' },
    ];
    rerender(<TooltipBuilder blocks={two} projectId="p1" onChange={onChange} />);
    fireEvent.click(screen.getAllByLabelText('Move down')[0]!);
    expect(onChange.mock.calls[1]![0].map((b: { type: string }) => b.type)).toEqual(['Paragraph', 'Heading']);

    fireEvent.click(screen.getAllByLabelText('Remove block')[0]!);
    expect(onChange.mock.calls[2]![0]).toHaveLength(1);
  });

  it('edits a block’s fields once expanded', () => {
    const onChange = vi.fn();
    render(<TooltipBuilder blocks={[{ type: 'Button', text: 'Go', url: '#' }]} projectId="p1" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Link'), { target: { value: '/contact' } });
    expect(onChange.mock.calls[0]![0][0]).toMatchObject({ url: '/contact' });
  });

  it('says the embed is sanitised server-side rather than pretending the client is the boundary', () => {
    render(<TooltipBuilder blocks={[{ type: 'YouTube', embedCode: '' }]} projectId="p1" onChange={() => {}} />);
    expect(screen.getByText(/Only https embeds survive, and they are sandboxed/)).toBeTruthy();
  });
});

describe('Canvas', () => {
  const CANVAS_W = 800;
  const CANVAS_H = 600;

  type CanvasProps = ComponentProps<typeof Canvas>;

  /**
   * Render the canvas with a MEASURABLE artboard.
   *
   * jsdom lays every element out at zero size, and the canvas turns pointer coordinates into
   * percentages by dividing by the artboard's measured box — so without a stubbed rect every click
   * lands at (0, 0) and every drawing test passes for the wrong reason.
   */
  function canvas(props: Partial<CanvasProps> = {}) {
    const merged: CanvasProps = {
      artboard: MAP.artboards[0]!,
      selectedId: null,
      onSelect: () => {},
      onChange: () => {},
      drawing: null,
      onDraw: () => {},
      onPickImage: () => {},
      onDropImage: () => {},
      ...props,
    };
    // Rendered under StrictMode, exactly as the app runs it: it double-invokes render and state
    // updaters, which is what turns "commit the shape from inside a setState updater" into two
    // hotspots per gesture. Without this the tests pass and the editor still misbehaves.
    const utils = render(
      <StrictMode>
        <Canvas {...merged} />
      </StrictMode>,
    );
    const box = screen.getByTestId('imap-artboard');
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: CANVAS_W, bottom: CANVAS_H, width: CANVAS_W, height: CANVAS_H, toJSON: () => ({}),
    } as DOMRect);
    return { ...utils, box };
  }

  /** A percentage position as the client coordinate that produces it. */
  const at = (xPct: number, yPct: number) => ({ clientX: (xPct / 100) * CANVAS_W, clientY: (yPct / 100) * CANVAS_H });

  /**
   * Dispatch a pointer event.
   *
   * jsdom implements no PointerEvent, and fireEvent.pointerDown silently drops clientX/clientY when
   * it can't construct one — which lands every click at NaN and makes a drawing test assert nothing.
   * A MouseEvent of the same type carries the coordinates, and React reads them off the native event
   * exactly the same way.
   */
  function pointer(el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', init: MouseEventInit = {}) {
    // Handed to fireEvent rather than dispatched directly, so the resulting state update is wrapped
    // in act() and has flushed by the time the assertion reads the DOM.
    fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  }

  it('renders one element per hotspot and skips group containers', () => {
    canvas({
      artboard: {
        ...MAP.artboards[0]!,
        children: [
          ...MAP.artboards[0]!.children!,
          { id: 'g', title: 'Group', type: 'group' as const, children: [{ id: 'gc', title: 'Inside', type: 'oval' as const, x: 5, y: 5, width: 5, height: 5 }] },
        ],
      },
    });
    // The group itself is a container, not a drawn shape; its child is drawn.
    expect(screen.getByRole('button', { name: 'Reception' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Inside' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Group' })).toBeNull();
  });

  it('shows resize handles only for the selection', () => {
    canvas();
    expect(screen.queryByLabelText('Resize nw')).toBeNull();
    cleanup();
    canvas({ selectedId: 'o1' });
    expect(screen.getAllByLabelText(/^Resize /)).toHaveLength(8);
  });

  it('zooms the canvas without touching the map', () => {
    canvas();
    expect(screen.getByText('100%')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(screen.getByText('125%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('reports the ARTBOARD’s own pixel size, which is the only size the runtime reads', () => {
    canvas();
    expect(screen.getByText('800 × 600')).toBeTruthy();
  });

  it('falls back to the runtime’s artboard default, not to a size of its own invention', () => {
    // ★ THE REGRESSION THIS GUARDS. The runtime deep-extends artboards against artboardDefaults and
    // reads artboard.width/height with no fallback — `general` has no dimensions at all. A canvas
    // that previewed `general` drew a different aspect ratio from the published page, so every
    // hotspot an author placed landed somewhere else for the visitor.
    canvas({ artboard: { id: 'bare', title: 'Bare', background_type: 'color', image_url: '', children: [] } });
    expect(screen.getByText('848 × 480')).toBeTruthy();
  });

  describe('tracing a polygon', () => {
    // ★ THE CORE WORKFLOW: import a photo, then trace the outline of something in it. Clicking the
    // tool used to drop a fixed triangle, which is useless for following a real contour.
    const outline = [
      [20, 30],
      [60, 25],
      [70, 70],
      [25, 65],
    ] as const;

    function trace(box: Element, points: ReadonlyArray<readonly [number, number]> = outline) {
      for (const [x, y] of points) pointer(box, 'pointerdown', at(x, y));
    }

    it('places a vertex per click and closes into a polygon on Enter', () => {
      const onDraw = vi.fn();
      const { box } = canvas({ drawing: 'poly', onDraw });
      trace(box);
      expect(screen.getAllByTestId('imap-trace-point')).toHaveLength(4);
      expect(onDraw).not.toHaveBeenCalled(); // nothing exists until the author closes it

      fireEvent.keyDown(window, { key: 'Enter' });
      expect(onDraw).toHaveBeenCalledTimes(1);
      const [type, spec] = onDraw.mock.calls[0]!;
      expect(type).toBe('poly');
      expect(spec.kind).toBe('poly');
      expect(spec.points).toEqual([
        { x: 20, y: 30 },
        { x: 60, y: 25 },
        { x: 70, y: 70 },
        { x: 25, y: 65 },
      ]);
    });

    it('closes when the author clicks back on the first point', () => {
      const onDraw = vi.fn();
      const { box } = canvas({ drawing: 'poly', onDraw });
      trace(box);
      pointer(box, 'pointerdown', at(20, 30)); // back to the start
      expect(onDraw).toHaveBeenCalledTimes(1);
      expect(onDraw.mock.calls[0]![1].points).toHaveLength(4); // the closing click is not a 5th vertex
      expect(screen.queryAllByTestId('imap-trace-point')).toHaveLength(0);
    });

    it('closes on a double-click without leaving a doubled vertex', () => {
      const onDraw = vi.fn();
      const { box } = canvas({ drawing: 'poly', onDraw });
      trace(box);
      // A double-click places a vertex on top of the last one before it ends the trace.
      pointer(box, 'pointerdown', at(25, 65));
      fireEvent.doubleClick(box);
      expect(onDraw.mock.calls[0]![1].points).toHaveLength(4);
    });

    it('takes back the last point on Backspace and abandons the trace on Escape', () => {
      const onDraw = vi.fn();
      const { box } = canvas({ drawing: 'poly', onDraw });
      trace(box);
      fireEvent.keyDown(window, { key: 'Backspace' });
      expect(screen.getAllByTestId('imap-trace-point')).toHaveLength(3);

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryAllByTestId('imap-trace-point')).toHaveLength(0);
      expect(onDraw).not.toHaveBeenCalled();
    });

    it('refuses to close a shape with fewer than three points', () => {
      const onDraw = vi.fn();
      const { box } = canvas({ drawing: 'poly', onDraw });
      trace(box, [
        [10, 10],
        [40, 40],
      ]);
      fireEvent.keyDown(window, { key: 'Enter' });
      expect(onDraw).not.toHaveBeenCalled();
    });

    it('abandons a half-drawn trace when the author puts the tool down', () => {
      const { box, rerender } = canvas({ drawing: 'poly' });
      trace(box, [[10, 10], [40, 40]]);
      expect(screen.getAllByTestId('imap-trace-point')).toHaveLength(2);
      rerender(
        <StrictMode>
          <Canvas
            artboard={MAP.artboards[0]!}
            selectedId={null}
            onSelect={() => {}}
            onChange={() => {}}
            drawing={null}
            onDraw={() => {}}
            onPickImage={() => {}}
            onDropImage={() => {}}
          />
        </StrictMode>,
      );
      expect(screen.queryAllByTestId('imap-trace-point')).toHaveLength(0);
    });
  });

  describe('editing a polygon’s points', () => {
    const POLY = {
      ...MAP.artboards[0]!,
      children: [
        {
          id: 'p1',
          title: 'Region',
          type: 'poly' as const,
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 50, y: 100 },
          ],
        },
      ],
    };

    it('exposes a vertex handle per point when selected', () => {
      canvas({ artboard: POLY, selectedId: 'p1' });
      expect(screen.getAllByLabelText(/^Point /)).toHaveLength(3);
    });

    it('offers a midpoint handle per edge, and inserting one adds a point', () => {
      const onChange = vi.fn();
      canvas({ artboard: POLY, selectedId: 'p1', onChange });
      const midpoints = screen.getAllByLabelText(/^Add a point on edge /);
      expect(midpoints).toHaveLength(3); // including the closing edge back to the first point

      pointer(midpoints[0]!, 'pointerdown', at(0, 0));
      expect(onChange).toHaveBeenCalledWith('p1', {
        points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }],
      });
    });

    it('removes a point on alt-click', () => {
      const onChange = vi.fn();
      const four = {
        ...POLY,
        children: [{ ...POLY.children[0]!, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }],
      };
      canvas({ artboard: four, selectedId: 'p1', onChange });
      pointer(screen.getAllByLabelText(/^Point /)[1]!, 'pointerdown', { altKey: true });
      expect(onChange).toHaveBeenCalledWith('p1', { points: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] });
    });

    it('will not alt-click a triangle down into a line', () => {
      const onChange = vi.fn();
      canvas({ artboard: POLY, selectedId: 'p1', onChange });
      pointer(screen.getAllByLabelText(/^Point /)[0]!, 'pointerdown', { altKey: true });
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('drawing a box', () => {
    it('sizes the shape from the drag', () => {
      const onDraw = vi.fn();
      const { box } = canvas({ drawing: 'rect', onDraw });
      pointer(box, 'pointerdown', at(10, 10));
      pointer(box, 'pointermove', at(40, 50));
      pointer(box, 'pointerup', at(40, 50));
      expect(onDraw).toHaveBeenCalledWith('rect', { kind: 'bounds', bounds: { x: 10, y: 10, width: 30, height: 40 } });
    });

    it('drops a default-sized shape when it was only a click', () => {
      const onDraw = vi.fn();
      const { box } = canvas({ drawing: 'rect', onDraw });
      pointer(box, 'pointerdown', at(10, 10));
      pointer(box, 'pointerup', at(10, 10));
      expect(onDraw).toHaveBeenCalledWith('rect', { kind: 'point', x: 10, y: 10 });
    });

    it('places a pin at the press however far the pointer then travels', () => {
      // A pin has no size to drag out — the runtime draws it at its icon size, so sizing one from a
      // drag would produce a giant marker the author never asked for.
      const onDraw = vi.fn();
      const { box } = canvas({ drawing: 'spot', onDraw });
      pointer(box, 'pointerdown', at(30, 40));
      pointer(box, 'pointermove', at(80, 90));
      pointer(box, 'pointerup', at(80, 90));
      expect(onDraw).toHaveBeenCalledWith('spot', { kind: 'point', x: 30, y: 40 });
    });
  });

  describe('getting the image in', () => {
    const BARE = { id: 'bare', title: 'Bare', background_type: 'color' as const, image_url: '', width: 800, height: 600, children: [] };

    it('asks for an image on an empty artboard, rather than showing a blank grey box', () => {
      const onPickImage = vi.fn();
      canvas({ artboard: BARE, onPickImage });
      expect(screen.getByText(/Start with the image you want to make interactive/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Choose an image' }));
      expect(onPickImage).toHaveBeenCalled();
    });

    it('keeps the image button in the toolbar once one is set', () => {
      const onPickImage = vi.fn();
      canvas({ onPickImage });
      expect(screen.queryByText(/Start with the image/)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Replace image' }));
      expect(onPickImage).toHaveBeenCalled();
    });

    it('takes an image file dropped straight onto the canvas', () => {
      const onDropImage = vi.fn();
      const { box } = canvas({ artboard: BARE, onDropImage });
      const file = new File(['x'], 'plan.png', { type: 'image/png' });
      fireEvent.drop(box.parentElement!.parentElement!, { dataTransfer: { files: [file] } });
      expect(onDropImage).toHaveBeenCalledWith(file);
    });

    it('ignores a dropped file that is not an image', () => {
      const onDropImage = vi.fn();
      const { box } = canvas({ artboard: BARE, onDropImage });
      const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
      fireEvent.drop(box.parentElement!.parentElement!, { dataTransfer: { files: [file] } });
      expect(onDropImage).not.toHaveBeenCalled();
    });
  });
});
