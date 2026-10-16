import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Dataset, Entry } from '@sitewright/schema';

const { putEntry, listPages, getSettings } = vi.hoisted(() => ({
  putEntry: vi.fn<(pid: string, e: Entry, baseVersion?: string) => Promise<unknown>>(),
  listPages: vi.fn<(pid: string) => Promise<unknown>>(),
  getSettings: vi.fn<(pid: string) => Promise<unknown>>(),
}));
vi.mock('../src/api', () => ({
  api: {
    putEntry: (pid: string, e: Entry, v?: string) => putEntry(pid, e, v),
    listPages: (pid: string) => listPages(pid),
    getSettings: (pid: string) => getSettings(pid),
  },
}));

// Swap CodeMirror for a plain textarea so a json field can hold half-typed text in jsdom.
vi.mock('../src/lib/code-editor', () => ({
  CodeEditor: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel?: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { EntryEditorModal } from '../src/views/datasets/EntryEditorModal';

/**
 * A dataset entry on a multilingual site. Its other languages store only the fields that DIFFER — the
 * rest follow the main language, so a price or a photo is entered once. "Translate to …" starts a
 * version with every field showing the main language's content to edit.
 */
const dataset: Dataset = {
  id: 'services',
  name: 'Services',
  slug: 'services',
  fields: [
    { name: 'title', type: 'text', required: false, localized: false },
    { name: 'price', type: 'number', required: false, localized: false },
  ],
};
const entry: Entry = { id: 'web', dataset: 'services', status: 'published', values: { title: 'Web design', price: 900 } };

const settings = (locales: string[]) => ({ item: { identity: {}, settings: { defaultLocale: 'en', locales } } });
const open = (e: Entry = entry) => render(<EntryEditorModal projectId="p" dataset={dataset} entry={e} onSaved={() => {}} onClose={() => {}} />);
const saved = () => putEntry.mock.calls.at(-1)![1];
const tab = (name: RegExp) => screen.getByRole('tab', { name });

beforeEach(() => {
  putEntry.mockReset();
  putEntry.mockResolvedValue({ item: {}, version: 'v2' });
  listPages.mockReset();
  listPages.mockResolvedValue({ items: [] });
  getSettings.mockReset();
  getSettings.mockResolvedValue(settings(['en', 'de']));
});

describe('EntryEditorModal — the entry in the site’s other languages', () => {
  it('shows no language switch on a site with one language', async () => {
    getSettings.mockResolvedValue(settings(['en']));
    open();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(screen.queryByRole('tablist', { name: 'Entry language' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('title')).toHaveValue('Web design');
  });

  it('★ "Translate to German" starts from the main content, and saving stores only what was changed', async () => {
    open();
    fireEvent.click(await screen.findByRole('tab', { name: /German/ }));
    expect(screen.getByText(/No German version yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Translate to German' }));

    // Every field shows the English content to edit…
    expect(screen.getByLabelText('title (German)')).toHaveValue('Web design');
    expect(screen.getByLabelText('price (German)')).toHaveValue(900);
    fireEvent.change(screen.getByLabelText('title (German)'), { target: { value: 'Webdesign' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putEntry).toHaveBeenCalled());
    // …but only the title is the German version's own: the price keeps following English.
    expect(saved().translations).toEqual({ de: { title: 'Webdesign' } });
    expect(saved().values).toEqual({ title: 'Web design', price: 900 });
  });

  it('a version with nothing changed is still saved — reviewed, needs nothing', async () => {
    open();
    fireEvent.click(await screen.findByRole('tab', { name: /German/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Translate to German' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putEntry).toHaveBeenCalled());
    expect(saved().translations).toEqual({ de: {} });
  });

  it('marks a field the language changed, and resets it to follow the main language again', async () => {
    open({ ...entry, translations: { de: { title: 'Webdesign', price: 950 } } });
    fireEvent.click(await screen.findByRole('tab', { name: /German/ }));
    expect(screen.getByLabelText('title (German)')).toHaveValue('Webdesign');

    fireEvent.click(screen.getByRole('button', { name: 'Reset price to English' }));
    expect(screen.getByLabelText('price (German)')).toHaveValue(900);
    expect(screen.getAllByText('same as English')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putEntry).toHaveBeenCalled());
    expect(saved().translations).toEqual({ de: { title: 'Webdesign' } });
  });

  it('★ a main-language change reaches a field the language left alone', async () => {
    open({ ...entry, translations: { de: { title: 'Webdesign' } } });
    fireEvent.change(await screen.findByLabelText('price'), { target: { value: '990' } });
    fireEvent.click(tab(/German/));
    expect(screen.getByLabelText('price (German)')).toHaveValue(990);
    expect(screen.getByLabelText('title (German)')).toHaveValue('Webdesign');
  });

  it('removing a language’s version saves the entry without it, after asking', async () => {
    open({ ...entry, translations: { de: { title: 'Webdesign' } } });
    fireEvent.click(await screen.findByRole('tab', { name: /German/ }));
    fireEvent.click(screen.getByRole('button', { name: /Remove German version/ }));
    const dialog = await screen.findByRole('dialog', { name: /Remove German version/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.getByText(/No German version yet/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putEntry).toHaveBeenCalled());
    expect(saved()).not.toHaveProperty('translations');
  });

  it('half-typed JSON in another tab still blocks Save — and is still there on the way back', async () => {
    const withJson: Dataset = { ...dataset, fields: [...dataset.fields, { name: 'meta', type: 'json', required: false, localized: false }] };
    render(<EntryEditorModal projectId="p" dataset={withJson} entry={{ ...entry, values: { ...entry.values, meta: {} } }} onSaved={() => {}} onClose={() => {}} />);
    await screen.findByRole('tab', { name: /German/ });
    const box = () => screen.getAllByRole('textbox').find((t) => (t as HTMLTextAreaElement).value.startsWith('{'))!;
    fireEvent.change(box(), { target: { value: '{"a":' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(tab(/German/));
    // Out of sight is not out of mind: saving from here would store the broken JSON.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(tab(/English/));
    expect(box()).toHaveValue('{"a":');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('switching tabs back and forth is not an edit', async () => {
    open({ ...entry, translations: { de: { title: 'Webdesign' } } });
    fireEvent.click(await screen.findByRole('tab', { name: /German/ }));
    fireEvent.click(tab(/English/));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
