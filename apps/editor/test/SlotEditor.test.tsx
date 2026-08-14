import { describe, it, expect, beforeEach, vi } from 'vitest';
import { forwardRef, useImperativeHandle } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const {
  preview, selectRange, setTranslation, setWebsiteData, listForms, listDatasets, getEntry,
  listImageMaps, listImageMapTemplates, getSettings, listEntries,
} = vi.hoisted(() => ({
  preview: vi.fn(), selectRange: vi.fn(), setTranslation: vi.fn(), setWebsiteData: vi.fn(), listForms: vi.fn(),
  listDatasets: vi.fn(), getEntry: vi.fn(), listImageMaps: vi.fn(), listImageMapTemplates: vi.fn(), getSettings: vi.fn(), listEntries: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    preview: (...args: unknown[]) => preview(...args),
    setTranslation: (...args: unknown[]) => setTranslation(...args),
    setWebsiteData: (...args: unknown[]) => setWebsiteData(...args),
    listForms: (...args: unknown[]) => listForms(...args),
    listDatasets: (...args: unknown[]) => listDatasets(...args),
    getEntry: (...args: unknown[]) => getEntry(...args),
    listImageMaps: (...args: unknown[]) => listImageMaps(...args),
    listImageMapTemplates: (...args: unknown[]) => listImageMapTemplates(...args),
    imageMapPreviewUrl: () => '/imagemap-preview',
    getSettings: (...args: unknown[]) => getSettings(...args),
    listEntries: (...args: unknown[]) => listEntries(...args),
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
  listForms.mockReset();
  listForms.mockResolvedValue({ items: [] });
  listDatasets.mockReset();
  listDatasets.mockResolvedValue({ items: [] });
  getEntry.mockReset();
  getEntry.mockResolvedValue({ item: null });
  listImageMaps.mockReset();
  // Shaped like the real ImageMapSchema (name lives under `general`) — a looser stub renders the
  // Studio's list against undefined and throws, which vitest counts as an unhandled error.
  listImageMaps.mockResolvedValue({
    items: [{ id: 'floorplan', general: { name: 'Floorplan' }, artboards: [{ id: 'a1', name: 'Ground', image: '/media/x.png', objects: [] }] }],
  });
  listImageMapTemplates.mockReset();
  listImageMapTemplates.mockResolvedValue({ templates: [] }); // the Studio reads `.templates`, not `.items`
  getSettings.mockReset();
  getSettings.mockResolvedValue({ item: { website: {} } });
  listEntries.mockReset();
  listEntries.mockResolvedValue({ items: [] });
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

describe('SlotEditor — a form embedded in a slot opens its definition', () => {
  it('looks the form up by the id the preview reported', async () => {
    render(<SlotEditor project={project} slot="footer" value={SLOT_SOURCE} onSave={vi.fn()} onClose={vi.fn()} />);
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: () => {} }, configurable: true });
    fireEvent(
      window,
      new MessageEvent('message', {
        data: { source: 'sitewright-preview', type: 'open-form', id: 'newsletter' },
        source: iframe.contentWindow,
      }),
    );
    // A form definition is a project entity, so it is fetched rather than read out of the slot source.
    await waitFor(() => expect(listForms).toHaveBeenCalledWith('p'));
  });

  it('says so when the referenced form no longer exists, rather than opening an empty editor', async () => {
    listForms.mockResolvedValue({ items: [] });
    render(<SlotEditor project={project} slot="footer" value={SLOT_SOURCE} onSave={vi.fn()} onClose={vi.fn()} />);
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: () => {} }, configurable: true });
    fireEvent(
      window,
      new MessageEvent('message', {
        data: { source: 'sitewright-preview', type: 'open-form', id: 'gone' },
        source: iframe.contentWindow,
      }),
    );
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('gone'));
  });
});

describe('SlotEditor — switching to another slot', () => {
  /** Post a message as if it came from this editor's own preview iframe. */
  const fromPreview = (data: Record<string, unknown>) => {
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: () => {} }, configurable: true });
    fireEvent(window, new MessageEvent('message', { data: { source: 'sitewright-preview', ...data }, source: iframe.contentWindow }));
  };

  it('the title becomes a picker of the five slots, and choosing one switches', () => {
    const onSwitchSlot = vi.fn();
    render(<SlotEditor project={project} slot="mainNav" value={SLOT_SOURCE} onSave={vi.fn()} onSwitchSlot={onSwitchSlot} onClose={vi.fn()} />);
    const picker = screen.getByLabelText('Chrome slot') as HTMLSelectElement;
    expect(picker.value).toBe('mainNav');
    expect([...picker.options].map((o) => o.value)).toEqual(['mainNav', 'sidebarLeft', 'sidebarRight', 'footer', 'bottom']);
    fireEvent.change(picker, { target: { value: 'footer' } });
    expect(onSwitchSlot).toHaveBeenCalledWith('footer');
    // The dialog keeps its accessible name even though the visible title is now a control.
    expect(screen.getByRole('dialog', { name: 'Main Navigation' })).toBeInTheDocument();
  });

  it('the preview\u2019s "Edit <slot>" affordance switches THIS editor', () => {
    const onSwitchSlot = vi.fn();
    render(<SlotEditor project={project} slot="mainNav" value={SLOT_SOURCE} onSave={vi.fn()} onSwitchSlot={onSwitchSlot} onClose={vi.fn()} />);
    fromPreview({ type: 'edit-slot', slot: 'bottom' });
    expect(onSwitchSlot).toHaveBeenCalledWith('bottom');
    // An unknown key is ignored rather than switching to nothing.
    onSwitchSlot.mockClear();
    fromPreview({ type: 'edit-slot', slot: 'not-a-slot' });
    expect(onSwitchSlot).not.toHaveBeenCalled();
  });

  it('asks before discarding an unsaved draft, and stays put when the answer is no', () => {
    const onSwitchSlot = vi.fn();
    render(<SlotEditor project={project} slot="mainNav" value={SLOT_SOURCE} onSave={vi.fn()} onSwitchSlot={onSwitchSlot} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Main Navigation source'), { target: { value: '<div>edited</div>' } });

    // The slot editor\u2019s Save owns the source \u2014 nothing else would write this draft back.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.change(screen.getByLabelText('Chrome slot'), { target: { value: 'footer' } });
    expect(confirm).toHaveBeenCalledWith('Discard unsaved changes to Main Navigation?');
    expect(onSwitchSlot).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.change(screen.getByLabelText('Chrome slot'), { target: { value: 'footer' } });
    expect(onSwitchSlot).toHaveBeenCalledWith('footer');
    confirm.mockRestore();
  });

  it('shows a plain title when the owner cannot switch', () => {
    render(<SlotEditor project={project} slot="footer" value={SLOT_SOURCE} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByLabelText('Chrome slot')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Footer' })).toBeInTheDocument();
  });
});

// ★ A slot has NO page.data, so its repeated content — client logos, "why us" slides, capability bars —
// can only come from a dataset. Clicking such a row is therefore the main way to edit a slot's content,
// yet the bridge's `open-entry` used to arrive here and fall through to nothing: the row highlighted,
// swallowed the click, and no editor opened. A footer built entirely out of datasets then read as
// "those lists were never converted" when every dataset and row was already in place.
describe('SlotEditor — a dataset row in a slot opens its entry editor', () => {
  const DATASET = { id: 'why', slug: 'why_phoenix', name: 'Why PHOENIX', fields: [{ name: 'lead', type: 'text', required: true }] };
  const ENTRY = { id: 'we_offer', dataset: 'why_phoenix', status: 'published', values: { lead: 'We offer' } };

  const clickRow = (data: Record<string, unknown>) => {
    render(<SlotEditor project={project} slot="footer" value={SLOT_SOURCE} onSave={vi.fn()} onClose={vi.fn()} />);
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: () => {} }, configurable: true });
    fireEvent(
      window,
      new MessageEvent('message', { data: { source: 'sitewright-preview', ...data }, source: iframe.contentWindow }),
    );
  };

  it('★ opens the clicked row’s editor, resolving the dataset by the SLUG the marker carries', async () => {
    listDatasets.mockResolvedValue({ items: [DATASET] });
    getEntry.mockResolvedValue({ item: ENTRY });
    clickRow({ type: 'open-entry', dataset: 'why_phoenix', id: 'we_offer' });
    // Fetched by (dataset slug + entry id) — an entry id is unique only WITHIN its dataset.
    await waitFor(() => expect(getEntry).toHaveBeenCalledWith('p', 'we_offer', 'why_phoenix'));
    // …and the editor is actually on screen, not merely loaded.
    expect(await screen.findByRole('dialog', { name: /Edit We offer/ })).toBeInTheDocument();
  });

  it('ignores a row whose dataset or id is a prototype-polluting key', async () => {
    listDatasets.mockResolvedValue({ items: [DATASET] });
    getEntry.mockResolvedValue({ item: ENTRY });
    clickRow({ type: 'open-entry', dataset: '__proto__', id: 'we_offer' });
    clickRow({ type: 'open-entry', dataset: 'why_phoenix', id: 'constructor' });
    await waitFor(() => expect(preview).toHaveBeenCalled()); // let any async work settle
    expect(getEntry).not.toHaveBeenCalled();
  });

  it('ignores an entry message that names no dataset (nothing to resolve it against)', async () => {
    clickRow({ type: 'open-entry', dataset: '', id: 'we_offer' });
    await waitFor(() => expect(preview).toHaveBeenCalled());
    expect(getEntry).not.toHaveBeenCalled();
  });
});

// ★ THE SLOT EDITOR USED TO ANSWER ONLY 8 OF THE BRIDGE'S 19 OUTBOUND MESSAGES. The other eleven
// rendered their affordance, highlighted on hover, swallowed the click — and did nothing, with no
// error anywhere. The gate for "does this belong in a slot?" is not the message, it is the STORE
// behind it: a slot has no page.data, so only `website.data.<path>` keys can persist. These cover
// each newly-wired message AND the refusal of the targets a slot genuinely cannot write.
describe('SlotEditor — the rest of the preview bridge', () => {
  const send = (data: Record<string, unknown>) => {
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    if (!(iframe as unknown as { contentWindow: unknown }).contentWindow) {
      Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: () => {} }, configurable: true });
    }
    fireEvent(
      window,
      new MessageEvent('message', { data: { source: 'sitewright-preview', ...data }, source: iframe.contentWindow }),
    );
  };
  const openFooter = () => {
    render(<SlotEditor project={project} slot="footer" value={SLOT_SOURCE} onSave={vi.fn()} onClose={vi.fn()} />);
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: () => {} }, configurable: true });
  };

  it('★ pick-image on a website.data region opens the picker — the header logo is replaceable at last', async () => {
    openFooter();
    send({ type: 'pick-image', key: 'website.data.logo' });
    expect(await screen.findByText(/Replace image/i)).toBeInTheDocument();
  });

  it('ignores pick-image for a BARE key — a slot has no page.data, so that pick could never persist', async () => {
    openFooter();
    send({ type: 'pick-image', key: 'logo' });
    await waitFor(() => expect(preview).toHaveBeenCalled());
    expect(screen.queryByText(/Replace image/i)).toBeNull();
  });

  it('★ a {{sw-control}} writes a website.data target, and REFUSES a page one', async () => {
    openFooter();
    send({ type: 'control-edit', target: 'website.data.tagline', value: 'Built in Namibia' });
    await waitFor(() => expect(setWebsiteData).toHaveBeenCalledWith('p', 'tagline', 'Built in Namibia'));
    setWebsiteData.mockClear();
    // `page.title` / a bare page.data key belong to whatever page happens to render this chrome —
    // writing one here would attribute a site-wide edit to a single page.
    send({ type: 'control-edit', target: 'page.title', value: 'nope' });
    send({ type: 'control-edit', target: 'hero_heading', value: 'nope' });
    await waitFor(() => expect(preview).toHaveBeenCalled());
    expect(setWebsiteData).not.toHaveBeenCalled();
  });

  it('scheme-sanitizes a control URL before it reaches the store', async () => {
    openFooter();
    send({ type: 'control-edit', target: 'website.data.cta', as: 'url', value: 'javascript:alert(1)' });
    await waitFor(() => expect(setWebsiteData).toHaveBeenCalledWith('p', 'cta', ''));
  });

  it('★ the link popover writes both the href and the text leaf, sanitized', async () => {
    openFooter();
    send({ type: 'link-edit', hrefKey: 'website.data.cta_href', href: '/contact', textKey: 'website.data.cta_text', text: 'Talk to us' });
    await waitFor(() => expect(setWebsiteData).toHaveBeenCalledWith('p', 'cta_href', '/contact'));
    expect(setWebsiteData).toHaveBeenCalledWith('p', 'cta_text', 'Talk to us');
  });

  it('★ edit-html-source opens the HTML source view for a rich region', async () => {
    openFooter();
    send({ type: 'edit-html-source', key: 'website.data.about', html: '<p>hi</p>' });
    expect(await screen.findByRole('dialog', { name: /HTML/i })).toBeInTheDocument();
  });

  it('★ a stored image map opens the Studio (it is a project entity, editable from its slot)', async () => {
    openFooter();
    send({ type: 'open-imagemap', id: 'floorplan' });
    await waitFor(() => expect(document.querySelectorAll('[role="dialog"]').length).toBeGreaterThan(1));
  });

  it('★ remembers the preview scroll, so a footer does not leave the screen on every keystroke', async () => {
    openFooter();
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    send({ type: 'scroll', y: 1240 });
    fireEvent.change(screen.getByLabelText('Footer source'), { target: { value: '<div>edited</div>' } });
    await waitFor(() => expect(screen.getByTitle('Slot preview')).toHaveAttribute('src', '/preview/acme/tok-1#sw-y=1240'));
  });

  it('★ seeds the on-page rich toolbar with the project CI palette on every (re)load', async () => {
    render(<SlotEditor project={project} slot="footer" value={SLOT_SOURCE} onSave={vi.fn()} onClose={vi.fn()} />);
    const iframe = (await screen.findByTitle('Slot preview')) as HTMLIFrameElement;
    const posted: Array<{ type?: string }> = [];
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: (m: { type?: string }) => posted.push(m) }, configurable: true });
    fireEvent(window, new MessageEvent('message', { data: { source: 'sitewright-preview', type: 'ready' }, source: iframe.contentWindow }));
    await waitFor(() => expect(posted.some((m) => m.type === 'ci-palette')).toBe(true));
  });

  it('a link click in the chrome is deliberately inert (a slot editor has nowhere to navigate)', async () => {
    openFooter();
    send({ type: 'link-click', href: '/about' });
    await waitFor(() => expect(preview).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull(); // no error surfaced, nothing thrown
  });
});

// The Regions rail is described in the bridge as "the RELIABLE way to reach any editable thing —
// including content the page occludes, hides (display:none), or repeats". Chrome is full of exactly
// that (a carousel slide, a drawer that is closed until you open it), and the slot editor had no rail
// at all: it ignored the manifest, so the one affordance built for unreachable content was missing
// from the surface that needs it most.
describe('SlotEditor — the Regions rail', () => {
  const MANIFEST = [
    { rid: 0, kind: 'entry', label: 'We offer HIGH-END DEVELOPMENTS', dataset: 'footer_config', id: 'config' },
    { rid: 1, kind: 'image', label: 'website.data.logo' },
  ];

  it('★ lists the regions the bridge reports, in CONTENT mode', async () => {
    render(<SlotEditor project={project} slot="footer" value={SLOT_SOURCE} onSave={vi.fn()} onClose={vi.fn()} />);
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const posted: Array<{ type?: string; rid?: number }> = [];
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: (m: never) => posted.push(m) }, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: 'Content Editor' }));
    fireEvent(
      window,
      new MessageEvent('message', {
        data: { source: 'sitewright-preview', type: 'regions', items: MANIFEST },
        source: iframe.contentWindow,
      }),
    );
    const row = await screen.findByText(/HIGH-END DEVELOPMENTS/);
    fireEvent.click(row);
    // Clicking a row asks the preview to scroll to + flash + edit that region — by rid, the only thing
    // the editor sends back, so a stale manifest can never address the wrong element by key.
    await waitFor(() => expect(posted).toContainEqual({ source: 'sitewright-editor', type: 'edit-region', rid: 0 }));
  });

  it('drops a structurally invalid manifest row instead of rendering it', async () => {
    render(<SlotEditor project={project} slot="footer" value={SLOT_SOURCE} onSave={vi.fn()} onClose={vi.fn()} />);
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: () => {} }, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: 'Content Editor' }));
    fireEvent(
      window,
      new MessageEvent('message', {
        data: {
          source: 'sitewright-preview',
          type: 'regions',
          items: [{ rid: 'nope', kind: 'text', label: 'bad rid' }, { rid: 2, kind: 'text', label: 'good row' }],
        },
        source: iframe.contentWindow,
      }),
    );
    expect(await screen.findByText('good row')).toBeInTheDocument();
    expect(screen.queryByText('bad rid')).toBeNull();
  });
});
