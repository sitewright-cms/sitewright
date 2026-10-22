import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revealSettingsTile, settingsTileSelector } from '../src/lib/settings-links';

/**
 * A link to a Website Settings tile: the board draws only after the settings load, so the reveal WAITS for the tile,
 * then scrolls it to the middle of the screen and outlines it for a moment.
 */

const scrolled: Element[] = [];

/** An inline board tile as board/Tile.tsx draws it: the group named "<title> tile". */
function addTile(title: string): HTMLElement {
  const tile = document.createElement('div');
  tile.setAttribute('role', 'group');
  tile.setAttribute('aria-label', `${title} tile`);
  document.body.appendChild(tile);
  return tile;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe('revealSettingsTile', () => {
  it('names each tile by the group its board draws', () => {
    expect(settingsTileSelector('analytics')).toBe('[role="group"][aria-label="Analytics tile"]');
    expect(settingsTileSelector('search-engines')).toBe('[role="group"][aria-label="Search engines tile"]');
  });

  it('waits for the tile, then brings it into view and outlines it for a moment', async () => {
    revealSettingsTile('search-engines');
    await vi.advanceTimersByTimeAsync(500);
    expect(scrolled).toHaveLength(0);
    addTile('Analytics'); // another tile is not the one asked for
    const tile = addTile('Search engines');
    await vi.advanceTimersByTimeAsync(50);
    expect(scrolled).toEqual([tile]);
    expect(tile).toHaveAttribute('data-sw-reveal');
    await vi.advanceTimersByTimeAsync(2100);
    expect(tile).not.toHaveAttribute('data-sw-reveal');
  });

  it('reveals a tile that is already there', async () => {
    const tile = addTile('Analytics');
    revealSettingsTile('analytics');
    await vi.advanceTimersByTimeAsync(50);
    expect(scrolled).toEqual([tile]);
  });

  it('does nothing once cancelled, and gives up when the tile never comes', async () => {
    const cancel = revealSettingsTile('analytics');
    cancel();
    addTile('Analytics');
    await vi.advanceTimersByTimeAsync(50);
    expect(scrolled).toHaveLength(0);

    document.body.innerHTML = '';
    revealSettingsTile('analytics', 1000);
    await vi.advanceTimersByTimeAsync(1100);
    addTile('Analytics');
    await vi.advanceTimersByTimeAsync(50);
    expect(scrolled).toHaveLength(0);
  });
});
