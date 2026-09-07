import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { api, isOwnContentChange } from '../src/api';
import { useExternalEdit } from '../src/lib/use-external-edit';
import { ExternalChangeBanner } from '../src/views/ui/ExternalChangeBanner';
import type { ContentChange } from '../src/lib/use-project-events';

/** A fetch stub that records requests and replies with `{ item, version }`. */
function stubFetch(version: string) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const mock = vi.fn((url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify({ item: { id: 'home', path: '', title: 'Home' }, version }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', mock);
  return calls;
}
const lastIfMatch = (calls: Array<{ init: RequestInit }>): string | undefined =>
  (calls.at(-1)?.init.headers as Record<string, string> | undefined)?.['if-match'];

afterEach(() => vi.unstubAllGlobals());

describe('content version tracking (If-Match)', () => {
  it('remembers the version from a GET and sends it on the next full-replace PUT', async () => {
    const calls = stubFetch('v-one');
    await api.getPage('p1', 'home');
    expect(lastIfMatch(calls)).toBeUndefined(); // the GET itself carries none
    await api.putPage('p1', { id: 'home', path: '', title: 'Home' } as never);
    expect(lastIfMatch(calls)).toBe('v-one');
  });

  it('does NOT send If-Match on a ?merge=1 PATCH — a merge is applied to whatever is current', async () => {
    const calls = stubFetch('v-one');
    await api.getSettings('p1');
    await api.patchWebsiteSettings('p1', { containerWidth: '900px' } as never);
    expect(calls.at(-1)?.url).toContain('merge=1');
    expect(lastIfMatch(calls)).toBeUndefined();
  });

  it('keys versions per entity — one page never arms another page write', async () => {
    const calls = stubFetch('v-home');
    await api.getPage('p1', 'home');
    await api.putPage('p1', { id: 'about', path: 'about', title: 'About' } as never);
    expect(lastIfMatch(calls)).toBeUndefined(); // `about` was never read
  });

  it('recognises our OWN version and not someone else’s', async () => {
    stubFetch('v-mine');
    await api.getPage('p2', 'home');
    expect(isOwnContentChange('p2', 'page', 'home', 'v-mine')).toBe(true);
    expect(isOwnContentChange('p2', 'page', 'home', 'v-theirs')).toBe(false);
    expect(isOwnContentChange('p2', 'page', 'home', undefined)).toBe(false);
  });

  it('drops the remembered version on a 409 so the next attempt is not judged against a dead token', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let phase: 'ok' | 'conflict' = 'ok';
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit = {}) => {
        calls.push({ url, init });
        if (phase === 'conflict') {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'changed', code: 'version_conflict' }), {
              status: 409,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ item: {}, version: 'v-stale' }), { status: 200, headers: { 'content-type': 'application/json' } }),
        );
      }),
    );
    await api.getPage('p3', 'home');
    phase = 'conflict';
    await expect(api.putPage('p3', { id: 'home', path: '', title: 'X' } as never)).rejects.toMatchObject({ status: 409, code: 'version_conflict' });
    expect(lastIfMatch(calls)).toBe('v-stale');
    // The token is gone now, so a blind retry is not rejected against the version we know is dead.
    phase = 'ok';
    await api.putPage('p3', { id: 'home', path: '', title: 'X' } as never);
    expect(lastIfMatch(calls)).toBeUndefined();
  });
});

describe('a sibling surface writing the same entity (the criticalCss revert)', () => {
  /** One stub for the whole flow: the version it returns depends on the request, like the server. */
  function versionedFetch(versionFor: (url: string, init: RequestInit) => string) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit = {}) => {
        calls.push({ url, init });
        return Promise.resolve(
          new Response(JSON.stringify({ item: {}, version: versionFor(url, init) }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }),
    );
    return calls;
  }
  const sent = (c: { init: RequestInit } | undefined): string | undefined =>
    (c?.init.headers as Record<string, string> | undefined)?.['if-match'];

  /**
   * REGRESSION. Settings, the Critical CSS shortcut and the skeleton/button-effect fields all write the
   * SAME settings singleton, but the shortcut goes through `?merge=1` while Settings does a full
   * replace. Reported 2026-09-07: save CSS via the shortcut, then change skeleton code + button
   * effects, and the CSS was gone — because the merge re-pointed the shared store and Settings' stale
   * save then passed the check with a token describing something it had never held.
   */
  it('a ?merge=1 write does NOT re-arm the shared store', async () => {
    const calls = versionedFetch((url) => (url.includes('merge=1') ? 'v1-from-merge' : 'v0'));
    await api.getSettings('p1'); // the form is built from v0
    await api.patchWebsiteSettings('p1', { criticalCss: '.hero{}' } as never);
    expect(calls.at(-1)?.url).toContain('merge=1');
    expect(sent(calls.at(-1))).toBeUndefined(); // a merge is never guarded
    await api.putSettings('p1', {} as never);
    // ★ Still v0 — the version the form actually holds — so the server can refuse the stale save.
    expect(sent(calls.at(-1))).toBe('v0');
  });

  it('an explicit base beats the shared store, and null disables the guard for one call', async () => {
    const calls = versionedFetch(() => 'v-shared');
    await api.getSettings('p2');
    await api.putSettings('p2', {} as never, 'v-my-own-form');
    expect(sent(calls.at(-1))).toBe('v-my-own-form');
    await api.putSettings('p2', {} as never, null);
    expect(sent(calls.at(-1))).toBeUndefined();
  });

  it('reads still arm the store, so a view without its own base keeps working', async () => {
    const calls = versionedFetch(() => 'v-read');
    await api.getPage('p3', 'home');
    await api.putPage('p3', { id: 'home' } as never);
    expect(sent(calls.at(-1))).toBe('v-read');
  });
});

/**
 * `useExternalEdit` drives the whole clean/dirty decision, so it is tested against a FAKE event
 * stream rather than through a view: the module that owns the EventSource is mocked and we push
 * changes by hand.
 */
let emit: ((c: ContentChange) => void) | null = null;
vi.mock('../src/lib/use-project-events', () => ({
  useProjectEvents: (_projectId: string, listener: (c: ContentChange) => void) => {
    emit = listener;
  },
}));

function Harness({
  dirty,
  onRefresh,
  base,
  saving,
}: {
  dirty: boolean;
  onRefresh: () => void;
  /** Present → the view tracks its own base and must ignore the tab-wide store. */
  base?: string;
  saving?: boolean;
}) {
  const ext = useExternalEdit({
    projectId: 'p9',
    match: (c) => c.kind === 'page' && c.entityId === 'home',
    isDirty: () => dirty,
    onRefresh,
    ...(base === undefined ? {} : { baseVersion: () => base, isSaving: () => saving ?? false }),
  });
  return ext.pending ? (
    <ExternalChangeBanner change={ext.pending} label="This page" onReload={ext.reload} onDismiss={ext.dismiss} />
  ) : (
    <p>no notice</p>
  );
}

describe('useExternalEdit', () => {
  const change: ContentChange = { kind: 'page', entityId: 'home', op: 'put', actor: 'agent', version: 'v-theirs' };

  it('refreshes SILENTLY when the buffer is clean — nothing of the operator’s to lose', () => {
    const onRefresh = vi.fn();
    render(<Harness dirty={false} onRefresh={onRefresh} />);
    act(() => emit?.(change));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText('no notice')).toBeInTheDocument();
  });

  it('NEVER auto-replaces a dirty buffer — it asks instead', () => {
    const onRefresh = vi.fn();
    render(<Harness dirty onRefresh={onRefresh} />);
    act(() => emit?.(change));
    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('"Load their version" refreshes and clears the notice; "Keep mine" only clears it', () => {
    const onRefresh = vi.fn();
    const { rerender } = render(<Harness dirty onRefresh={onRefresh} />);
    act(() => emit?.(change));
    fireEvent.click(screen.getByRole('button', { name: /Load their version/ }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText('no notice')).toBeInTheDocument();

    rerender(<Harness dirty onRefresh={onRefresh} />);
    act(() => emit?.(change));
    fireEvent.click(screen.getByRole('button', { name: /Keep mine/ }));
    expect(onRefresh).toHaveBeenCalledTimes(1); // unchanged — the local buffer is kept
    expect(screen.getByText('no notice')).toBeInTheDocument();
  });

  it('ignores our own write whose SSE echo BEATS the HTTP response — the ordering a real browser has', async () => {
    // The server emits the change event while handling the PUT, so the event routinely lands before
    // fetch() resolves and the new version is recorded. Before this was handled, every editor save
    // raised a "someone changed this" banner about the operator themselves (25 browser specs failed).
    let resolveResponse!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            resolveResponse = r;
          }),
      ),
    );
    const onRefresh = vi.fn();
    render(<Harness dirty onRefresh={onRefresh} />);

    const saving = api.putPage('p9', { id: 'home', path: '', title: 'Home' } as never);
    // …event arrives FIRST, carrying a version this client has never seen.
    act(() => emit?.({ kind: 'page', entityId: 'home', op: 'put', version: 'v-brand-new' }));
    expect(screen.getByText('no notice')).toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();

    resolveResponse(
      new Response(JSON.stringify({ item: {}, version: 'v-brand-new' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await saving;
    // A LATER event from someone else must still get through.
    act(() => emit?.({ kind: 'page', entityId: 'home', op: 'put', version: 'v-someone-else' }));
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it("a view with its OWN base is notified about a sibling surface's write", async () => {
    // The half that let the criticalCss revert through unseen: the shared store had already jumped to
    // the sibling's version, so the view concluded "that was us" and never refreshed. Judged against
    // its own base, a version it has never held is someone else's change - which it is.
    const onRefresh = vi.fn();
    // Arm the TAB-WIDE store with the sibling's version, exactly as its write would. This is what made
    // the old check answer "mine" — without it the test would pass even unfixed.
    stubFetch('v-from-the-shortcut');
    await api.getPage('p9', 'home');
    expect(isOwnContentChange('p9', 'page', 'home', 'v-from-the-shortcut')).toBe(true); // the shared store says "ours"…
    render(<Harness dirty={false} onRefresh={onRefresh} base="v-my-form" saving={false} />);
    act(() => emit?.({ kind: 'page', entityId: 'home', op: 'put', version: 'v-from-the-shortcut' }));
    expect(onRefresh).toHaveBeenCalledTimes(1); // …but THIS view never held it, so it refreshes anyway
  });

  it('ignores an event describing the state it already holds', () => {
    const onRefresh = vi.fn();
    render(<Harness dirty onRefresh={onRefresh} base="v-current" saving={false} />);
    act(() => emit?.({ kind: 'page', entityId: 'home', op: 'put', version: 'v-current' }));
    expect(screen.getByText('no notice')).toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('stays quiet while ITS OWN save is in flight, whatever version the echo carries', () => {
    // The echo beats the response, so `base` is still the pre-save version when the event lands.
    const onRefresh = vi.fn();
    render(<Harness dirty onRefresh={onRefresh} base="v-before-save" saving />);
    act(() => emit?.({ kind: 'page', entityId: 'home', op: 'put', version: 'v-after-save' }));
    expect(screen.getByText('no notice')).toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('ignores changes to OTHER entities', () => {
    const onRefresh = vi.fn();
    render(<Harness dirty={false} onRefresh={onRefresh} />);
    act(() => emit?.({ kind: 'page', entityId: 'about', op: 'put' }));
    act(() => emit?.({ kind: 'snippet', entityId: 'home', op: 'put' }));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('ignores the ECHO OF OUR OWN WRITE, so a save never warns the author about themselves', async () => {
    stubFetch('v-mine');
    await api.getPage('p9', 'home'); // arms the store with v-mine for p9/page/home
    const onRefresh = vi.fn();
    render(<Harness dirty onRefresh={onRefresh} />);
    act(() => emit?.({ kind: 'page', entityId: 'home', op: 'put', version: 'v-mine' }));
    expect(screen.getByText('no notice')).toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe('ExternalChangeBanner', () => {
  it('names the actor and offers both non-destructive outcomes', () => {
    const onReload = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ExternalChangeBanner
        change={{ kind: 'page', entityId: 'home', op: 'put', actor: 'agent' }}
        label="This page"
        onReload={onReload}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('an agent');
    fireEvent.click(screen.getByRole('button', { name: /Load their version/ }));
    expect(onReload).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Keep mine/ }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('says "someone else" when the change carries no actor, and reports a delete as deleted', () => {
    render(
      <ExternalChangeBanner
        change={{ kind: 'page', entityId: 'home', op: 'delete' }}
        label="This page"
        onReload={() => {}}
        onDismiss={() => {}}
      />,
    );
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).toContain('someone else');
    expect(text).toContain('deleted');
  });

  it('renders nothing until a change is pending', () => {
    const { container } = render(<Harness dirty onRefresh={() => {}} />);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
