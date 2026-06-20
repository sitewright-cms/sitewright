import { describe, it, expect } from 'vitest';
import { parse } from '../src/dom.js';
import { collectAndHostScripts } from '../src/transform/scripts.js';
import type { MediaPort } from '../src/types.js';

function pages(...htmls: string[]): { url: string; doc: ReturnType<typeof parse> }[] {
  return htmls.map((h, i) => ({ url: `https://ex.com/p${i}`, doc: parse(`<html><body>${h}</body></html>`) }));
}

/** Records every hostScript arg + returns a unique /media URL per call (null hostAsset — unused here). */
function recordingPort(): { port: MediaPort; calls: Array<{ code?: string; url?: string }> } {
  const calls: Array<{ code?: string; url?: string }> = [];
  const port: MediaPort = {
    hostAsset: async () => null,
    hostScript: async (arg) => {
      calls.push(arg);
      return `/media/proj/id${calls.length}/script.js`;
    },
  };
  return { port, calls };
}

describe('collectAndHostScripts', () => {
  it('hosts inline + external scripts in order, deduped, and emits self-hosted <script src> links', async () => {
    const { port, calls } = recordingPort();
    const html = `
      <script src="https://cdn.ex.com/lib.js"></script>
      <script>initMenu();</script>
      <script type="application/ld+json">{"@type":"X"}</script>
      <script src="https://cdn.ex.com/lib.js"></script>`; // duplicate external → deduped
    const out = await collectAndHostScripts(pages(html, html), port); // 2 pages, identical → still deduped
    expect(calls).toEqual([{ url: 'https://cdn.ex.com/lib.js' }, { code: 'initMenu();' }]); // ld+json skipped, deduped
    expect(out).toBe('<script src="/media/proj/id1/script.js" defer></script>\n<script src="/media/proj/id2/script.js" defer></script>');
  });

  it('drops all scripts when the media port has no hostScript (the safe default)', async () => {
    const noJs: MediaPort = { hostAsset: async () => null };
    expect(await collectAndHostScripts(pages('<script>x()</script>'), noJs)).toBe('');
  });
});
