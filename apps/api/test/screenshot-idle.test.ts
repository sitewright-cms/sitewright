import { afterEach, describe, expect, it, vi } from 'vitest';
import { _setBrowserForTest, closeScreenshotBrowser, getBrowser, releaseIdleBrowser } from '../src/render/screenshot.js';

/**
 * When the shared screenshot browser may be closed to make room for an audit. Closing it under a capture
 * fails that capture, so it is only ever closed when nothing has a context open AND nobody has been
 * handed it recently (a capture takes the browser before it queues for a render slot). Driven with a
 * stand-in browser, so this runs without Chromium.
 */

function fakeBrowser(openContexts = 0) {
  return { contexts: () => new Array(openContexts).fill({}), close: vi.fn(async () => {}) };
}

afterEach(async () => {
  _setBrowserForTest(null, 0);
  await closeScreenshotBrowser();
});

describe('releaseIdleBrowser', () => {
  it('closes a browser nobody is using and nobody has been handed for a while — once', async () => {
    const b = fakeBrowser();
    _setBrowserForTest(Promise.resolve(b), Date.now() - 60_000);
    expect(await releaseIdleBrowser()).toBe(true);
    expect(b.close).toHaveBeenCalledOnce();
    expect(await releaseIdleBrowser(), 'nothing left to close').toBe(false);
  });

  it('★ never closes a browser with an open context — that is a capture in flight', async () => {
    const b = fakeBrowser(1);
    _setBrowserForTest(Promise.resolve(b), Date.now() - 60_000);
    expect(await releaseIdleBrowser()).toBe(false);
    expect(b.close).not.toHaveBeenCalled();
  });

  it('★ never closes a browser handed out recently — its caller may still be queued for a slot', async () => {
    const b = fakeBrowser();
    _setBrowserForTest(Promise.resolve(b), Date.now() - 1_000);
    expect(await releaseIdleBrowser()).toBe(false);
    expect(b.close).not.toHaveBeenCalled();
  });

  it('a browser handed out WHILE the release was waiting for it is left alone', async () => {
    const b = fakeBrowser();
    let resolve!: (v: typeof b) => void;
    _setBrowserForTest(new Promise((r) => (resolve = r)), Date.now() - 60_000);
    const releasing = releaseIdleBrowser();
    const taken = getBrowser(); // a capture takes it — stamping it as used — before the release sees the browser
    resolve(b);
    await taken;
    expect(await releasing).toBe(false);
    expect(b.close).not.toHaveBeenCalled();
  });
});
