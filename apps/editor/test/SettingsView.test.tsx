import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { SettingsBundle } from '../src/api';
import { ToastProvider } from '../src/views/ui/Toast';

const { getSettings, putSettings, getProjectPayment, listTransactions, listPages, FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { getSettings: vi.fn(), putSettings: vi.fn(), getProjectPayment: vi.fn(), listTransactions: vi.fn(), listPages: vi.fn(), FakeApiError };
});
vi.mock('../src/api', () => ({
  ApiError: FakeApiError,
  api: {
    getSettings: (p: string) => getSettings(p),
    putSettings: (p: string, b: SettingsBundle) => putSettings(p, b),
    // The Identity board loads the project's font library assets on mount.
    listMedia: () => Promise.resolve({ items: [] }),
    // The Website board loads the "fork existing effect" snippets on mount.
    listEffectForks: () => Promise.resolve({ nav: [], button: [], preloader: [] }),
    // …and asks which payment gateways this project may bind to, so the checkout channel row can offer
    // them by NAME. A project with none is the normal case — hence the empty list.
    projectPaymentGateways: () => Promise.resolve({ gateways: [{ id: 'stripe', name: 'Stripe Checkout' }] }),
    // The shop tile's Payments part and orders count (only asked while the shop is on).
    getProjectPayment: (p: string) => getProjectPayment(p),
    listTransactions: (p: string, q: unknown) => listTransactions(p, q),
    transactionsUndelivered: () => Promise.resolve({ notify: 0, receipt: 0 }),
    // The security.txt drill-in lists pages for its contact picker.
    listPages: (p: string) => listPages(p),
    pruneThumbnails: () => Promise.resolve({ removed: 12 }),
  },
}));

// The real code editor is CodeMirror, which has no value setter jsdom can drive. Stub it down to its
// CONTRACT — a Save button that hands the edited value to `onSave` — which is the half this test is
// about: that saving inside the editor reaches the SERVER, not just the form.
vi.mock('../src/views/ui/CodeEditorModal', () => ({
  CodeEditorModal: ({ title, value, hint, onSave, onClose }: { title: string; value: string; hint?: string; onSave: (v: string) => void; onClose: () => void }) => (
    <div role="dialog" aria-label={title}>
      {hint && <p>{hint}</p>}
      <textarea aria-label="code" defaultValue={value} data-testid="code-area" />
      <button
        type="button"
        onClick={() => {
          onSave((document.querySelector('[data-testid="code-area"]') as HTMLTextAreaElement).value);
          onClose();
        }}
      >
        Save changes
      </button>
    </div>
  ),
}));
// The media picker is its own surface (library browsing, uploads, URL import); here only its contract
// matters — a pick hands a URL back to the well that opened it.
vi.mock('../src/views/files/FilePicker', () => ({
  FilePicker: ({ title, onPick, onClose }: { title: string; onPick: (url: string) => void; onClose: () => void }) => (
    <div role="dialog" aria-label={title}>
      <button
        type="button"
        onClick={() => {
          onPick('/media/acme/logo.png');
          onClose();
        }}
      >
        Pick test file
      </button>
    </div>
  ),
}));

// The FULL slot editor (live preview, devices, click-to-code) is its own surface with its own tests;
// here only its contract matters — which slot it opened, and that its Save persists that slot.
vi.mock('../src/views/SlotEditor', () => ({
  SlotEditor: ({ slot, value, onSave, onClose }: { slot: string; value: string; onSave: (key: string, src: string) => void; onClose: () => void }) => (
    <div role="dialog" aria-label={`Full editor: ${slot}`}>
      <textarea aria-label="slot source" defaultValue={value} data-testid="slot-area" />
      <button type="button" onClick={() => onSave(slot, (document.querySelector('[data-testid="slot-area"]') as HTMLTextAreaElement).value)}>
        Save slot
      </button>
      <button type="button" onClick={onClose}>
        Close full editor
      </button>
    </div>
  ),
}));

import { SettingsView } from '../src/views/settings/SettingsView';

const project = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };

const bundle: SettingsBundle = {
  identity: { name: 'Acme', legalName: 'Acme Inc.', colors: { primary: '#0a7' } },
  settings: { defaultLocale: 'en', locales: ['en'] },
};

// Toasts are the save/discard confirmation channel, so every render goes through the provider
// (without it `useToast()` is a no-op and no confirmation text would appear).
function renderView(props: Partial<Parameters<typeof SettingsView>[0]> = {}) {
  return render(
    <ToastProvider>
      <SettingsView project={project} {...props} />
    </ToastProvider>,
  );
}

/** Opens a board tile's drill-in and returns the dialog it opened. */
async function openTile(title: string, dialogName: string | RegExp = title) {
  // Brand colors is an inline tile now (the core colours are picked on it); its drill-in opens from the
  // custom-colours row.
  const opener = title === 'Brand colors' ? 'Edit custom colors' : `Open ${title}`;
  fireEvent.click(await screen.findByRole('button', { name: opener }));
  return screen.findByRole('dialog', { name: dialogName });
}
const closeSheet = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
const floatingSave = () => screen.getByRole('button', { name: 'Save' });
const floatingDiscard = () => screen.getByRole('button', { name: 'Discard' });

beforeEach(() => {
  getSettings.mockReset();
  putSettings.mockReset();
  getProjectPayment.mockReset();
  listTransactions.mockReset();
  getSettings.mockResolvedValue({ item: bundle });
  putSettings.mockResolvedValue({ item: bundle });
  getProjectPayment.mockResolvedValue({ binding: null });
  listTransactions.mockResolvedValue({ items: [], total: 0 });
  listPages.mockReset();
  listPages.mockResolvedValue({ items: [] });
});

describe('SettingsView', () => {
  it('loads the identity and renders both section tabs', async () => {
    renderView();
    const sheet = await openTile('Identity');
    expect(within(sheet).getByLabelText('Display name')).toHaveValue('Acme');
    expect(screen.getByRole('tab', { name: 'Corporate Identity' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Website' })).toBeInTheDocument();
  });

  it('starts from defaults when no settings exist yet (404)', async () => {
    getSettings.mockRejectedValue(new FakeApiError(404, 'not found'));
    renderView();
    // Falls back to the project name as the identity display name.
    const sheet = await openTile('Identity');
    expect(within(sheet).getByLabelText('Display name')).toHaveValue('Acme');
  });

  it('keeps Save + Discard disabled until there are unsaved changes', async () => {
    renderView();
    const sheet = await openTile('Identity');
    expect(floatingSave()).toBeDisabled();
    expect(floatingDiscard()).toBeDisabled();
    // The drill-in's own Save is disabled while there is nothing to save, too.
    expect(within(sheet).getByRole('button', { name: 'Save and close' })).toBeDisabled();
    fireEvent.change(within(sheet).getByLabelText('Legal name'), { target: { value: 'Acme Corporation' } });
    expect(floatingSave()).toBeEnabled();
    expect(floatingDiscard()).toBeEnabled();
    expect(within(sheet).getByRole('button', { name: 'Save and close' })).toBeEnabled();
  });

  it('edits a field and saves the assembled bundle from the page, then toasts success', async () => {
    renderView();
    const sheet = await openTile('Identity');
    fireEvent.change(within(sheet).getByLabelText('Legal name'), { target: { value: 'Acme Corporation' } });
    closeSheet(sheet);
    fireEvent.click(floatingSave());
    await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
    const sent = putSettings.mock.calls[0]![1] as SettingsBundle;
    expect(sent.identity.legalName).toBe('Acme Corporation');
    expect(sent.identity.name).toBe('Acme');
    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
    // After a successful save the form matches the new baseline → buttons disable again.
    await waitFor(() => expect(floatingSave()).toBeDisabled());
  });

  it('★ a drill-in’s own Save persists the section and closes it', async () => {
    renderView();
    const sheet = await openTile('Identity');
    fireEvent.change(within(sheet).getByLabelText('Slogan'), { target: { value: 'Tools that last' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save and close' }));
    await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
    expect((putSettings.mock.calls[0]![1] as SettingsBundle).identity.slogan).toBe('Tools that last');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Identity' })).toBeNull());
  });

  it('a failed drill-in save keeps it open with the edit intact', async () => {
    putSettings.mockRejectedValue(new Error('input too large'));
    renderView();
    const sheet = await openTile('Identity');
    fireEvent.change(within(sheet).getByLabelText('Slogan'), { target: { value: 'Tools that last' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save and close' }));
    expect(await screen.findByText('input too large')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Identity' })).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Slogan')).toHaveValue('Tools that last');
  });

  it('closing a drill-in keeps its edits pending — the tile shows them and the page can still save them', async () => {
    renderView();
    let sheet = await openTile('Identity');
    fireEvent.change(within(sheet).getByLabelText('Slogan'), { target: { value: 'Tools that last' } });
    closeSheet(sheet);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Identity' })).toBeNull());
    // The tile already reads back the unsaved value.
    expect(screen.getByRole('button', { name: 'Open Identity' })).toHaveTextContent('Tools that last');
    expect(floatingSave()).toBeEnabled();
    sheet = await openTile('Identity');
    expect(within(sheet).getByLabelText('Slogan')).toHaveValue('Tools that last');
  });

  it('★ saving a SKELETON SLOT in its editor persists it, in that one gesture', async () => {
    // The slots are edited in a modal with its own Save button (and Ctrl+S). That used to only stage
    // the change into the form, leaving the author to find the tab's Save — which reads as "I saved
    // and it didn't save". Note the value must reach the SERVER, not just the form: a naive
    // `patch(p); save()` would close over the pre-patch form and persist the OLD slot.
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    // The main nav opens in the FULL editor…
    fireEvent.click(await screen.findByRole('button', { name: /Edit mainNav/ }));
    const full = await screen.findByRole('dialog', { name: 'Full editor: mainNav' });
    fireEvent.change(within(full).getByLabelText('slot source'), { target: { value: '<div>from the full editor</div>' } });
    fireEvent.click(within(full).getByRole('button', { name: 'Save slot' }));
    await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
    expect((putSettings.mock.calls[0]![1] as SettingsBundle).website?.mainNav).toBe('<div>from the full editor</div>');
    fireEvent.click(within(full).getByRole('button', { name: 'Close full editor' }));

    // …and `bottom` in the code editor; both save in their own gesture.
    putSettings.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Edit bottom/ }));
    const code = await screen.findByRole('dialog', { name: 'bottom partial' });
    fireEvent.change(within(code).getByLabelText('code'), { target: { value: '<div>from the code editor</div>' } });
    fireEvent.click(within(code).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
    expect((putSettings.mock.calls[0]![1] as SettingsBundle).website?.bottom).toBe('<div>from the code editor</div>');
  });

  it('the visible chrome opens in the FULL editor; the other parts open in the code editor', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    for (const [label, slot] of [[/Edit mainNav/, 'mainNav'], [/Edit sidebarLeft/, 'sidebarLeft'], [/Edit sidebarRight/, 'sidebarRight'], [/Edit footer/, 'footer']] as const) {
      fireEvent.click(await screen.findByRole('button', { name: label }));
      const full = await screen.findByRole('dialog', { name: `Full editor: ${slot}` });
      expect(screen.queryByLabelText('code')).toBeNull();
      fireEvent.click(within(full).getByRole('button', { name: 'Close full editor' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: `Full editor: ${slot}` })).toBeNull());
    }
    for (const [label, title] of [[/Edit bottom/, 'bottom partial'], [/Edit Project-wide CSS/, 'Critical CSS'], [/Edit Raw HTML injected into <head>/, 'Head HTML'], [/Edit Raw HTML injected after the page body/, 'Scripts']] as const) {
      fireEvent.click(await screen.findByRole('button', { name: label }));
      const code = await screen.findByRole('dialog', { name: title });
      expect(within(code).getByLabelText('code')).toBeInTheDocument();
      fireEvent.click(within(code).getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: title })).toBeNull());
    }
  });

  it('the Scripts editor says scripts are NOT wrapped for you', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    fireEvent.click(await screen.findByRole('button', { name: /Edit Raw HTML injected after the page body/ }));
    const code = await screen.findByRole('dialog', { name: 'Scripts' });
    expect(within(code).getByText(/Nothing is wrapped for you: put JavaScript inside <script>…<\/script> tags/)).toBeInTheDocument();
  });

  it('the document map edits Critical CSS, Head HTML and Scripts — each saving in its own gesture', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    for (const [label, title, key] of [
      [/Edit Project-wide CSS/, 'Critical CSS', 'criticalCss'],
      [/Edit Raw HTML injected into <head>/, 'Head HTML', 'head'],
      [/Edit Raw HTML injected after the page body/, 'Scripts', 'scripts'],
    ] as const) {
      putSettings.mockClear();
      fireEvent.click(await screen.findByRole('button', { name: label }));
      const editor = await screen.findByRole('dialog', { name: title });
      fireEvent.change(within(editor).getByLabelText('code'), { target: { value: `/* ${key} */` } });
      fireEvent.click(within(editor).getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
      expect((putSettings.mock.calls[0]![1] as SettingsBundle).website).toMatchObject({ [key]: `/* ${key} */` });
    }
  });

  it('discards unsaved edits, reverting fields and re-disabling the buttons', async () => {
    renderView();
    const sheet = await openTile('Identity');
    const legal = within(sheet).getByLabelText('Legal name');
    fireEvent.change(legal, { target: { value: 'Changed Inc.' } });
    expect(legal).toHaveValue('Changed Inc.');
    closeSheet(sheet);
    fireEvent.click(floatingDiscard());
    expect(await screen.findByText('Changes discarded')).toBeInTheDocument();
    expect(floatingDiscard()).toBeDisabled();
    expect(floatingSave()).toBeDisabled();
    const reopened = await openTile('Identity');
    expect(within(reopened).getByLabelText('Legal name')).toHaveValue('Acme Inc.');
    // Discarding must not hit the API.
    expect(putSettings).not.toHaveBeenCalled();
  });

  it('switches to the Website section and edits siteUrl — right on the Site tile — into the saved bundle', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    fireEvent.change(await screen.findByLabelText(/Production URL/), { target: { value: 'https://acme.com' } });
    fireEvent.click(floatingSave());
    await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
    expect((putSettings.mock.calls[0]![1] as SettingsBundle).website?.siteUrl).toBe('https://acme.com');
  });

  it('shows an inline error for a malformed siteUrl on input and clears it once corrected', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    const siteUrl = await screen.findByLabelText(/Production URL/);
    // A scheme-less value is invalid → the inline message appears + the input is marked invalid.
    fireEvent.change(siteUrl, { target: { value: 'acme.com' } });
    expect(await screen.findByText(/starts with https:\/\//i)).toBeInTheDocument();
    expect(siteUrl).toHaveAttribute('aria-invalid', 'true');
    // A query string is rejected too (would break the sitemap <loc>).
    fireEvent.change(siteUrl, { target: { value: 'https://acme.com?x=1' } });
    expect(await screen.findByText(/no "\?" query/i)).toBeInTheDocument();
    // Correcting it clears the error (and a trailing slash is accepted — normalized at build).
    fireEvent.change(siteUrl, { target: { value: 'https://acme.com/' } });
    await waitFor(() => expect(screen.queryByText(/starts with https:\/\//i)).toBeNull());
    expect(siteUrl).not.toHaveAttribute('aria-invalid');
  });

  it('toasts a save error', async () => {
    putSettings.mockRejectedValue(new Error('input too large'));
    renderView();
    const sheet = await openTile('Identity');
    fireEvent.change(within(sheet).getByLabelText('Legal name'), { target: { value: 'Acme Corporation' } });
    closeSheet(sheet);
    fireEvent.click(floatingSave());
    expect(await screen.findByText('input too large')).toBeInTheDocument();
  });

  it('tracks dirty state independently per section', async () => {
    renderView();
    // Edit an IDENTITY field → CI is dirty.
    const sheet = await openTile('Identity');
    fireEvent.change(within(sheet).getByLabelText('Legal name'), { target: { value: 'Acme Corp' } });
    closeSheet(sheet);
    expect(floatingSave()).toBeEnabled();
    // Switch to Website → its OWN (clean) state: the buttons are disabled there.
    fireEvent.click(screen.getByRole('tab', { name: 'Website' }));
    await screen.findByLabelText(/Production URL/);
    expect(floatingSave()).toBeDisabled();
    expect(floatingDiscard()).toBeDisabled();
    // Back on CI → the identity edit is still pending (preserved across the switch).
    fireEvent.click(screen.getByRole('tab', { name: 'Corporate Identity' }));
    const reopened = await openTile('Identity');
    expect(within(reopened).getByLabelText('Legal name')).toHaveValue('Acme Corp');
    expect(floatingSave()).toBeEnabled();
  });

  it('saves only the active section, leaving the other section’s edits pending', async () => {
    renderView();
    // Make a pending WEBSITE edit first…
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    fireEvent.change(await screen.findByLabelText(/Production URL/), { target: { value: 'https://acme.com' } });
    // …then go to CI, edit + Save.
    fireEvent.click(screen.getByRole('tab', { name: 'Corporate Identity' }));
    const identity = await openTile('Identity');
    fireEvent.change(within(identity).getByLabelText('Legal name'), { target: { value: 'Acme Corp' } });
    fireEvent.click(within(identity).getByRole('button', { name: 'Save and close' }));
    await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
    const sent = putSettings.mock.calls[0]![1] as SettingsBundle;
    expect(sent.identity.legalName).toBe('Acme Corp');
    // The CI save must NOT carry the pending website edit (base.website was undefined).
    expect(sent.website?.siteUrl).toBeUndefined();
    // Back on Website → the edit survives and is still pending.
    fireEvent.click(screen.getByRole('tab', { name: 'Website' }));
    expect(await screen.findByLabelText(/Production URL/)).toHaveValue('https://acme.com');
    expect(floatingSave()).toBeEnabled();
  });
});

describe('SettingsView — the boards', () => {
  it('lays the boards out in their fixed band order, with no band subtitles', async () => {
    renderView();
    await screen.findByRole('button', { name: 'Open Identity' });
    const bandTitles = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(bandTitles()).toEqual(['Identity & Brand Assets', 'Business details', 'Design tokens']);
    // Identity comes first in Brand assets, before the logo wells.
    const identity = screen.getByRole('button', { name: 'Open Identity' });
    const logos = screen.getByRole('group', { name: 'Logos & images tile' });
    expect(identity.compareDocumentPosition(logos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Website' }));
    await screen.findByLabelText(/Production URL/);
    expect(bandTitles()).toEqual(['Delivery', 'Document', 'Site behaviour', 'Modules']);
    // Content width is the LAST tile in Delivery.
    const delivery = ['Site tile', 'Images tile', 'Content width tile'].map((name) => screen.getByRole('group', { name }));
    expect(delivery[0]!.compareDocumentPosition(delivery[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(delivery[1]!.compareDocumentPosition(delivery[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Nav, buttons & preloader sits above the themes tile.
    const effects = screen.getByRole('group', { name: 'Nav, buttons & preloader tile' });
    const themes = screen.getByRole('group', { name: 'Light / dark themes tile' });
    expect(effects.compareDocumentPosition(themes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a custom content width keeps the select at full size beside a narrow pixel field', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    fireEvent.change(await screen.findByLabelText('Content width'), { target: { value: 'custom' } });
    const px = screen.getByLabelText('Custom content width in pixels');
    expect(px).toHaveValue(1080);
    expect(px.parentElement?.className).toContain('grid-cols-[minmax(0,1fr)_5.5rem]');
    fireEvent.change(px, { target: { value: '1180' } });
    expect(screen.getByRole('group', { name: 'Content width tile' })).toHaveTextContent('1180px');
  });

  it('tiles report honest state: a fresh site needs a production URL, an untouched palette is Default', async () => {
    renderView();
    const colors = await screen.findByRole('group', { name: 'Brand colors tile' });
    expect(within(colors).getByText('6 core')).toBeInTheDocument(); // primary was changed in the bundle
    expect(screen.getByRole('button', { name: 'Open Typography' })).toHaveTextContent('System fonts');
    fireEvent.click(screen.getByRole('tab', { name: 'Website' }));
    const site = await screen.findByRole('group', { name: 'Site tile' });
    expect(within(site).getByText('No production URL').closest('[data-state]')).toHaveAttribute('data-state', 'attention');
  });

  it('★ every control the old cards held is still reachable', async () => {
    // A sweep, because the redesign's one real risk is a setting that silently becomes unreachable.
    renderView();
    const identity: Array<[string, string, string]> = [
      ['Identity', 'Identity', 'Business type (schema.org @type)'],
      ['Brand colors', 'Brand colors', 'Edit Primary Color'],
      ['Typography', 'Typography', 'Heading font family'],
      ['CSS tokens', 'CSS tokens', '+ Add CSS token'],
      ['Contact & location', 'Contact & location', 'Booking URL'],
      ['Social profiles', 'Social profiles', '+ Add profile'],
    ];
    for (const [tile, dialog, control] of identity) {
      const sheet = await openTile(tile, dialog);
      expect(within(sheet).queryAllByLabelText(control).length + within(sheet).queryAllByRole('button', { name: control }).length, `${tile} → ${control}`).toBeGreaterThan(0);
      closeSheet(sheet);
      await waitFor(() => expect(screen.queryByRole('dialog', { name: dialog })).toBeNull());
    }
    for (const well of ['Logo', 'Icon (favicon, apple-touch & PWA)', 'Logo (light bg)', 'Logo (dark bg)', 'Share image (OG)']) {
      expect(screen.getByRole('button', { name: `Browse for ${well}` })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('tab', { name: 'Website' }));
    const website: Array<[string, string, string]> = [
      ['Redirects', 'Redirects', '+ Add redirect'],
      ['Languages', 'Languages', '+ Add language'],
      ['Translations', 'Translations & Labels', 'Add translation'],
    ];
    for (const [tile, dialog, control] of website) {
      const sheet = await openTile(tile, dialog);
      expect(within(sheet).queryAllByLabelText(control).length + within(sheet).queryAllByRole('button', { name: control }).length, `${tile} → ${control}`).toBeGreaterThan(0);
      closeSheet(sheet);
      await waitFor(() => expect(screen.queryByRole('dialog', { name: dialog })).toBeNull());
    }
    // Inline controls live on their tiles.
    for (const label of [
      'Production URL (for sitemap.xml + robots.txt)', 'JSON data URL → {{ website.json_data }}',
      'Nav effect', 'Preloader effect', 'Sticky header mode', 'Enable back-to-top button', 'Enable scrollspy', 'Solid backdrop behind the custom preloader',
      'Content width', 'Image delivery format', 'Upload size cap in pixels', 'Enable themes', 'Default theme',
      'Publish security.txt', 'Search: match accented letters loosely', 'Enable shop', 'Enable consent manager',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Clear thumbnail cache' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit data' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accent ·/ })).toBeInTheDocument();
  });

  it('security.txt: the switch is on the tile; its contacts open in a drill-in that saves', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    fireEvent.click(await screen.findByLabelText('Publish security.txt'));
    // On, but no contact yet — the schema would refuse it, so the tile says so before the publish does.
    const tile = screen.getByRole('group', { name: 'security.txt tile' });
    expect(within(tile).getByText('No contact').closest('[data-state]')).toHaveAttribute('data-state', 'attention');
    fireEvent.click(within(tile).getByRole('button', { name: 'Edit security.txt' }));
    const sheet = await screen.findByRole('dialog', { name: 'security.txt' });
    expect(within(sheet).getByText(/Pick at least one contact/)).toBeInTheDocument();
    // No production URL in this project → said up front.
    expect(within(sheet).getByRole('alert')).toHaveTextContent(/production URL is not set/);
    // The Corporate Identity has no email, so that option is unavailable and says why; Custom is not.
    const email = within(sheet).getByRole('radiogroup', { name: 'Email' });
    expect(within(email).getByRole('radio', { name: 'Company email not set' })).toBeDisabled();
    fireEvent.click(within(email).getByRole('radio', { name: 'Custom' }));
    fireEvent.change(within(sheet).getByLabelText('Email for security.txt'), { target: { value: 'nope' } });
    expect(within(sheet).getByText(/valid email address/)).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText('Email for security.txt'), { target: { value: 'security@acme.com' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save and close' }));
    await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
    expect((putSettings.mock.calls[0]![1] as SettingsBundle).website?.security).toMatchObject({ enabled: true, email: 'security@acme.com' });
    await waitFor(() => expect(within(tile).getByText('On')).toBeInTheDocument());
    expect(tile).toHaveTextContent('own email');
  });

  it('security.txt: a stored page is never called "deleted" while the page list is loading, and a failed list can be retried', async () => {
    let release!: (v: unknown) => void;
    listPages.mockReturnValueOnce(new Promise((r) => (release = r)));
    getSettings.mockResolvedValue({ item: { ...bundle, website: { siteUrl: 'https://acme.com', security: { enabled: true, contactPageId: 'p-contact' } } } });
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit security.txt' }));
    const sheet = await screen.findByRole('dialog', { name: 'security.txt' });
    const contact = within(sheet).getByRole('combobox', { name: 'Contact page' });
    expect(contact).toHaveTextContent('Loading pages…');
    expect(contact).not.toHaveTextContent('no longer exists');
    release({ items: [{ id: 'p-contact', path: 'contact', title: 'Contact us', root: { id: 'r', type: 'Section' } }] });
    await waitFor(() => expect(contact).toHaveTextContent('Contact us — /contact/'));
  });

  it('security.txt: when the page list fails it says so and offers a retry', async () => {
    listPages.mockRejectedValueOnce(new Error('offline'));
    getSettings.mockResolvedValue({ item: { ...bundle, website: { siteUrl: 'https://acme.com', security: { enabled: true, contactPageId: 'p-contact' } } } });
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit security.txt' }));
    const sheet = await screen.findByRole('dialog', { name: 'security.txt' });
    expect(await within(sheet).findByText(/Couldn’t load this site’s pages/)).toBeInTheDocument();
    expect(within(sheet).getByRole('combobox', { name: 'Contact page' })).not.toHaveTextContent('no longer exists');
    listPages.mockResolvedValueOnce({ items: [{ id: 'p-contact', path: 'contact', title: 'Contact us', root: { id: 'r', type: 'Section' } }] });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(sheet).getByRole('combobox', { name: 'Contact page' })).toHaveTextContent('Contact us — /contact/'));
  });

  it('security.txt: the phone/email switch moves with the arrow keys, skipping an unavailable choice', async () => {
    getSettings.mockResolvedValue({ item: { ...bundle, website: { security: { enabled: true, useEmail: false } } } });
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit security.txt' }));
    const sheet = await screen.findByRole('dialog', { name: 'security.txt' });
    const email = within(sheet).getByRole('radiogroup', { name: 'Email' });
    const disabled = within(email).getByRole('radio', { name: 'Disabled' });
    expect(disabled).toHaveAttribute('tabindex', '0');
    // No company email, so the middle choice is skipped: Disabled → Custom.
    fireEvent.keyDown(disabled, { key: 'ArrowRight' });
    expect(within(email).getByRole('radio', { name: 'Custom' })).toHaveAttribute('aria-checked', 'true');
    expect(within(sheet).getByLabelText('Email for security.txt')).toBeInTheDocument();
    fireEvent.keyDown(within(email).getByRole('radio', { name: 'Custom' }), { key: 'ArrowLeft' });
    expect(within(email).getByRole('radio', { name: 'Disabled' })).toHaveAttribute('aria-checked', 'true');
  });

  it('security.txt: the contact, policy and acknowledgments are SEARCHABLE page pickers with a custom-URL option', async () => {
    listPages.mockResolvedValue({
      items: [
        { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } },
        { id: 'p-contact', path: 'contact', title: 'Contact us', root: { id: 'r2', type: 'Section' } },
        { id: 'p-policy', path: 'security-policy', title: 'Security policy', root: { id: 'r3', type: 'Section' } },
      ],
    });
    getSettings.mockResolvedValue({ item: { ...bundle, identity: { ...bundle.identity, telephone: '+49 30 1234567' }, website: { siteUrl: 'https://acme.com', security: { enabled: true, usePhone: true } } } });
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit security.txt' }));
    const sheet = await screen.findByRole('dialog', { name: 'security.txt' });
    // The phone comes from Corporate Identity and the option SHOWS the number it would publish.
    expect(within(within(sheet).getByRole('radiogroup', { name: 'Phone' })).getByRole('radio', { name: '+49 30 1234567' })).toHaveAttribute('aria-checked', 'true');
    // Contact page: search the pages, pick one.
    fireEvent.click(within(sheet).getByRole('combobox', { name: 'Contact page' }));
    fireEvent.change(await screen.findByLabelText('Search Contact page'), { target: { value: 'contact' } });
    fireEvent.click(within(await screen.findByRole('listbox', { name: 'Contact page' })).getByText('Contact us — /contact/'));
    // Policy: a custom URL instead.
    fireEvent.click(within(sheet).getByRole('combobox', { name: 'Security policy' }));
    fireEvent.click(within(await screen.findByRole('listbox', { name: 'Security policy' })).getByText('Custom URL…'));
    fireEvent.change(within(sheet).getByLabelText('Security policy URL'), { target: { value: 'https://acme.com/disclosure/' } });
    // Acknowledgments: a page.
    fireEvent.click(within(sheet).getByRole('combobox', { name: 'Acknowledgments' }));
    fireEvent.click(within(await screen.findByRole('listbox', { name: 'Acknowledgments' })).getByText('Security policy — /security-policy/'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save and close' }));
    await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
    expect((putSettings.mock.calls[0]![1] as SettingsBundle).website?.security).toEqual({
      enabled: true,
      contactPageId: 'p-contact',
      usePhone: true,
      policyUrl: 'https://acme.com/disclosure/',
      acknowledgmentsPageId: 'p-policy',
    });
  });

  it('the nav/button/preloader controls live ON their tile, and custom code still saves in its own gesture', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    const tile = await screen.findByRole('group', { name: 'Nav, buttons & preloader tile' });
    fireEvent.change(within(tile).getByLabelText('Nav effect'), { target: { value: 'none' } });
    fireEvent.click(within(tile).getAllByRole('button', { name: 'Add code' })[0]!);
    const editor = await screen.findByRole('dialog', { name: 'Custom nav effect code' });
    fireEvent.change(within(editor).getByLabelText('code'), { target: { value: '.menu a{color:red}' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
    expect((putSettings.mock.calls[0]![1] as SettingsBundle).website?.effects?.navCode).toBe('.menu a{color:red}');
    // The backdrop switch is always there, but only applies to CUSTOM preloader code.
    expect(within(tile).getByLabelText('Solid backdrop behind the custom preloader')).toBeDisabled();
    // The saved custom nav code already counts as one setting; scrollspy makes two.
    fireEvent.click(within(tile).getByLabelText('Enable scrollspy'));
    expect(within(tile).getByText('2 set')).toBeInTheDocument();
    expect(floatingSave()).toBeEnabled();
  });

  it('Delivery: every field description is a "?" beside its label, not text under the field', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    const site = await screen.findByRole('group', { name: 'Site tile' });
    for (const tip of [/publish skips sitemap\.xml/, /Public https only/, /website\.data/]) {
      expect(within(site).getByRole('button', { name: tip })).toBeInTheDocument();
    }
    expect(within(site).queryByText(/publish skips sitemap\.xml|Public https only/)).toBeNull();
    // The label still names its input, and a validation error still shows inline (an error is not help).
    const url = within(site).getByLabelText('Production URL (for sitemap.xml + robots.txt)');
    fireEvent.change(url, { target: { value: 'ftp://acme.com' } });
    expect(url).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(url.getAttribute('aria-describedby') ?? '')).toHaveTextContent(/starts with https:\/\//);

    const images = screen.getByRole('group', { name: 'Images tile' });
    expect(within(images).getByRole('button', { name: /AVIF/ })).toBeInTheDocument();
    expect(within(images).getByRole('button', { name: /full resolution/ })).toBeInTheDocument();

    // The content width tile still says which class it sets — in the "?" beside "Width".
    const width = screen.getByRole('group', { name: 'Content width tile' });
    expect(within(width).getByRole('button', { name: /\.sw-container/ })).toBeInTheDocument();
    expect(within(width).queryByText('.sw-container')).toBeNull();
  });

  it('Light / dark themes: the default-theme description is a "?" beside its label', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    const tile = await screen.findByRole('group', { name: 'Light / dark themes tile' });
    expect(within(tile).getByRole('button', { name: /The starting theme/ })).toBeInTheDocument();
    expect(within(tile).queryByText(/The starting theme|Off by default/)).toBeNull();
  });

  it('Document skeleton: the render-order note is a "?" beside <body>, and the rows are 50% taller', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    const tile = await screen.findByRole('group', { name: 'Document skeleton tile' });
    expect(within(tile).getByRole('button', { name: /Parts sit in render order/ })).toBeInTheDocument();
    expect(within(tile).getByRole('button', { name: /Critical CSS is inlined/ })).toBeInTheDocument();
    expect(within(tile).queryByText(/Parts sit in render order/)).toBeNull();
    // 32 → 48px rows, 64 → 96px sidebars, 48 → 72px head parts (jsdom has no layout: the classes are the contract).
    expect(within(tile).getByRole('button', { name: /^Edit footer/ }).className).toContain('h-12');
    expect(within(tile).getByRole('button', { name: /^Edit sidebarLeft/ }).className).toContain('h-24');
    expect(within(tile).getByRole('button', { name: /^Edit Project-wide CSS/ }).className).toContain('h-18');
  });

  it('Brand colors: the six core colours are picked on the tile, each value inside its swatch in readable text', async () => {
    renderView();
    const tile = await screen.findByRole('group', { name: 'Brand colors tile' });
    expect(screen.queryByRole('button', { name: 'Open Brand colors' })).toBeNull();
    expect(within(tile).getByText('primary').className).toContain('text-center');

    const swatch = within(tile).getByRole('button', { name: 'Pick primary color' });
    fireEvent.click(swatch);
    const picker = await screen.findByRole('dialog', { name: 'primary picker' });
    fireEvent.change(within(picker).getByLabelText('HEX'), { target: { value: '#111111' } });
    const valueText = () => within(swatch).getByText(/^#/);
    expect(valueText()).toHaveTextContent('#111111');
    expect(valueText()).toHaveStyle({ color: '#ffffff' }); // white on a dark swatch
    fireEvent.change(within(picker).getByLabelText('HEX'), { target: { value: '#fafafa' } });
    expect(valueText()).toHaveTextContent('#fafafa');
    expect(valueText()).toHaveStyle({ color: '#000000' }); // black on a light one

    // An inline edit is a pending change like any other: the floating Save persists it.
    fireEvent.click(floatingSave());
    await waitFor(() => expect(putSettings).toHaveBeenCalled());
    const saved = putSettings.mock.calls.at(-1)![1] as { identity?: { colors?: Record<string, string> } };
    expect(saved.identity?.colors?.primary).toBe('#fafafa');
  });

  it('★ switching section jumps to the top only once the old section has faded out — never over it', async () => {
    // What was on screen at each jump: the old section's panel, if it still exists, and its opacity.
    const seen: string[] = [];
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {
      const old = document.getElementById('settings-panel-identity');
      seen.push(old ? `opacity ${old.style.opacity || '1'}` : 'gone');
    });
    try {
      renderView();
      await screen.findByRole('group', { name: 'Brand colors tile' });
      fireEvent.click(screen.getByRole('tab', { name: 'Website' }));
      // Not on the click: the Identity board is still showing while it fades, and jumping now would
      // flash its top before the Website board arrives.
      expect(scrollTo).not.toHaveBeenCalled();
      await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' }));
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(seen[0]).toMatch(/^(gone|opacity 0)$/);
      expect(await screen.findByRole('group', { name: 'Site tile' })).toBeInTheDocument();
    } finally {
      scrollTo.mockRestore();
    }
  });

  it('Brand colors: custom colours open the existing drill-in', async () => {
    renderView();
    const tile = await screen.findByRole('group', { name: 'Brand colors tile' });
    fireEvent.click(within(tile).getByRole('button', { name: 'Edit custom colors' }));
    const sheet = await screen.findByRole('dialog', { name: 'Brand colors' });
    expect(within(sheet).getByRole('button', { name: '+ Add color' })).toBeInTheDocument();
  });

  it('clearing the thumbnail cache reports beside the button, which keeps naming the action', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear thumbnail cache' }));
    expect(await screen.findByText('Cleared 12 cached thumbnails.')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: 'Clear thumbnail cache' })).toBeEnabled();
  });

  it('a logo well opens the media picker and shows what was picked', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'Browse for Logo' }));
    const picker = await screen.findByRole('dialog', { name: 'Choose logo' });
    fireEvent.click(within(picker).getByRole('button', { name: 'Pick test file' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Browse for Logo' })).toHaveAttribute('data-value', '/media/acme/logo.png'));
    expect(floatingSave()).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear Logo' }));
    expect(screen.getByRole('button', { name: 'Browse for Logo' })).toHaveAttribute('data-value', '');
  });

  it('★ Translations & Labels stays reachable with ONE language — it also holds the cart and consent labels', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    const tile = await screen.findByRole('button', { name: 'Open Translations' });
    expect(tile).not.toHaveAttribute('aria-disabled');
    const sheet = await openTile('Translations', 'Translations & Labels');
    expect(within(sheet).getByRole('button', { name: /Add/ })).toBeInTheDocument();
  });

  it('the Shop and Consent modals’ “Edit Labels & Translations” opens the Translations drill-in', async () => {
    getSettings.mockResolvedValue({
      item: { ...bundle, website: { shop: { enabled: true }, consent: { enabled: true } } },
    });
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit shop settings' }));
    const shop = await screen.findByRole('dialog', { name: 'Shop settings' });
    fireEvent.click(within(shop).getByRole('button', { name: /Edit Labels & Translations/ }));
    expect(await screen.findByRole('dialog', { name: 'Translations & Labels' })).toBeInTheDocument();
    closeSheet(screen.getByRole('dialog', { name: 'Translations & Labels' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Translations & Labels' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Edit consent settings' }));
    const consent = await screen.findByRole('dialog', { name: 'Consent settings' });
    fireEvent.click(within(consent).getByRole('button', { name: /Edit Labels & Translations/ }));
    expect(await screen.findByRole('dialog', { name: 'Translations & Labels' })).toBeInTheDocument();
  });

  it('switching an opt-in off keeps its tile in place, recessed', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    const shopSwitch = await screen.findByLabelText('Enable shop');
    const tile = screen.getByRole('group', { name: 'Shop tile' });
    expect(within(tile).getByText(/until the site sells something/)).toBeInTheDocument();
    fireEvent.click(shopSwitch);
    expect(within(tile).getByRole('button', { name: 'Edit shop settings' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Shop tile' })).toBe(tile);
  });

  it('the Shop tile reports payments, and offers the Orders tab only when the project chrome says it is showing', async () => {
    getSettings.mockResolvedValue({ item: { ...bundle, website: { shop: { enabled: true } } } });
    getProjectPayment.mockResolvedValue({ binding: { gatewayId: 'stripe', mode: 'test', fields: { test: [], live: [] }, missing: [], orphaned: [], complete: true } });
    const onOpenOrders = vi.fn();
    renderView({ onOpenOrders });
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit payments' })).toHaveTextContent('Stripe Checkout · test'));
    fireEvent.click(screen.getByRole('button', { name: 'Open the Orders tab' }));
    expect(onOpenOrders).toHaveBeenCalledTimes(1);
  });

  it('★ orders that exist while payments are NOT active stay reachable from the Shop tile', async () => {
    getSettings.mockResolvedValue({ item: { ...bundle, website: { shop: { enabled: true } } } });
    getProjectPayment.mockResolvedValue({ binding: { gatewayId: 'stripe', mode: 'live', fields: { test: [], live: [] }, missing: ['secret'], orphaned: [], complete: false } });
    listTransactions.mockResolvedValue({ items: [], total: 3 });
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit payments' })).toHaveTextContent('keys incomplete'));
    expect(screen.queryByRole('button', { name: 'Open the Orders tab' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Open orders' }));
    expect(await screen.findByRole('dialog', { name: 'Orders' })).toBeInTheDocument();
  });

  it('a member who may not read payments still gets a working Shop tile', async () => {
    getSettings.mockResolvedValue({ item: { ...bundle, website: { shop: { enabled: true } } } });
    getProjectPayment.mockRejectedValue(new FakeApiError(403, 'insufficient role for this operation'));
    listTransactions.mockRejectedValue(new FakeApiError(403, 'insufficient role for this operation'));
    renderView();
    fireEvent.click(await screen.findByRole('tab', { name: 'Website' }));
    expect(await screen.findByRole('button', { name: 'Edit payments' })).toHaveTextContent('—');
    expect(screen.getByRole('button', { name: 'Edit shop settings' })).toBeEnabled();
  });
});

// The CSS-tokens tile is the UI half of identity.cssTokens: without it, a token an AGENT writes is
// invisible and uneditable in the editor, and the only feedback on a refused value is a Zod error at
// save time. Its inline message must agree with the schema — both consult isSafeCssTokenValue.
describe('SettingsView — CSS tokens', () => {
  it('lists stored tokens on the tile and as editable rows, and saves an edit', async () => {
    getSettings.mockResolvedValue({
      item: { ...bundle, identity: { ...bundle.identity, cssTokens: { 'grad-hero': 'linear-gradient(135deg,#06f,#0cf)' } } },
    });
    renderView();
    expect(await screen.findByRole('button', { name: 'Open CSS tokens' })).toHaveTextContent('--sw-grad-hero');
    const sheet = await openTile('CSS tokens');
    const value = within(sheet).getByLabelText('linear-gradient(135deg,#06f,#0cf) 1');
    expect(value).toHaveValue('linear-gradient(135deg,#06f,#0cf)');
    fireEvent.change(value, { target: { value: 'linear-gradient(90deg,#000,#fff)' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save and close' }));
    await waitFor(() => expect(putSettings).toHaveBeenCalled());
    expect(putSettings.mock.calls[0]![1].identity.cssTokens).toEqual({ 'grad-hero': 'linear-gradient(90deg,#000,#fff)' });
  });

  it('explains a REFUSED value inline, and the tile flags it before the save fails', async () => {
    getSettings.mockResolvedValue({ item: { ...bundle, identity: { ...bundle.identity, cssTokens: { g: '#fff' } } } });
    renderView();
    const sheet = await openTile('CSS tokens');
    const value = within(sheet).getByLabelText('linear-gradient(135deg,#06f,#0cf) 1');
    fireEvent.change(value, { target: { value: 'url(https://evil.test/x.png)' } });
    expect(within(sheet).getByRole('alert')).toHaveTextContent(/url\(\) and other resource functions/);
    expect(value).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Open CSS tokens' })).toHaveTextContent('1 invalid');
    // …and a value the schema accepts clears the warning.
    fireEvent.change(value, { target: { value: '0 2px 5px rgba(0,0,0,.2)' } });
    expect(within(sheet).queryByRole('alert')).toBeNull();
  });
});
