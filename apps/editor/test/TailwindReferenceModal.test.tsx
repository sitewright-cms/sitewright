import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import type { TailwindReference } from '@sitewright/tailwind-reference/meta';
import { TailwindReferenceModal } from '../src/views/library/TailwindReferenceModal';
import { resetTailwindReferenceCache } from '../src/views/library/tailwind-reference-data';
import { registerCodeInsertSink, resetCodeInsertSink } from '../src/lib/code-insert-sink';

const REFERENCE: TailwindReference = {
  tailwindVersion: '4.3.3',
  classCount: 6,
  topics: [
    {
      id: 'display',
      sig: 'display',
      props: ['display'],
      category: 'layout',
      title: 'Display',
      description: 'Sets the box type an element generates.',
      preview: 'none',
      classes: [
        ['flex', [['display', 'flex']], 0],
        ['grid', [['display', 'grid']], 0],
      ],
    },
    {
      id: 'font-size-line-height',
      sig: 'font-size,line-height',
      props: ['font-size', 'line-height'],
      category: 'typography',
      title: 'Font Size',
      description: 'Sets the type size.',
      preview: 'text',
      classes: [
        ['text-xs', [['font-size', 'var(--text-xs)', '0.75rem'], ['line-height', 'var(--text-xs--line-height)', '1rem']], 1],
        ['text-sm', [['font-size', 'var(--text-sm)', '0.875rem'], ['line-height', 'var(--text-sm--line-height)', '1.25rem']], 1],
        ['text-base', [['font-size', 'var(--text-base)', '1rem'], ['line-height', 'var(--text-base--line-height)', '1.5rem']], 1],
      ],
    },
    {
      id: 'color',
      sig: 'color',
      props: ['color'],
      category: 'typography',
      title: 'Text Color',
      description: 'Sets the text colour.',
      preview: 'color',
      classes: [['text-red-500', [['color', 'oklch(63.7% 0.237 25.331)']], 0]],
    },
  ],
  variants: [],
};

beforeEach(() => {
  resetTailwindReferenceCache();
  resetCodeInsertSink();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => REFERENCE }));
  // jsdom has no layout, so scrollIntoView is absent on the prototype.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetTailwindReferenceCache();
  resetCodeInsertSink();
});

/** Render the modal and wait for the reference fetch to settle. */
async function open() {
  render(<TailwindReferenceModal onClose={() => {}} />);
  return screen.findByRole('dialog', { name: 'TailwindCSS Reference' });
}

describe('TailwindReferenceModal', () => {
  it('fetches the reference and lists the categories it contains', async () => {
    const dialog = await open();
    expect(global.fetch).toHaveBeenCalledWith('/authoring/tailwind/reference');
    expect(await within(dialog).findByRole('button', { name: 'Layout' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Typography' })).toBeInTheDocument();
  });

  it('shows a category’s topics with their prose and CSS properties', async () => {
    const dialog = await open();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Typography' }));
    expect(within(dialog).getByRole('heading', { name: 'Font Size' })).toBeInTheDocument();
    expect(within(dialog).getByText('Sets the type size.')).toBeInTheDocument();
    expect(within(dialog).getByText('font-size · line-height')).toBeInTheDocument();
  });

  it('searching a CSS property in words opens that topic — the "font size" case', async () => {
    const dialog = await open();
    fireEvent.change(await within(dialog).findByRole('searchbox'), { target: { value: 'font size' } });
    await waitFor(() => expect(within(dialog).getByRole('heading', { name: 'Font Size' })).toBeInTheDocument());
    // …and only that topic — the query resolved unambiguously.
    expect(within(dialog).queryByRole('heading', { name: 'Text Color' })).toBeNull();
  });

  it('searching an exact class opens its topic with that row highlighted', async () => {
    const dialog = await open();
    fireEvent.change(await within(dialog).findByRole('searchbox'), { target: { value: 'text-sm' } });
    await waitFor(() => expect(within(dialog).getByRole('heading', { name: 'Font Size' })).toBeInTheDocument());
    // Every font-size utility is listed…
    for (const name of ['text-xs', 'text-sm', 'text-base']) {
      expect(dialog.querySelector(`[data-class-name="${name}"]`)).toBeTruthy();
    }
    // …and `text-sm` is the one picked out, with the sibling rows left plain.
    const row = dialog.querySelector('[data-class-name="text-sm"]');
    expect(row?.className).toMatch(/ring-indigo-300/);
    expect(dialog.querySelector('[data-class-name="text-xs"]')?.className).not.toMatch(/ring-indigo-300/);
  });

  it('shows the generated CSS for each class, at its resolved value', async () => {
    const dialog = await open();
    fireEvent.change(await within(dialog).findByRole('searchbox'), { target: { value: 'text-sm' } });
    await waitFor(() => expect(within(dialog).getByRole('heading', { name: 'Font Size' })).toBeInTheDocument());
    // The row reads `font-size: 0.875rem`, not `font-size: var(--text-sm)`.
    expect(within(dialog).getByText(/font-size: 0\.875rem; line-height: 1\.25rem/)).toBeInTheDocument();
  });

  it('lists topics AND classes as clickable results for an ambiguous query', async () => {
    const dialog = await open();
    fireEvent.change(await within(dialog).findByRole('searchbox'), { target: { value: 'text' } });
    await waitFor(() => expect(within(dialog).getByText(/^Topics \(/)).toBeInTheDocument());
    expect(within(dialog).getByText(/^Classes \(/)).toBeInTheDocument();
    // Clicking a class result navigates to its topic with the row highlighted.
    fireEvent.click(within(dialog).getByRole('button', { name: /text-red-500\s+Text Color/ }));
    await waitFor(() => expect(within(dialog).getByRole('heading', { name: 'Text Color' })).toBeInTheDocument());
  });

  it('a clicked search result STAYS on that topic, with its row highlighted', async () => {
    // ★ Regression guard. Clicking a result clears the search box, and an effect keyed on `query`
    // read that as "the user cleared it" and wiped the focus the click had just set — one tick later
    // the view fell back to the whole category and the highlight was gone. Asserting only that the
    // heading is present does NOT catch it (it stays present in the fallback), so this pins the two
    // things that actually change: the sibling topic must be absent, and the ring must be on.
    const dialog = await open();
    fireEvent.change(await within(dialog).findByRole('searchbox'), { target: { value: 'text' } });
    await waitFor(() => expect(within(dialog).getByText(/^Classes \(/)).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole('button', { name: /text-red-500\s+Text Color/ }));

    await waitFor(() => expect(within(dialog).getByRole('heading', { name: 'Text Color' })).toBeInTheDocument());
    // The sibling topic in the SAME category must not come back.
    expect(within(dialog).queryByRole('heading', { name: 'Font Size' })).toBeNull();
    // …and the clicked row keeps its highlight.
    expect(dialog.querySelector('[data-class-name="text-red-500"]')?.className).toMatch(/ring-indigo-300/);
  });

  it('a clicked TOPIC result stays put too', async () => {
    const dialog = await open();
    fireEvent.change(await within(dialog).findByRole('searchbox'), { target: { value: 'sets' } });
    await waitFor(() => expect(within(dialog).getByText(/^Topics \(/)).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole('button', { name: /Font Size\s+Typography/ }));

    await waitFor(() => expect(within(dialog).getByRole('heading', { name: 'Font Size' })).toBeInTheDocument());
    expect(within(dialog).queryByRole('heading', { name: 'Text Color' })).toBeNull();
  });

  it('clearing the search returns to the pinned topic, not to nothing', async () => {
    const dialog = await open();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Layout' }));
    expect(within(dialog).getByRole('heading', { name: 'Display' })).toBeInTheDocument();
    // Type, then clear — the category the user was browsing must come back.
    const search = within(dialog).getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'font size' } });
    await waitFor(() => expect(within(dialog).getByRole('heading', { name: 'Font Size' })).toBeInTheDocument());
    fireEvent.change(search, { target: { value: '' } });
    await waitFor(() => expect(within(dialog).getByRole('heading', { name: 'Display' })).toBeInTheDocument());
  });

  it('copies the class name when the row is clicked', async () => {
    const dialog = await open();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Layout' }));
    fireEvent.click(within(dialog).getByTitle('Copy flex'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('flex'));
  });

  it('disables Insert at cursor while no code editor is open', async () => {
    const dialog = await open();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Layout' }));
    expect(within(dialog).getByRole('button', { name: 'Insert flex at cursor' })).toBeDisabled();
  });

  it('inserts at the cursor when a code editor is open', async () => {
    const insert = vi.fn();
    registerCodeInsertSink(insert);
    const dialog = await open();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Layout' }));
    const button = within(dialog).getByRole('button', { name: 'Insert flex at cursor' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(insert).toHaveBeenCalledWith('flex');
  });

  it('reports the Tailwind version and utility count it is documenting', async () => {
    const dialog = await open();
    expect(await within(dialog).findByText(/Tailwind CSS 4\.3\.3 · 6 utilities/)).toBeInTheDocument();
  });

  it('surfaces a load failure instead of an empty reference', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const dialog = await open();
    expect(await within(dialog).findByText(/Couldn’t load the Tailwind reference/)).toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    const dialog = await open();
    fireEvent.change(await within(dialog).findByRole('searchbox'), { target: { value: 'zzzznope' } });
    expect(await within(dialog).findByText('No matches.')).toBeInTheDocument();
  });
});
