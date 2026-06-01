import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Page } from '@sitewright/schema';

const { renderTemplate, putPage } = vi.hoisted(() => ({ renderTemplate: vi.fn(), putPage: vi.fn() }));
vi.mock('../src/api', () => ({
  api: {
    renderTemplate: (...args: unknown[]) => renderTemplate(...args),
    putPage: (...args: unknown[]) => putPage(...args),
  },
}));
// Swap the CodeMirror widget for a plain textarea so the authoring flow is exercisable in
// jsdom; the real CodeMirror editor is covered by the Playwright browser E2E.
vi.mock('../src/lib/code-editor', () => ({
  CodeEditor: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel?: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { CodePageEditor } from '../src/views/CodePageEditor';

const org = { id: 'o', name: 'O', slug: 'o', role: 'owner' };
const project = { id: 'p', name: 'Acme', slug: 'acme' };
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
  renderTemplate.mockResolvedValue({ html: '<!doctype html><body><h1>Acme</h1></body>' });
  putPage.mockResolvedValue({ item: page });
});

describe('CodePageEditor', () => {
  it('renders a debounced, styled preview of the current source in a sandboxed iframe', async () => {
    render(<CodePageEditor org={org} project={project} page={page} onClose={() => {}} />);
    // Debounced — the render is not requested synchronously on mount.
    expect(renderTemplate).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(renderTemplate).toHaveBeenCalledWith('o', 'p', {
        template: '<h1>{{ company.name }}</h1>',
        page: { title: 'Home', path: '/' },
        document: true,
      }),
    );
    const iframe = screen.getByTitle('Preview') as HTMLIFrameElement;
    expect(iframe.getAttribute('sandbox')).toBe(''); // no scripts run in the preview
    await waitFor(() => expect(iframe.getAttribute('srcdoc')).toContain('<h1>Acme</h1>'));
  });

  it('saves edited source via putPage, preserving page identity, and shows a saved state', async () => {
    render(<CodePageEditor org={org} project={project} page={page} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Template source'), { target: { value: '<h2>New body</h2>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(putPage).toHaveBeenCalledTimes(1));
    const saved = putPage.mock.calls[0]![2] as Page;
    expect(saved.source).toBe('<h2>New body</h2>');
    expect(saved.id).toBe('home'); // identity + the rest of the page are preserved
    expect(saved.title).toBe('Home');
    await screen.findByText('Saved');
  });

  it('surfaces a preview error (e.g. an unsafe template the validator rejected)', async () => {
    renderTemplate.mockRejectedValue(new Error('unsafe template: <script> is not allowed'));
    render(<CodePageEditor org={org} project={project} page={page} onClose={() => {}} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('unsafe template');
  });

  it('disables Save until the source is edited', () => {
    render(<CodePageEditor org={org} project={project} page={page} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Template source'), { target: { value: '<p>changed</p>' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
