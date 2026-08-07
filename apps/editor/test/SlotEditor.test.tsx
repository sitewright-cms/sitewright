import { describe, it, expect, beforeEach, vi } from 'vitest';
import { forwardRef, useImperativeHandle } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { preview, selectRange } = vi.hoisted(() => ({ preview: vi.fn(), selectRange: vi.fn() }));
vi.mock('../src/api', () => ({
  api: { preview: (...args: unknown[]) => preview(...args) },
  previewDocUrl: (slug: string, token: string) => `/preview/${slug}/${token}`,
}));
// CodeMirror doesn't run in jsdom — a textarea exercises the same authoring flow, and the handle
// stands in for selectRange so click-to-code is assertable here.
vi.mock('../src/lib/code-editor', () => ({
  CodeEditor: forwardRef(
    ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel?: string }, ref: unknown) => {
      useImperativeHandle(ref as never, () => ({ undo: () => {}, redo: () => {}, selectRange }), []);
      return <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />;
    },
  ),
}));

import { SlotEditor } from '../src/views/SlotEditor';

const project = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };
const SLOT_SOURCE = '<div class="navbar">{{#each nav.header}}<a class="nav-item" href="{{sw-url path}}">{{sw-label}}</a>{{/each}}</div>';

beforeEach(() => {
  preview.mockReset();
  selectRange.mockReset();
  preview.mockResolvedValue({ html: '<!doctype html>', token: 'tok-1' });
});

const open = (onSave = vi.fn(), onClose = vi.fn()) => {
  render(<SlotEditor project={project} slot="mainNav" value={SLOT_SOURCE} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
};

describe('SlotEditor', () => {
  it('opens in CODE mode showing the slot source, and offers no audit tab', async () => {
    open();
    expect((screen.getByLabelText('Main Navigation source') as HTMLTextAreaElement).value).toBe(SLOT_SOURCE);
    expect(screen.getByRole('button', { name: 'Code Editor' })).toHaveAttribute('aria-pressed', 'true');
    // A slot is not a page: there is nothing for a page audit to score.
    expect(screen.queryByRole('button', { name: /audit/i })).toBeNull();
  });

  it('previews the DRAFT slot as an override, against an empty full-height canvas', async () => {
    open();
    await waitFor(() => expect(preview).toHaveBeenCalled());
    const [projectId, page, slots] = preview.mock.calls[0]!;
    expect(projectId).toBe('p');
    // The page is deliberately EMPTY and one viewport tall — chrome needs a document to sit around,
    // scroll over and align to, but real page content would only be noise.
    expect((page as { source: string }).source).toContain('min-h-screen');
    expect((page as { source: string }).source).not.toMatch(/<(section|h1|p)\b/);
    expect(slots).toEqual({ mainNav: SLOT_SOURCE });
    await waitFor(() => expect(screen.getByTitle('Slot preview')).toHaveAttribute('src', '/preview/acme/tok-1'));
  });

  it('re-previews with the edited draft, so the preview shows what is being typed', async () => {
    open();
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Main Navigation source'), { target: { value: '<div class="edited">x</div>' } });
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    expect(preview.mock.calls[1]![2]).toEqual({ mainNav: '<div class="edited">x</div>' });
  });

  it('focuses the slot in the preview so the rest of the page recedes', async () => {
    open();
    const iframe = (await screen.findByTitle('Slot preview')) as HTMLIFrameElement;
    const posted: unknown[] = [];
    Object.defineProperty(iframe, 'contentWindow', {
      value: { postMessage: (m: unknown) => posted.push(m) },
      configurable: true,
    });
    window.dispatchEvent(
      new MessageEvent('message', { data: { source: 'sitewright-preview', type: 'ready' }, source: iframe.contentWindow }),
    );
    await waitFor(() =>
      expect(posted).toContainEqual({ source: 'sitewright-editor', type: 'setSlotFocus', slot: 'mainNav' }),
    );
  });

  it('selects the clicked element inside the SLOT source (click-to-code)', async () => {
    open();
    const iframe = (await screen.findByTitle('Slot preview')) as HTMLIFrameElement;
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: () => {} }, configurable: true });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'sitewright-preview', type: 'locate-source', tag: 'a', cls: ['nav-item'], nth: 0, text: 'Home' },
        source: iframe.contentWindow,
      }),
    );
    await waitFor(() => expect(selectRange).toHaveBeenCalled());
    const [from, to] = selectRange.mock.calls[0]!;
    // the <a> inside the {{#each}} — the authored element, not the whole slot
    expect(SLOT_SOURCE.slice(from as number, to as number)).toBe('<a class="nav-item" href="{{sw-url path}}">{{sw-label}}</a>');
  });

  it('saves the edited slot through the caller', async () => {
    const { onSave } = open();
    fireEvent.change(screen.getByLabelText('Main Navigation source'), { target: { value: '<div class="v2">v2</div>' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('mainNav', '<div class="v2">v2</div>'));
  });
});

describe('SlotEditor layout (matches the page editor)', () => {
  it('stacks a peeking source strip over the preview, expanding it on hover', async () => {
    open();
    const strip = screen.getByLabelText('Slot source editor');
    // Peeks on open so the preview keeps the room, then expands when you reach for the code.
    expect(strip).toHaveAttribute('data-expanded', 'false');
    fireEvent.mouseEnter(strip);
    await waitFor(() => expect(strip).toHaveAttribute('data-expanded', 'true'));
    fireEvent.mouseLeave(strip);
    await waitFor(() => expect(strip).toHaveAttribute('data-expanded', 'false'));
  });

  it('hides the source strip entirely in content mode, so the preview fills the modal', async () => {
    open();
    expect(screen.getByLabelText('Slot source editor')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Content Editor' }));
    await waitFor(() => expect(screen.queryByLabelText('Slot source editor')).toBeNull());
    expect(screen.getByTitle('Slot preview')).toBeTruthy();
  });

  it('puts the device rail INSIDE the preview, vertically', () => {
    open();
    const rail = screen.getByRole('group', { name: 'Preview device' });
    expect(rail.className).toContain('flex-col');
    expect(rail.className).toContain('absolute');
    expect(screen.getByRole('button', { name: 'Preview: Mobile' })).toBeTruthy();
  });
});
