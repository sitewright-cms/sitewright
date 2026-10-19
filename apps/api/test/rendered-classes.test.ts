import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_RENDERED_CLASS_TOKENS,
  relinkStylesheet,
  renderedClassHarvest,
  renderedStylesheetVersion,
} from '../src/publish/rendered-classes.js';

describe('renderedClassHarvest', () => {
  it('keeps only the classes the source scan did not already find, sorted', () => {
    const harvest = renderedClassHarvest(['p-6', 'flex']);
    expect(harvest.add(['<div class="p-6 bg-rose-600 flex">x</div>', undefined, '<nav class="menu active"></nav>'])).toBe(true);
    expect(harvest.extras()).toEqual(['active', 'bg-rose-600', 'menu']);
  });

  it('says whether the page carries ANY class — known ones included — and ignores empty markup', () => {
    const harvest = renderedClassHarvest(['flex']);
    expect(harvest.add(['<div class="flex">x</div>'])).toBe(true); // needs the sheet, adds nothing new
    expect(harvest.add(['<p>plain</p>', '', undefined])).toBe(false);
    expect(harvest.extras()).toEqual([]);
  });

  it('dedupes across pages and stops growing at the cap', () => {
    const harvest = renderedClassHarvest([], 3);
    harvest.add(['<i class="a b"></i>']);
    harvest.add(['<i class="b c d e"></i>']);
    expect(harvest.extras()).toEqual(['a', 'b', 'c']);
    expect(MAX_RENDERED_CLASS_TOKENS).toBeGreaterThanOrEqual(2048); // never tighter than one page's own cap
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
