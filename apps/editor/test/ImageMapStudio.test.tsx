// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
  general: { name: 'Ground floor', width: 800, height: 600 },
  artboards: [
    {
      id: 'a1',
      title: 'Ground',
      background_type: 'image',
      image_url: '/media/acme/a1-ground.jpg',
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
    { id: 'a2', title: 'First', background_type: 'color', image_url: '', children: [] },
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
    expect(screen.getByRole('heading', { name: 'Start from a template' })).toBeTruthy();
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
  it('renders one element per hotspot and skips group containers', () => {
    const withGroup = {
      ...MAP.artboards[0]!,
      children: [
        ...MAP.artboards[0]!.children!,
        { id: 'g', title: 'Group', type: 'group' as const, children: [{ id: 'gc', title: 'Inside', type: 'oval' as const, x: 5, y: 5, width: 5, height: 5 }] },
      ],
    };
    render(
      <Canvas map={MAP} artboard={withGroup} selectedId={null} onSelect={() => {}} onChange={() => {}} drawing={null} onDraw={() => {}} />,
    );
    // The group itself is a container, not a drawn shape; its child is drawn.
    expect(screen.getByRole('button', { name: 'Reception' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Inside' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Group' })).toBeNull();
  });

  it('shows resize handles only for the selection', () => {
    const { rerender } = render(
      <Canvas map={MAP} artboard={MAP.artboards[0]!} selectedId={null} onSelect={() => {}} onChange={() => {}} drawing={null} onDraw={() => {}} />,
    );
    expect(screen.queryByLabelText('Resize nw')).toBeNull();
    rerender(
      <Canvas map={MAP} artboard={MAP.artboards[0]!} selectedId="o1" onSelect={() => {}} onChange={() => {}} drawing={null} onDraw={() => {}} />,
    );
    expect(screen.getAllByLabelText(/^Resize /)).toHaveLength(8);
  });

  it('exposes a vertex handle per polygon point when selected', () => {
    const poly = {
      ...MAP.artboards[0]!,
      children: [
        { id: 'p1', title: 'Region', type: 'poly' as const, x: 10, y: 10, width: 20, height: 20, points: [
          { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 },
        ] },
      ],
    };
    render(
      <Canvas map={MAP} artboard={poly} selectedId="p1" onSelect={() => {}} onChange={() => {}} drawing={null} onDraw={() => {}} />,
    );
    expect(screen.getAllByLabelText(/^Point /)).toHaveLength(3);
  });

  it('zooms the canvas without touching the map', () => {
    render(
      <Canvas map={MAP} artboard={MAP.artboards[0]!} selectedId={null} onSelect={() => {}} onChange={() => {}} drawing={null} onDraw={() => {}} />,
    );
    expect(screen.getByText('100%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(screen.getByText('125%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('reports the artboard’s own pixel size', () => {
    render(
      <Canvas map={MAP} artboard={MAP.artboards[0]!} selectedId={null} onSelect={() => {}} onChange={() => {}} drawing={null} onDraw={() => {}} />,
    );
    expect(screen.getByText('800 × 600')).toBeTruthy();
  });
});
