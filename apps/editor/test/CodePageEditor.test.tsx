import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Page } from '@sitewright/schema';

const { renderTemplate, putPage } = vi.hoisted(() => ({ renderTemplate: vi.fn(), putPage: vi.fn() }));
vi.mock('../src/api', () => ({
  api: {
    renderTemplate: (...args: unknown[]) => renderTemplate(...args),
    putPage: (...args: unknown[]) => putPage(...args),
  },
  previewDocUrl: (projectId: string, token: string) => `/projects/${projectId}/preview/${token}`,
}));
// Swap the CodeMirror widget for a plain textarea so the authoring flow is exercisable in
// jsdom; the real CodeMirror editor is covered by the Playwright browser E2E.
vi.mock('../src/lib/code-editor', () => ({
  CodeEditor: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel?: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { CodePageEditor } from '../src/views/CodePageEditor';

const project = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };
const page: Page = {
  id: 'home',
  path: '/',
  title: 'Home',
  root: { id: 'r', type: 'Section' },
  source: '<h1>{{ company.name }}</h1>',
};

beforeEach(() => {
  renderTemplate.mockReset();
  putPage.mockReset();
  renderTemplate.mockResolvedValue({ html: '<!doctype html><body><h1>Acme</h1></body>', token: 'tok-123' });
  putPage.mockResolvedValue({ item: page });
});

describe('CodePageEditor', () => {
  it('renders a debounced preview loaded via an opaque-origin iframe src (not srcDoc)', async () => {
    render(<CodePageEditor project={project} page={page} onClose={() => {}} />);
    // Debounced — the render is not requested synchronously on mount.
    expect(renderTemplate).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(renderTemplate).toHaveBeenCalledWith('p', {
        template: '<h1>{{ company.name }}</h1>',
        page: { title: 'Home', path: '/' },
        document: true,
      }),
    );
    const iframe = screen.getByTitle('Live preview') as HTMLIFrameElement;
    // Loaded by URL (token endpoint) under the iframe's own sandbox CSP — NEVER inlined as srcDoc.
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe.hasAttribute('srcdoc')).toBe(false);
    await waitFor(() => expect(iframe.getAttribute('src')).toBe('/projects/p/preview/tok-123'));
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
    renderTemplate.mockRejectedValue(new Error('unsafe template: <script> is not allowed'));
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

  it('appends a DaisyUI starter pattern to existing source, and resets the picker', () => {
    render(<CodePageEditor project={project} page={page} onClose={() => {}} />);
    const editor = screen.getByLabelText('Template source') as HTMLTextAreaElement;
    const picker = screen.getByLabelText('Insert pattern') as HTMLSelectElement;
    fireEvent.change(editor, { target: { value: '<header>existing</header>' } });
    fireEvent.change(picker, { target: { value: 'hero' } });
    // The existing content is preserved and the Hero pattern (a DaisyUI hero) is appended.
    expect(editor.value).toContain('<header>existing</header>');
    expect(editor.value).toContain('class="hero');
    expect(editor.value).toContain('{{edit "hero_title"');
    // The select returns to its placeholder so the same pattern can be inserted again.
    expect(picker.value).toBe('');
  });

  it('edits page settings (status + nav) and persists them on save', async () => {
    render(<CodePageEditor project={project} page={page} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Page settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'draft' }));
    fireEvent.click(screen.getByLabelText('Nav: header'));
    fireEvent.change(screen.getByLabelText('Nav order'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(putPage).toHaveBeenCalledTimes(1));
    const saved = putPage.mock.calls[0]![1] as Page;
    expect(saved.status).toBe('draft');
    expect(saved.nav).toEqual({ slots: ['header'], order: 3 });
    expect(saved.source).toBe(page.source); // settings-only edit leaves the template untouched
  });

  it('inserts a pattern as the whole source when the editor is empty', () => {
    const blank: Page = { ...page, source: '   ' };
    render(<CodePageEditor project={project} page={blank} onClose={() => {}} />);
    const editor = screen.getByLabelText('Template source') as HTMLTextAreaElement;
    fireEvent.change(screen.getByLabelText('Insert pattern'), { target: { value: 'navbar' } });
    // No leading whitespace/blank lines from the previously-empty source.
    expect(editor.value.startsWith('<div class="navbar')).toBe(true);
  });
});
