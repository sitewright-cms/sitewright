import { describe, it, expect, beforeEach, vi } from 'vitest';
import { forwardRef, useImperativeHandle } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Page } from '@sitewright/schema';

const { preview, putPage, listTemplates, getPage } = vi.hoisted(() => ({
  preview: vi.fn(),
  putPage: vi.fn(),
  listTemplates: vi.fn(),
  getPage: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    preview: (...args: unknown[]) => preview(...args),
    putPage: (...args: unknown[]) => putPage(...args),
    listTemplates: (...args: unknown[]) => listTemplates(...args),
    getPage: (...args: unknown[]) => getPage(...args),
  },
  previewDocUrl: (slug: string, token: string) => `/preview/${slug}/${token}`,
}));
// Swap the CodeMirror widget for a plain textarea so the authoring flow is exercisable in
// jsdom; the real CodeMirror editor (incl. its undo/redo handle) is covered by the Playwright E2E.
vi.mock('../src/lib/code-editor', () => ({
  CodeEditor: forwardRef(
    ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel?: string }, ref: unknown) => {
      useImperativeHandle(ref as never, () => ({ undo: () => {}, redo: () => {} }), []);
      return <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />;
    },
  ),
}));

import { CodePageEditor } from '../src/views/CodePageEditor';

const project = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };
const page: Page = {
  id: 'home',
  path: '',
  title: 'Home',
  source: '<h1>{{ company.name }}</h1>',
};
// A page whose source marks a client-editable region — content mode's subject.
const editablePage: Page = {
  ...page,
  source: '<h1>{{ company.name }}</h1><p data-sw-text="tagline">Edit this tagline</p>',
};

beforeEach(() => {
  preview.mockReset();
  putPage.mockReset();
  listTemplates.mockReset();
  getPage.mockReset();
  preview.mockResolvedValue({ html: '<!doctype html><body><h1>Acme</h1></body>', token: 'tok-123' });
  putPage.mockResolvedValue({ item: page });
  listTemplates.mockResolvedValue({ items: [] });
  getPage.mockResolvedValue({ item: page });
});

describe('CodePageEditor', () => {
  it('renders a debounced FULL-PARITY preview (POST /preview with the whole draft) via iframe src', async () => {
    render(<CodePageEditor project={project} page={page} onClose={() => {}} />);
    // Debounced — the render is not requested synchronously on mount.
    expect(preview).not.toHaveBeenCalled();
    await waitFor(() =>
      // The whole draft page goes to /preview — the endpoint that renders skeleton
      // slots + website head + content (parity with the published document).
      expect(preview).toHaveBeenCalledWith(
        'p',
        expect.objectContaining({ id: 'home', source: '<h1>{{ company.name }}</h1>', title: 'Home' }),
      ),
    );
    const iframe = screen.getByTitle('Preview') as HTMLIFrameElement;
    // Loaded by URL (token endpoint) under the iframe's own sandbox CSP — NEVER inlined as srcDoc.
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe.hasAttribute('srcdoc')).toBe(false);
    await waitFor(() => expect(iframe.getAttribute('src')).toBe('/preview/acme/tok-123'));
  });

  it('saves edited source via putPage, preserving page identity, and shows a saved state', async () => {
    render(<CodePageEditor project={project} page={page} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Template source'), { target: { value: '<h2>New body</h2>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(putPage).toHaveBeenCalledTimes(1));
    const saved = putPage.mock.calls[0]![1] as Page;
    expect(saved.source).toBe('<h2>New body</h2>');
    expect(saved.id).toBe('home'); // identity + the rest of the page are preserved
    expect(saved.title).toBe('Home');
    await screen.findByText('Saved');
  });

  it('surfaces a preview error and clears the loading state', async () => {
    preview.mockRejectedValue(new Error('unsafe template: <script> is not allowed'));
    render(<CodePageEditor project={project} page={page} onClose={() => {}} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('unsafe template');
    // The "updating…" indicator is gone once the request settles (loading cleared on error).
    await waitFor(() => expect(screen.queryByText('updating…')).toBeNull());
  });

  it('disables Save until the source is edited', () => {
    render(<CodePageEditor project={project} page={page} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Template source'), { target: { value: '<p>changed</p>' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });


  it('edits page settings in the STACKED modal (status + nav + dropdown) and persists on save', async () => {
    render(<CodePageEditor project={project} page={page} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Page settings' }));
    // The settings modal stacks ABOVE the editor modal (two dialogs open).
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'draft' }));
    fireEvent.click(screen.getByLabelText('Nav: Main navigation'));
    fireEvent.click(screen.getByLabelText('Show in dropdown'));
    // Nav order now lives under Advanced (an occasional tweak) — expand it to reach the field.
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    fireEvent.change(screen.getByLabelText('Nav order'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' })); // applies to the DRAFT
    expect(screen.getAllByRole('dialog')).toHaveLength(1); // settings closed, editor stays

    fireEvent.click(screen.getByRole('button', { name: 'Save' })); // ONE save persists all
    await waitFor(() => expect(putPage).toHaveBeenCalledTimes(1));
    const saved = putPage.mock.calls[0]![1] as Page;
    expect(saved.status).toBe('draft');
    // The menu label is guaranteed when a page joins a menu — it falls back to the page title ("Home").
    expect(saved.nav).toEqual({ slots: ['header'], title: 'Home', order: 3, dropdown: true });
    expect(saved.source).toBe(page.source); // settings-only edit leaves the template untouched
  });

  it('persists meta description, OG image, parent, and template via the settings modal', async () => {
    // The subject is a NON-home page (home is the tree root and can't be re-parented);
    // its parent can be set to any sibling.
    const subject: Page = { ...page, id: 'blog', path: 'blog', title: 'Blog' };
    const about: Page = { ...page, id: 'about', path: 'about', title: 'About' };
    render(<CodePageEditor project={project} page={subject} pages={[page, about, subject]} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Page settings' }));
    fireEvent.change(screen.getByLabelText('Meta description'), { target: { value: 'Crisp summary.' } });
    fireEvent.change(screen.getByLabelText('Image (Open Graph)'), { target: { value: 'https://x.test/og.png' } });
    // Parent is a searchable combobox: open it and pick the sibling by its path.
    fireEvent.click(screen.getByRole('combobox', { name: 'Parent page' }));
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Parent page' })).getByText('/about'));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(putPage).toHaveBeenCalledTimes(1));
    const saved = putPage.mock.calls[0]![1] as Page;
    expect(saved.description).toBe('Crisp summary.');
    expect(saved.image).toBe('https://x.test/og.png');
    expect(saved.parent).toBe('about');
  });

  it('LOCKS the code surface for a template page; forking copies the source and unlocks', async () => {
    const templated: Page = { ...page, source: undefined, template: 'global:text' };
    render(<CodePageEditor project={project} page={templated} onClose={() => {}} />);
    // No CodeMirror, no pattern insert — the lock panel explains + offers the fork.
    expect(screen.queryByLabelText('Template source')).toBeNull();
    expect(screen.queryByLabelText('Insert pattern')).toBeNull();
    expect(screen.getByText(/renders the template/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fork template into page' }));
    // Forked: the template's source is now the PAGE's own code, reference dropped.
    const editor = screen.getByLabelText('Template source') as HTMLTextAreaElement;
    expect(editor.value).toContain('data-sw-text="heading"'); // global:text's source
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putPage).toHaveBeenCalledTimes(1));
    const saved = putPage.mock.calls[0]![1] as Page;
    expect(saved.template).toBeUndefined();
    expect(saved.source).toContain('data-sw-text="heading"');
  });


  it('opens with the authoring strip COLLAPSED; hover and focus expand it, leaving collapses it', () => {
    render(<CodePageEditor project={project} page={page} onClose={() => {}} />);
    const strip = screen.getByRole('region', { name: 'Template source editor' });
    expect(strip.getAttribute('data-expanded')).toBe('false'); // collapsed on open
    fireEvent.mouseEnter(strip);
    expect(strip.getAttribute('data-expanded')).toBe('true'); // expands on hover
    fireEvent.mouseLeave(strip);
    expect(strip.getAttribute('data-expanded')).toBe('false');
    // Keyboard path: focus inside (typing) keeps it open without the pointer.
    fireEvent.focus(screen.getByLabelText('Template source'));
    expect(strip.getAttribute('data-expanded')).toBe('true');
  });

  it('simulates device widths: large desktop is FLUID (modal full width), the rest are fixed', () => {
    render(<CodePageEditor project={project} page={page} onClose={() => {}} />);
    const viewport = () => screen.getByTestId('device-viewport') as HTMLDivElement;
    // Default: large desktop = fluid — no simulated width, the preview fills the modal.
    expect(screen.getByRole('button', { name: 'Preview: Large desktop' }).getAttribute('aria-pressed')).toBe('true');
    expect(viewport().style.width).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Preview: Mobile' }));
    expect(viewport().style.width).toBe('390px'); // below sm → base styles
    fireEvent.click(screen.getByRole('button', { name: 'Preview: Tablet' }));
    expect(viewport().style.width).toBe('768px'); // md
    fireEvent.click(screen.getByRole('button', { name: 'Preview: Laptop' }));
    expect(viewport().style.width).toBe('1024px'); // lg
    fireEvent.click(screen.getByRole('button', { name: 'Preview: Large desktop' }));
    expect(viewport().style.width).toBe(''); // back to fluid
  });

  it('saves via Ctrl+S WITHOUT closing, and the Save button keeps the modal open', async () => {
    const onClose = vi.fn();
    render(<CodePageEditor project={project} page={page} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Template source'), { target: { value: '<p>v2</p>' } });
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    await waitFor(() => expect(putPage).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled(); // the authoring loop continues
    await screen.findByText('Saved');

    fireEvent.change(screen.getByLabelText('Template source'), { target: { value: '<p>v3</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putPage).toHaveBeenCalledTimes(2));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape closes a clean editor with no discard dialog', async () => {
    const onClose = vi.fn();
    render(<CodePageEditor project={project} page={page} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Discard changes' })).toBeNull();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1)); // closes after the exit animation
  });

  it('a dirty editor asks via the discard DIALOG: cancel keeps it open, Discard closes', async () => {
    const onClose = vi.fn();
    render(<CodePageEditor project={project} page={page} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Template source'), { target: { value: '<p>unsaved</p>' } });
    // Esc → the discard dialog appears (a stacked modal); cancel keeps the editor open.
    fireEvent.keyDown(document, { key: 'Escape' });
    const discard = await screen.findByRole('dialog', { name: 'Discard changes' });
    fireEvent.click(within(discard).getByRole('button', { name: 'Cancel' }));
    // The discard dialog closes and the editor stays open (the close was refused).
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Discard changes' })).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Template source')).toBeInTheDocument(); // still editing

    // Esc again → confirm Discard → closes.
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Discard changes' })).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('the header CLOSE button discards without saving (confirming via the dialog)', async () => {
    const onClose = vi.fn();
    render(<CodePageEditor project={project} page={page} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Template source'), { target: { value: '<p>unsaved</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Discard changes' })).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(putPage).not.toHaveBeenCalled(); // discarded — never saved
  });

  it('a backdrop click on a dirty editor goes through the same discard dialog', async () => {
    const onClose = vi.fn();
    render(<CodePageEditor project={project} page={page} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Template source'), { target: { value: '<p>unsaved</p>' } });
    // The presentation wrapper around the editor dialog panel is the backdrop click target.
    fireEvent.mouseDown(screen.getAllByRole('dialog')[0]!.parentElement!);
    const discard = await screen.findByRole('dialog', { name: 'Discard changes' });
    fireEvent.click(within(discard).getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled(); // declined → still editing
  });
});

describe('CodePageEditor — content mode (in-modal)', () => {
  // Content mode = edit in the live preview (a real browser; covered by the e2e specs) + the "Edit
  // page data" JSON editor. The authoring strip is hidden entirely, so these jsdom tests cover the chrome.
  it('opens directly in content mode: the live preview fills the modal; the raw editor is hidden but the shared toolbar shows', () => {
    render(<CodePageEditor project={project} page={editablePage} onClose={() => {}} initialMode="content" />);
    // The Content Editor tab is active…
    expect(screen.getByRole('button', { name: 'Content Editor' })).toHaveAttribute('aria-pressed', 'true');
    // …the live preview fills the modal (no authoring strip)…
    expect(screen.getByTitle('Preview')).toBeInTheDocument();
    // …the raw template editor is hidden…
    expect(screen.queryByLabelText('Template source')).toBeNull();
    // …but BOTH modes share the same toolbar (Undo/Redo/Page data/Page settings/Reload + Save/Close).
    for (const name of ['Undo', 'Redo', 'Edit page data', 'Page settings', 'Reload page', 'Save', 'Close']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('shows the same shared toolbar in code mode too (Undo/Redo/Page data/Page settings/Reload)', () => {
    render(<CodePageEditor project={project} page={editablePage} onClose={() => {}} initialMode="source" />);
    for (const name of ['Undo', 'Redo', 'Edit page data', 'Page settings', 'Reload page', 'Save', 'Close']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('switches modes LOSSLESSLY — the source draft survives the Code⇄Content toggle', () => {
    render(<CodePageEditor project={project} page={editablePage} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Template source'), {
      target: { value: '<p data-sw-text="headline">Big news</p>' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Content Editor' })); // → content: the code strip is hidden
    expect(screen.queryByLabelText('Template source')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Code Editor' })); // → back to source: the draft survived
    expect(screen.getByLabelText('Template source')).toHaveValue('<p data-sw-text="headline">Big news</p>');
  });

  it('Reload warns when dirty, then re-fetches the page and discards the draft', async () => {
    getPage.mockResolvedValue({ item: { ...page, source: '<h1>FROM SERVER</h1>' } });
    render(<CodePageEditor project={project} page={page} onClose={() => {}} initialMode="source" />);
    // Make an unsaved edit, then Reload → a dirty-warning confirm appears.
    fireEvent.change(screen.getByLabelText('Template source'), { target: { value: '<h1>local edit</h1>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    const warn = await screen.findByRole('dialog', { name: 'Reload page' });
    fireEvent.click(within(warn).getByRole('button', { name: 'Discard & reload' }));
    // The page is re-fetched and the draft is replaced by the server version.
    await waitFor(() => expect(getPage).toHaveBeenCalledWith('p', 'home'));
    await waitFor(() => expect(screen.getByLabelText('Template source')).toHaveValue('<h1>FROM SERVER</h1>'));
    // No longer dirty → Save is disabled again.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('Reload refreshes the preview even when the page is NOT dirty (forces a fresh server render)', async () => {
    render(<CodePageEditor project={project} page={page} onClose={() => {}} initialMode="source" />);
    await waitFor(() => expect(preview).toHaveBeenCalled());
    preview.mockClear();
    // Not dirty → no confirm dialog; Reload still re-fetches AND re-renders the preview (the bug was a
    // no-op here because state didn't change → the stateKey-driven preview effect never re-ran).
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    await waitFor(() => expect(getPage).toHaveBeenCalledWith('p', 'home'));
    await waitFor(() => expect(preview).toHaveBeenCalled());
  });

  it('a preview internal-link click opens the target page editor (clean → immediate)', async () => {
    const about: Page = { id: 'about', path: 'about', title: 'About' };
    const onNavigate = vi.fn();
    render(
      <CodePageEditor project={project} page={page} pages={[page, about]} onNavigate={onNavigate} onClose={() => {}} initialMode="source" />,
    );
    const iframe = screen.getByTitle('Preview') as HTMLIFrameElement;
    await waitFor(() => expect(iframe.contentWindow).toBeTruthy());
    window.dispatchEvent(
      new MessageEvent('message', { data: { source: 'sitewright-preview', type: 'link-click', href: '/about' }, source: iframe.contentWindow }),
    );
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('about'));
  });

  it('a preview internal-link click on a DIRTY page warns (naming the target) before switching', async () => {
    const about: Page = { id: 'about', path: 'about', title: 'About' };
    const onNavigate = vi.fn();
    render(
      <CodePageEditor project={project} page={page} pages={[page, about]} onNavigate={onNavigate} onClose={() => {}} initialMode="source" />,
    );
    fireEvent.change(screen.getByLabelText('Template source'), { target: { value: '<h1>local edit</h1>' } });
    const iframe = screen.getByTitle('Preview') as HTMLIFrameElement;
    await waitFor(() => expect(iframe.contentWindow).toBeTruthy());
    window.dispatchEvent(
      new MessageEvent('message', { data: { source: 'sitewright-preview', type: 'link-click', href: '/about' }, source: iframe.contentWindow }),
    );
    const warn = await screen.findByRole('dialog', { name: 'Leave this page?' });
    expect(within(warn).getByText(/About/)).toBeInTheDocument(); // the message names the target page
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(within(warn).getByRole('button', { name: 'Discard & open' }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('about'));
  });
});
