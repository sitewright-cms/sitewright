import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUtilityProbe, type UtilityProbe } from '@sitewright/tailwind';
import {
  MAX_RENDERED_CLASS_TOKENS,
  relinkStylesheet,
  renderedClassHarvest,
  renderedStylesheetVersion,
} from '../src/publish/rendered-classes.js';

/** The real probe, loaded once for the file, and a counter of how often the harvest asked for one. */
let real: Promise<UtilityProbe> | undefined;
function probeOpts(): { probe: () => Promise<UtilityProbe>; loads: () => number } {
  let loads = 0;
  return {
    probe: () => {
      loads += 1;
      real ??= createUtilityProbe({});
      return real;
    },
    loads: () => loads,
  };
}

describe('renderedClassHarvest', () => {
  it('keeps only the render-only classes that compile to a rule, sorted', async () => {
    const opts = probeOpts();
    const harvest = renderedClassHarvest(['p-6', 'flex'], opts);
    const page = await harvest.add(['<div class="p-6 bg-rose-600 flex wp-image-7">x</div>', undefined, '<ul class="menu aligncenter"></ul>']);
    expect(page).toBe(true);
    expect(harvest.utilities()).toEqual(['bg-rose-600', 'menu']);
    expect(harvest.stats()).toEqual({ utilities: 2, droppedUtilities: 0, cappedScans: 0 });
  });

  it('a page whose extra classes are all junk or already in the source needs no sheet', async () => {
    const harvest = renderedClassHarvest(['flex'], probeOpts());
    expect(await harvest.add(['<div class="flex wp-block-image aligncenter">x</div>'])).toBe(false);
    expect(await harvest.add(['<p>plain</p>', '', undefined])).toBe(false);
    expect(harvest.utilities()).toEqual([]);
  });

  it('never loads the probe for platform classes alone — they are judged without a compiler', async () => {
    const opts = probeOpts();
    const harvest = renderedClassHarvest([], opts);
    expect(await harvest.add(['<svg class="sw-icon sw-icon-caret-down"></svg><a class="sw-btn-fx-lift">x</a>'])).toBe(true);
    expect(harvest.utilities()).toEqual(['sw-btn-fx-lift']); // an effect scheme compiles (outside Tailwind)
    expect(opts.loads()).toBe(0);
  });

  it('★ junk can never crowd a utility out of the cap — only utilities count toward it', async () => {
    const harvest = renderedClassHarvest([], { ...probeOpts(), max: 2 });
    // An imported page full of per-image classes, BEFORE the page carrying the real utilities.
    const junk = Array.from({ length: 500 }, (_, i) => `wp-image-${i}`).join(' ');
    await harvest.add([`<div class="${junk}">x</div>`]);
    await harvest.add(['<div class="bg-rose-600 grid">x</div>']);
    expect(harvest.utilities()).toEqual(['bg-rose-600', 'grid']);
    // A third utility is past the cap: dropped, and counted once however many pages carry it.
    expect(await harvest.add(['<i class="p-4"></i>'])).toBe(true);
    await harvest.add(['<i class="p-4"></i>']);
    expect(harvest.stats()).toEqual({ utilities: 2, droppedUtilities: 1, cappedScans: 0 });
    expect(MAX_RENDERED_CLASS_TOKENS).toBeGreaterThanOrEqual(2048); // never tighter than one page's own cap
  });

  it('counts a scan that hit extractClassNames’ per-call cap', async () => {
    const harvest = renderedClassHarvest([], probeOpts());
    const many = Array.from({ length: 2100 }, (_, i) => `w-${i}`).join(' ');
    await harvest.add([`<div class="${many}">x</div>`]);
    expect(harvest.stats().cappedScans).toBe(1);
  });
});

describe('renderedStylesheetVersion', () => {
  it('is deterministic, follows the CSS, and keeps the token length', () => {
    const v = renderedStylesheetVersion('0123456789abcdef', '.a{}');
    expect(v).toMatch(/^[0-9a-f]{16}$/);
    expect(renderedStylesheetVersion('0123456789abcdef', '.a{}')).toBe(v);
    expect(renderedStylesheetVersion('0123456789abcdef', '.b{}')).not.toBe(v);
    expect(renderedStylesheetVersion('fedcba9876543210', '.a{}')).not.toBe(v);
  });
});

describe('relinkStylesheet', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sw-relink-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('re-points every link to the sheet and leaves pages without one untouched', async () => {
    const a = join(dir, 'a.html');
    const b = join(dir, 'b.html');
    const page = '<link rel="stylesheet" href="_assets/_sw/styles.css?v=aaaaaaaaaaaaaaaa"><script src="_assets/_sw/core.js?v=aaaaaaaaaaaaaaaa"></script>';
    await writeFile(a, page, 'utf8');
    await writeFile(b, '<p>error page</p>', 'utf8');
    const changed = await relinkStylesheet([a, b], 'styles.css?v=aaaaaaaaaaaaaaaa', 'styles.css?v=bbbbbbbbbbbbbbbb');
    expect(changed).toBe(1);
    // Only the sheet moves — the script sharing the old token keeps it.
    expect(await readFile(a, 'utf8')).toBe(page.replace('styles.css?v=aaaaaaaaaaaaaaaa', 'styles.css?v=bbbbbbbbbbbbbbbb'));
    expect(await readFile(b, 'utf8')).toBe('<p>error page</p>');
  });

  it('refuses a replacement that would change a page’s byte count', async () => {
    await expect(relinkStylesheet([], 'styles.css?v=aa', 'styles.css?v=bbb')).rejects.toThrow(/length/);
  });
});
