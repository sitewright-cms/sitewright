import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { api, isCurrentContentVersion } from '../src/api';
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
    expect(isCurrentContentVersion('p2', 'page', 'home', 'v-mine')).toBe(true);
    expect(isCurrentContentVersion('p2', 'page', 'home', 'v-theirs')).toBe(false);
    expect(isCurrentContentVersion('p2', 'page', 'home', undefined)).toBe(false);
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

function Harness({ dirty, onRefresh }: { dirty: boolean; onRefresh: () => void }) {
  const ext = useExternalEdit({
    projectId: 'p9',
    match: (c) => c.kind === 'page' && c.entityId === 'home',
    isDirty: () => dirty,
    onRefresh,
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
