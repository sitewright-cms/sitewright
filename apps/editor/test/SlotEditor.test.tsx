import { describe, it, expect, beforeEach, vi } from 'vitest';
import { forwardRef, useImperativeHandle } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { preview, selectRange, setTranslation, setWebsiteData } = vi.hoisted(() => ({
  preview: vi.fn(), selectRange: vi.fn(), setTranslation: vi.fn(), setWebsiteData: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    preview: (...args: unknown[]) => preview(...args),
    setTranslation: (...args: unknown[]) => setTranslation(...args),
    setWebsiteData: (...args: unknown[]) => setWebsiteData(...args),
  },
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
  setTranslation.mockReset();
  setWebsiteData.mockReset();
  setTranslation.mockResolvedValue(undefined);
  setWebsiteData.mockResolvedValue(undefined);
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

  it('selects ONLY THE TEXT when the click landed on words rather than the element', async () => {
    open();
    const iframe = (await screen.findByTitle('Slot preview')) as HTMLIFrameElement;
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: () => {} }, configurable: true });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          source: 'sitewright-preview',
          type: 'locate-source',
          tag: 'a',
          cls: ['nav-item'],
          nth: 0,
          text: 'Home',
          textHit: '{{sw-label}}', // the preview reports the run under the pointer
        },
        source: iframe.contentWindow,
      }),
    );
    await waitFor(() => expect(selectRange).toHaveBeenCalled());
    const [from, to] = selectRange.mock.calls[0]!;
    // the label binding alone — not the whole <a>, which is what a click on the element's box gives
    expect(SLOT_SOURCE.slice(from as number, to as number)).toBe('{{sw-label}}');
  });

  it('COLLAPSES the code strip on a mode switch instead of unmounting it', () => {
    open();
    const strip = screen.getByRole('region', { name: 'Slot source editor' });
    expect(strip.getAttribute('data-collapsed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Content Editor' }));
    // Same element, collapsed — matching the page editor, so the switch glides rather than the strip
    // blinking out of existence (and the draft in the editor survives the round trip).
    expect(screen.getByRole('region', { name: 'Slot source editor' })).toBe(strip);
    expect(strip.getAttribute('data-collapsed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Code Editor' }));
    expect(strip.getAttribute('data-collapsed')).toBe('false');
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

  it('does NOT throw the strip open when click-to-code places a selection', async () => {
    open();
    const strip = screen.getByLabelText('Slot source editor');
    const iframe = (await screen.findByTitle('Slot preview')) as HTMLIFrameElement;
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: () => {} }, configurable: true });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'sitewright-preview', type: 'locate-source', tag: 'a', cls: ['nav-item'], nth: 0, text: 'Home' },
        source: iframe.contentWindow,
      }),
    );
    await waitFor(() => expect(selectRange).toHaveBeenCalled());
    // selectRange focuses the editor to place the caret. That must not expand the strip over the very
    // preview being clicked — the expansion belongs to reaching for the code, not to being given focus.
    fireEvent.focus(screen.getByLabelText('Main Navigation source'));
    expect(strip).toHaveAttribute('data-expanded', 'false');

    // …but a real reach for the code still pins it open.
    fireEvent.mouseDown(screen.getByLabelText('Main Navigation source'));
    await waitFor(() => expect(strip).toHaveAttribute('data-expanded', 'true'));
  });

  it('gives the source strip away to the preview in content mode (collapsed, not unmounted)', async () => {
    open();
    const strip = screen.getByLabelText('Slot source editor');
    expect(strip.getAttribute('data-collapsed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Content Editor' }));
    // Collapsed to zero height rather than removed, so the switch can animate — see the sibling test.
    await waitFor(() => expect(strip.getAttribute('data-collapsed')).toBe('true'));
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

/**
 * A chrome slot's editable leaves write the SHARED stores — the project translation catalog and
 * website.data. The preview bridge wires them only while that slot is focused, which makes this
 * editor the one place they can be changed; before this, it listened for `locate-source` alone and
 * silently dropped every edit the preview posted.
 */
describe('SlotEditor — inline edits reach the shared stores', () => {
  // The handler only trusts messages whose `source` IS the preview iframe's window, so the stub has
  // to be installed and used as the event source — exactly as the click-to-code tests above do.
  const post = (data: Record<string, unknown>) => {
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    if (!iframe.contentWindow) {
      Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: () => {} }, configurable: true });
    }
    fireEvent(window, new MessageEvent('message', { data: { source: 'sitewright-preview', ...data }, source: iframe.contentWindow }));
  };

  it('writes a data-sw-translate edit to the catalog, debounced, at the default locale', async () => {
    vi.useFakeTimers();
    try {
      render(<SlotEditor project={project} slot="footer" value={SLOT_SOURCE} locales={['de', 'en']} onSave={vi.fn()} onClose={vi.fn()} />);
      post({ type: 'translate-edit', key: 'footer.tagline', value: 'Erste' });
      post({ type: 'translate-edit', key: 'footer.tagline', value: 'Zweite' });
      expect(setTranslation).not.toHaveBeenCalled(); // debounced, not per keystroke
      await vi.advanceTimersByTimeAsync(700);
      // one call, the LAST value, against the project's default locale
      expect(setTranslation).toHaveBeenCalledTimes(1);
      expect(setTranslation).toHaveBeenCalledWith('p', 'footer.tagline', 'de', 'Zweite');
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes a website.data.<path> key to the site-wide store, not the catalog', async () => {
    vi.useFakeTimers();
    try {
      render(<SlotEditor project={project} slot="footer" value={SLOT_SOURCE} onSave={vi.fn()} onClose={vi.fn()} />);
      post({ type: 'edit', key: 'website.data.footer_note', value: 'Hello' });
      post({ type: 'rich-edit', key: 'website.data.footer_disclaimer', html: '<p>Terms</p>' });
      await vi.advanceTimersByTimeAsync(700);
      // the `website.data.` prefix is stripped — the endpoint takes the PATH
      expect(setWebsiteData).toHaveBeenCalledWith('p', 'footer_note', 'Hello');
      expect(setWebsiteData).toHaveBeenCalledWith('p', 'footer_disclaimer', '<p>Terms</p>');
      expect(setTranslation).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores an edit whose key has no store behind it', async () => {
    vi.useFakeTimers();
    try {
      render(<SlotEditor project={project} slot="footer" value={SLOT_SOURCE} onSave={vi.fn()} onClose={vi.fn()} />);
      // A BARE key is page.data, which a slot does not have. The bridge will not wire one, and if a
      // stale preview posts it anyway it must be dropped rather than written somewhere it doesn't belong.
      post({ type: 'edit', key: 'footer_tagline', value: 'x' });
      post({ type: 'translate-edit', key: 'not a key!', value: 'x' });
      await vi.advanceTimersByTimeAsync(700);
      expect(setWebsiteData).not.toHaveBeenCalled();
      expect(setTranslation).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes a pending edit when the editor closes inside the debounce window', async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(
        <SlotEditor project={project} slot="footer" value={SLOT_SOURCE} onSave={vi.fn()} onClose={vi.fn()} />,
      );
      post({ type: 'translate-edit', key: 'footer.rights', value: 'All rights reserved' });
      unmount(); // closed mid-debounce — the last keystrokes must not be lost
      expect(setTranslation).toHaveBeenCalledWith('p', 'footer.rights', 'en', 'All rights reserved');
    } finally {
      vi.useRealTimers();
    }
  });
});

it('surfaces a failed shared-store write instead of losing it silently', async () => {
  // Real timers here: the alert is set in an async catch AFTER the debounce fires, so the assertion
  // has to await React's flush rather than just advancing a fake clock.
  setTranslation.mockRejectedValue(new Error('offline'));
  render(<SlotEditor project={project} slot="footer" value={SLOT_SOURCE} onSave={vi.fn()} onClose={vi.fn()} />);
  const iframe = document.querySelector('iframe') as HTMLIFrameElement;
  Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: () => {} }, configurable: true });
  fireEvent(
    window,
    new MessageEvent('message', {
      data: { source: 'sitewright-preview', type: 'translate-edit', key: 'footer.tagline', value: 'x' },
      source: iframe.contentWindow,
    }),
  );
  // These writes auto-save independently of the slot's own Save button, so a failure has no other way
  // to reach the user — without the alert the edit just looks like it stuck.
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('offline'), { timeout: 3000 });
});
