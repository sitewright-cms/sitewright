import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Modal } from '../src/views/ui/Modal';

describe('Modal', () => {
  it('renders the title + children and portals to <body>', () => {
    render(
      <Modal title="My dialog" onClose={() => {}}>
        <p>Body content</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'My dialog' })).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  // onClose fires after the exit animation (AnimatePresence.onExitComplete), so each path is
  // checked on its own instance with waitFor.
  it('closes (after the exit animation) on the Close button', async () => {
    const onClose = vi.fn();
    render(
      <Modal title="X" onClose={onClose}>
        <p>hi</p>
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Modal title="X" onClose={onClose}>
        <p>hi</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('closes on a backdrop click', async () => {
    const onClose = vi.fn();
    render(
      <Modal title="X" onClose={onClose}>
        <p>hi</p>
      </Modal>,
    );
    // Backdrop = the presentation wrapper; a mousedown directly on it (not the panel) closes.
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.mouseDown(backdrop);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('does NOT close when the mousedown originates inside the panel', () => {
    const onClose = vi.fn();
    render(
      <Modal title="X" onClose={onClose}>
        <p>hi</p>
      </Modal>,
    );
    fireEvent.mouseDown(screen.getByText('hi'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('consults onBeforeClose: a false guard vetoes the close', async () => {
    const onClose = vi.fn();
    const onBeforeClose = vi.fn().mockResolvedValue(false);
    render(
      <Modal title="X" onClose={onClose} onBeforeClose={onBeforeClose}>
        <p>hi</p>
      </Modal>,
    );
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement);
    await waitFor(() => expect(onBeforeClose).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 40));
    expect(onClose).not.toHaveBeenCalled(); // vetoed → stays open
  });

  it('consults onBeforeClose: a true guard allows the close', async () => {
    const onClose = vi.fn();
    const onBeforeClose = vi.fn().mockResolvedValue(true);
    render(
      <Modal title="X" onClose={onClose} onBeforeClose={onBeforeClose}>
        <p>hi</p>
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('only renders the Save button when onSave is given, and fires it on click + ⌘S', () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <Modal title="X" onClose={() => {}}>
        <p>hi</p>
      </Modal>,
    );
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

    rerender(
      <Modal title="X" onClose={() => {}} onSave={onSave} saveLabel="Save">
        <p>hi</p>
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('traps Tab inside the panel (last focusable wraps back to the first)', () => {
    render(
      <Modal title="X" onClose={() => {}} onSave={() => {}} saveLabel="Save">
        <p>hi</p>
      </Modal>,
    );
    const save = screen.getByRole('button', { name: 'Save' });
    const close = screen.getByRole('button', { name: 'Close' });
    // DOM order inside the panel: Save, then Close → Close is the last focusable.
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(document.activeElement).toBe(save);
  });

  it('suppresses ⌘S while a save is already in flight', () => {
    const onSave = vi.fn();
    render(
      <Modal title="X" onClose={() => {}} onSave={onSave} saving>
        <p>hi</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 's', metaKey: true });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saveDisabled disables the Save button AND suppresses ⌘S (still eating the browser dialog)', () => {
    const onSave = vi.fn();
    render(
      <Modal title="X" onClose={() => {}} onSave={onSave} saveDisabled>
        <p>hi</p>
      </Modal>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    const event = fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    expect(onSave).not.toHaveBeenCalled();
    // preventDefault still fired — the browser's own "save page" dialog must never appear.
    expect(event).toBe(false); // fireEvent returns false when defaultPrevented
  });

  it('wears the brand gradient ONLY when there is something to save', () => {
    const { rerender } = render(
      <Modal title="X" onClose={() => {}} onSave={() => {}} saveDisabled>
        <p>hi</p>
      </Modal>,
    );
    // Clean: neutral. The gradient is the loudest thing in the chrome and must not advertise an
    // action that would do nothing.
    const clean = screen.getByRole('button', { name: 'Save' });
    expect(clean.className).not.toContain('sw-brand-gradient');

    rerender(
      <Modal title="X" onClose={() => {}} onSave={() => {}}>
        <p>hi</p>
      </Modal>,
    );
    expect(screen.getByRole('button', { name: 'Save' }).className).toContain('sw-brand-gradient');
  });
});

/**
 * MOBILE: every modal becomes a BOTTOM SHEET. The `size` key answers "how wide on a big screen", and
 * on a 412px phone the answer is always "all of it" — so the key is dropped rather than reinterpreted.
 */
describe('Modal as a bottom sheet', () => {
  function withMobileViewport() {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('max-width'),
      media: q,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }));
  }
  afterEach(() => vi.unstubAllGlobals());

  const panel = () => screen.getByRole('dialog');
  const wrapper = () => screen.getByRole('dialog').parentElement as HTMLElement;

  it('anchors to the BOTTOM edge and squares off its bottom corners', () => {
    withMobileViewport();
    render(
      <Modal title="Sheet" onClose={() => {}}>
        <p>hi</p>
      </Modal>,
    );
    expect(wrapper().className).toContain('items-end'); // grows from the bottom, not centred
    expect(wrapper().className).not.toContain('items-center');
    expect(panel().className).toContain('rounded-t-2xl');
    // A corner rounded against the edge of the screen only shows slivers of backdrop.
    expect(panel().className).not.toContain('rounded-2xl');
  });

  it('ignores the size key — "how wide" has one answer on a phone', () => {
    withMobileViewport();
    render(
      <Modal title="Sheet" size="md" onClose={() => {}}>
        <p>hi</p>
      </Modal>,
    );
    expect(panel().className).toContain('max-w-none');
    expect(panel().className).not.toContain('max-w-lg');
    // Content-sized, merely capped: a two-line confirm must not become a full-screen takeover.
    expect(panel().className).toContain('max-h-full');
    // classList, not a substring match — `max-h-full` contains `h-full`.
    expect(panel().classList.contains('h-full')).toBe(false);
  });

  it('★ keeps a FIXED height for the sizes whose content lays out against one', () => {
    // The page editor's body is `flex h-full flex-col`. Under an auto-height sheet that `h-full` has
    // nothing to resolve against and the entire editor collapses to the height of its toolbar.
    withMobileViewport();
    render(
      <Modal title="Editor" size="screen" onClose={() => {}}>
        <p>hi</p>
      </Modal>,
    );
    expect(panel().classList.contains('h-full')).toBe(true);
  });

  it('stays a centred card on desktop', () => {
    render(
      <Modal title="Card" size="md" onClose={() => {}}>
        <p>hi</p>
      </Modal>,
    );
    expect(wrapper().className).toContain('items-center');
    expect(panel().className).toContain('max-w-lg');
    expect(panel().className).toContain('rounded-2xl');
  });

  it('★ gives the title its own row, above the actions', () => {
    // One row cannot hold a title, a subtitle link and Save/Close below 1000px. In the entry editor it
    // did not even fail cleanly: the "View dataset" link under the title collided with the buttons.
    withMobileViewport();
    render(
      <Modal title="Edit Team member" titleBelow={<a href="#x">View dataset</a>} onClose={() => {}} onSave={() => {}}>
        <p>hi</p>
      </Modal>,
    );
    const header = screen.getByRole('heading', { name: 'Edit Team member' }).closest('header')!;
    expect(header.className).toContain('flex-col');
    // Centred: with the title on its own row there is no left-hand anchor left to align to, and a
    // left-aligned title above a right-aligned button row reads as two unrelated strips.
    expect(header.className).toContain('items-center');
    // The title and its link share a container that the action buttons are NOT inside.
    const titleBlock = screen.getByRole('heading', { name: 'Edit Team member' }).parentElement!;
    expect(titleBlock).toContainElement(screen.getByRole('link', { name: 'View dataset' }));
    expect(titleBlock).not.toContainElement(screen.getByRole('button', { name: 'Save' }));
    expect(titleBlock.className).toContain('text-center');
    // …and the action row centres too, rather than being pushed to one edge.
    expect((screen.getByRole('button', { name: 'Save' }).closest('div') as HTMLElement).className).toContain('justify-center');
  });

  it('does NOT stack when the title is deliberately hidden — that would add an empty row', () => {
    withMobileViewport();
    render(
      <Modal title="Home" titleHidden onClose={() => {}}>
        <p>hi</p>
      </Modal>,
    );
    const header = screen.getByRole('heading', { name: 'Home' }).closest('header')!;
    expect(header.className).not.toContain('flex-col');
  });

  it('contains scroll chaining so a drag past the end never scrolls the page behind', () => {
    render(
      <Modal title="Long" onClose={() => {}}>
        <p>hi</p>
      </Modal>,
    );
    const body = screen.getByText('hi').parentElement as HTMLElement;
    expect(body.className).toContain('overscroll-contain');
  });
});
