// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { CriticalCssShortcut } from '../src/views/settings/CriticalCssShortcut';
import { ToastProvider } from '../src/views/ui/Toast';
import { OVERLAY_STACK } from '../src/views/ui/overlay';
import { api } from '../src/api';

/**
 * Critical CSS, one chord from anywhere.
 *
 * The two failure modes worth pinning are both about DATA, not keys: opening on an empty draft (which
 * a save would then write over the real stylesheet) and writing with a full PUT (which would blank
 * every setting this caller never loaded).
 */

vi.mock('../src/lib/code-editor', () => ({
  CodeEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="Source" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

// Spies are installed per-test, not at module scope: afterEach restores them, which would leave the
// module-level handle patching nothing from the second test onward (test 1 green, the rest mystifying).
let getSettings: ReturnType<typeof vi.spyOn<typeof api, 'getSettings'>>;
let patchWebsiteSettings: ReturnType<typeof vi.spyOn<typeof api, 'patchWebsiteSettings'>>;
let putSettings: ReturnType<typeof vi.spyOn<typeof api, 'putSettings'>>;

// NOT a defaulted parameter: `mount(undefined)` would silently take the default and the
// "no project selected" case would quietly test the p1 case instead.
const mountWith = (projectId: string | undefined) =>
  render(
    <ToastProvider>
      <CriticalCssShortcut projectId={projectId} />
    </ToastProvider>,
  );
const mount = () => mountWith('p1');

const press = () => fireEvent.keyDown(window, { key: 'c', ctrlKey: true, altKey: true });

beforeEach(() => {
  getSettings = vi.spyOn(api, 'getSettings').mockResolvedValue({
    item: { identity: {}, settings: {}, website: { criticalCss: '.hero{color:red}' } },
  } as never);
  patchWebsiteSettings = vi.spyOn(api, 'patchWebsiteSettings').mockResolvedValue({ item: {} } as never);
  putSettings = vi.spyOn(api, 'putSettings').mockResolvedValue({ item: {} } as never);
});
afterEach(() => {
  // Auto-cleanup is not enabled here, and this component listens on WINDOW: a instance left mounted
  // keeps answering the chord in the next test, which is how "no project selected" saw a call for "p1".
  cleanup();
  OVERLAY_STACK.length = 0;
  vi.restoreAllMocks();
});

describe('CriticalCssShortcut', () => {
  it('renders nothing until the chord is pressed, then opens on the STORED css', async () => {
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
    press();
    expect(await screen.findByRole('dialog', { name: 'Critical CSS' })).toBeInTheDocument();
    // ★ The draft it opens with is the baseline a save writes back. Opening on '' before the fetch
    // landed would turn one Ctrl+S into "the stylesheet is now empty".
    expect(screen.getByLabelText('Source')).toHaveValue('.hero{color:red}');
  });

  it('opens OVER an already-open modal — that is the whole point of the shortcut', async () => {
    mount();
    OVERLAY_STACK.push({}); // the page editor
    OVERLAY_STACK.push({}); // a slot editor over it
    press();
    expect(await screen.findByRole('dialog', { name: 'Critical CSS' })).toBeInTheDocument();
  });

  it('saves through the MERGE endpoint, never a full settings replace', async () => {
    mount();
    press();
    await screen.findByRole('dialog', { name: 'Critical CSS' });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: '.hero{color:blue}' } });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => expect(patchWebsiteSettings).toHaveBeenCalledWith('p1', { criticalCss: '.hero{color:blue}' }));
    // A full PUT from a caller holding one field would blank every setting it wasn't carrying.
    expect(putSettings).not.toHaveBeenCalled();
  });

  it('opens NOTHING when the settings read fails, and says so', async () => {
    getSettings.mockRejectedValue(new Error('offline'));
    mount();
    press();
    expect(await screen.findByText(/Couldn’t open Critical CSS: offline/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Critical CSS' })).toBeNull();
  });

  it('is inert with no project selected (the setting is per-project)', () => {
    mountWith(undefined);
    press();
    expect(getSettings).not.toHaveBeenCalled();
  });
});
