import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { WidgetCatalogEntry } from '../src/api';

const { listWidgets } = vi.hoisted(() => ({
  listWidgets: vi.fn<() => Promise<{ widgets: WidgetCatalogEntry[] }>>(),
}));
vi.mock('../src/api', () => ({ api: { listWidgets: () => listWidgets() } }));

import { WidgetsPanel } from '../src/views/widgets/WidgetsPanel';

const writeText = vi.fn<(t: string) => Promise<void>>().mockResolvedValue(undefined);

const widgets: WidgetCatalogEntry[] = [
  {
    name: 'hero-slider',
    label: 'Hero slider',
    description: 'Full-bleed background slideshow with Ken Burns.',
    component: 'carousel',
    datasets: [{ slug: 'hero', name: 'Hero' }],
  },
];

beforeEach(() => {
  listWidgets.mockReset();
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});

describe('WidgetsPanel gallery', () => {
  it('fetches the catalog and lists each widget with its description + editable-data note', async () => {
    listWidgets.mockResolvedValue({ widgets });
    render(<WidgetsPanel projectId="p" />);
    expect(await screen.findByText('Hero slider')).toBeInTheDocument();
    expect(screen.getByText(/Full-bleed background slideshow/)).toBeInTheDocument();
    expect(screen.getByText('Hero')).toBeInTheDocument(); // the provisioned dataset name
  });

  it('inserts the widget as {{> name}} via copy', async () => {
    listWidgets.mockResolvedValue({ widgets });
    render(<WidgetsPanel projectId="p" />);
    const insert = await screen.findByLabelText('Copy {{> hero-slider}}');
    fireEvent.click(insert);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('{{> hero-slider}}'));
  });

  it('shows a friendly message if the catalog fails to load', async () => {
    listWidgets.mockRejectedValue(new Error('boom'));
    render(<WidgetsPanel projectId="p" />);
    expect(await screen.findByText(/Couldn’t load the widget catalog/)).toBeInTheDocument();
  });

  it('shows a loading state until the catalog resolves', async () => {
    let resolve!: (v: { widgets: WidgetCatalogEntry[] }) => void;
    listWidgets.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<WidgetsPanel projectId="p" />);
    expect(screen.getByText(/Loading widgets/)).toBeInTheDocument();
    resolve({ widgets });
    expect(await screen.findByText('Hero slider')).toBeInTheDocument();
  });

  it('shows an empty state when no widgets are available', async () => {
    listWidgets.mockResolvedValue({ widgets: [] });
    render(<WidgetsPanel projectId="p" />);
    expect(await screen.findByText(/No widgets are available/)).toBeInTheDocument();
  });
});
