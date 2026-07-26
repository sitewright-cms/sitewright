// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, waitFor, act } from '@testing-library/react';

// jsdom has no WebGL and no canvas 2d context, so mock the shader engine (shaderRenderer non-null) and
// stub the canvas 2d context + rAF, so the render-loop effect runs past its `if (!ctx) return` guard and
// we can assert its lifecycle (class toggle, observer/listener/RAF cleanup, StrictMode no-leak).
vi.mock('../src/lib/shader-engine', () => ({
  shaderRenderer: () => ({ canvas: document.createElement('canvas'), draw: () => true }),
  paletteFromSlots: () => ({ c1: [0, 0, 0], c2: [0, 0, 0], c3: [0, 0, 0] }),
  editorIsDark: () => false,
}));

import { api } from '../src/api';
import { PlatformBackground, PLATFORM_BG_EVENT } from '../src/views/PlatformBackground';

const CONFIG = { preset: 'mesh-gradient', angle: 0, colors: ['primary', 'secondary', 'auto'] as [string, string, string] };
const hasClass = () => document.documentElement.classList.contains('sw-platform-bg');
const canvas = () => document.querySelector('canvas.sw-platform-canvas');

let rafCancel: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // A fake 2d context so the render-loop effect proceeds past `getContext('2d')`.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  rafCancel = vi.fn();
  vi.stubGlobal('cancelAnimationFrame', rafCancel);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove('sw-platform-bg');
});

describe('PlatformBackground', () => {
  it('renders the canvas + adds the sw-platform-bg class once the config loads', async () => {
    vi.spyOn(api, 'loginConfig').mockResolvedValue({ oidcProviders: [], branding: {} as never, platformBackground: CONFIG });
    render(<PlatformBackground />);
    await waitFor(() => expect(canvas()).not.toBeNull());
    expect(hasClass()).toBe(true);
  });

  it('is inert (no canvas, no class) when no platform background is configured', async () => {
    const spy = vi.spyOn(api, 'loginConfig').mockResolvedValue({ oidcProviders: [], branding: {} as never, platformBackground: null });
    render(<PlatformBackground />);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(canvas()).toBeNull();
    expect(hasClass()).toBe(false);
  });

  it('removes the class + canvas when an admin clears it (refetch on the change event)', async () => {
    const spy = vi.spyOn(api, 'loginConfig').mockResolvedValue({ oidcProviders: [], branding: {} as never, platformBackground: CONFIG });
    render(<PlatformBackground />);
    await waitFor(() => expect(hasClass()).toBe(true));
    // now the admin clears it → next fetch returns null
    spy.mockResolvedValue({ oidcProviders: [], branding: {} as never, platformBackground: null });
    act(() => window.dispatchEvent(new Event(PLATFORM_BG_EVENT)));
    await waitFor(() => expect(hasClass()).toBe(false));
    expect(canvas()).toBeNull();
  });

  it('cleans up on unmount (removes the class + the visibilitychange listener, cancels the RAF)', async () => {
    vi.spyOn(api, 'loginConfig').mockResolvedValue({ oidcProviders: [], branding: {} as never, platformBackground: CONFIG });
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<PlatformBackground />);
    await waitFor(() => expect(hasClass()).toBe(true));
    expect(add.mock.calls.filter((c) => c[0] === 'visibilitychange').length).toBeGreaterThan(0);
    unmount();
    expect(hasClass()).toBe(false);
    expect(remove.mock.calls.filter((c) => c[0] === 'visibilitychange').length).toBeGreaterThan(0);
    expect(rafCancel).toHaveBeenCalled();
  });

  it('StrictMode double-invoke leaves exactly one active visibilitychange listener (no leak)', async () => {
    vi.spyOn(api, 'loginConfig').mockResolvedValue({ oidcProviders: [], branding: {} as never, platformBackground: CONFIG });
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    render(
      <StrictMode>
        <PlatformBackground />
      </StrictMode>,
    );
    await waitFor(() => expect(hasClass()).toBe(true));
    const added = add.mock.calls.filter((c) => c[0] === 'visibilitychange').length;
    const removed = remove.mock.calls.filter((c) => c[0] === 'visibilitychange').length;
    // StrictMode mounts→cleans up→remounts in dev; the net must be one active listener, proving the
    // first invocation's cleanup ran (no duplicate observers/listeners leak).
    expect(added - removed).toBe(1);
  });
});
