// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { componentAssets } from '../src/components.js';

// The REAL shipped Image Map runtime, driven from OUTSIDE the map through the documented
// `data-sw-imap-*` attributes, exactly as a published page runs it.
//
// jsdom has no layout, so every rect is 0×0 — which is enough here: a tooltip anchored to its
// HOTSPOT then lands at one fixed spot, while a tooltip anchored to the POINTER moves with the
// pointer's coordinates. That difference is the bug: on a map with sticky tooltips (four of the five
// bundled templates) a trigger opened the tooltip at a zero-size anchor under the pointer — i.e. on
// top of the trigger itself, which then lost the hover and closed it again, over and over.
const RUNTIME = componentAssets(['ImageMap']).js;

type Obj = Record<string, unknown>;
const rect = (id: string, title: string, extra: Obj = {}): Obj => ({
  id, title, type: 'rect', x: 10, y: 20, width: 25, height: 30,
  tooltip_content: [{ type: 'Paragraph', text: `${title} tooltip` }],
  ...extra,
});
const artboard = (id: string, title: string, children: Obj[]): Obj => ({
  id, title, background_type: 'color', width: 800, height: 600, children,
});

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Mount one map + trigger buttons, run the runtime, and wait until the map has initialised. */
async function mount(config: Obj, triggers: string): Promise<void> {
  document.body.innerHTML =
    `<div data-sw-component="image-map"><script type="application/json" data-sw-part="config">${JSON.stringify(config)}</script></div>` +
    `<div id="list">${triggers}</div>`;
  // Indirect eval of our own trusted build-output constant, in the global scope.
  (0, eval)(RUNTIME);
  for (let i = 0; i < 50 && !document.querySelector('.sw-imap-tooltips-container'); i++) await wait(10);
  await wait(50);
  // A real visitor's pointer has crossed the page long before they reach a trigger. The map's FIRST
  // mousemove ever releases every highlight asynchronously; let that settle so it cannot race a test.
  pointerAt(990, 690);
  await wait(60);
}

/** The pointer moving over the page at clientX/Y (over the trigger list, outside the map). */
function pointerAt(x: number, y: number): void {
  document.getElementById('list')!.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
}

/** Tooltips currently shown: [text, left of their positioned wrap]. */
function shown(): Array<[string, string]> {
  return Array.from(document.querySelectorAll<HTMLElement>('.sw-imap-tooltip'))
    .filter((t) => t.style.display === 'inline-block')
    .map((t) => [t.textContent!.trim(), (t.parentNode as HTMLElement).style.left]);
}

describe('Image map — external triggers (jsdom)', () => {
  beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  });
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const STICKY = { general: { name: 'Floor' }, tooltips: { sticky_tooltips: true }, artboards: [artboard('a1', 'Ground', [rect('o1', 'Studio A')])] };
  const PLAIN = { ...STICKY, tooltips: { sticky_tooltips: false } };

  /** Where the tooltip sits when it is anchored to its hotspot — the plain (non-sticky) map. */
  async function hotspotAnchor(trigger: string): Promise<string> {
    await mount(PLAIN, trigger);
    pointerAt(650, 30);
    document.getElementById('t')!.click();
    await wait(120);
    const [first] = shown();
    if (!first) throw new Error('reference tooltip did not open');
    return first[1];
  }

  for (const attr of ['trigger-object', 'show-tooltip']) {
    it(`${attr}-on-click opens the tooltip AT ITS HOTSPOT on a sticky-tooltip map, and it stays there`, async () => {
      const trigger = `<button id="t" data-sw-imap-${attr}-on-click="Studio A">Studio A</button>`;
      const anchor = await hotspotAnchor(trigger);
      await mount(STICKY, trigger);
      pointerAt(650, 30);
      document.getElementById('t')!.click();
      await wait(120);
      expect(shown()).toEqual([['Studio A tooltip', anchor]]);
      // The pointer moving on over the page must not drag it away (a sticky map re-positions every
      // open tooltip on each mousemove).
      pointerAt(900, 60);
      await wait(60);
      expect(shown()).toEqual([['Studio A tooltip', anchor]]);
    });

    it(`${attr}-on-mouseover opens it at its hotspot too, and mouseout closes it`, async () => {
      const trigger = `<button id="t" data-sw-imap-${attr}-on-mouseover="Studio A">Studio A</button>`;
      const anchor = await hotspotAnchor(trigger.replace('-on-mouseover', '-on-click'));
      await mount(STICKY, trigger);
      const t = document.getElementById('t')!;
      pointerAt(650, 30);
      t.dispatchEvent(new MouseEvent('mouseover', { clientX: 650, clientY: 30, bubbles: true }));
      await wait(120);
      pointerAt(660, 32);
      await wait(60);
      expect(shown()).toEqual([['Studio A tooltip', anchor]]);
      t.dispatchEvent(new MouseEvent('mouseout', { clientX: 990, clientY: 690, bubbles: true }));
      await wait(120);
      expect(shown()).toEqual([]);
    });
  }

  describe('the pin lifecycle — a pin lasts only while the trigger-opened tooltip does', () => {
    /** The pointer ON a hotspot inside the map (what the map's own hover handling sees). */
    function hoverHotspot(id: string, x: number, y = 120): void {
      document.querySelector(`[data-object-id="${id}"]`)!.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
    }
    /** Hover a hotspot at two pointer positions: where its (sticky) tooltip sat each time. */
    async function followsPointer(id: string): Promise<[string, string]> {
      hoverHotspot(id, 200);
      await wait(120);
      const a = shown()[0]?.[1] ?? 'closed';
      hoverHotspot(id, 260);
      await wait(60);
      return [a, shown()[0]?.[1] ?? 'closed'];
    }
    const TWO = {
      ...STICKY,
      artboards: [artboard('a1', 'Ground', [rect('o1', 'Studio A'), rect('o2', 'Studio B', { x: 55 })])],
    };

    it('closing the trigger-opened tooltip releases the pin: hovering that hotspot in the map follows the pointer again', async () => {
      await mount(
        TWO,
        '<button id="t" data-sw-imap-trigger-object-on-click="Studio A">A</button>' +
          '<button id="u" data-sw-imap-untrigger-object-on-click="Studio A">close A</button>',
      );
      document.getElementById('t')!.click();
      await wait(120);
      expect(shown()).toEqual([['Studio A tooltip', '0px']]);
      document.getElementById('u')!.click();
      await wait(120);
      expect(shown()).toEqual([]);
      const [first, second] = await followsPointer('o1');
      expect(first).not.toBe('closed');
      expect(second).not.toBe(first); // sticky again: it moved with the pointer
    });

    it('switching floors releases the pin', async () => {
      const floors = {
        ...STICKY,
        artboards: [artboard('a1', 'Ground', [rect('o1', 'Studio A')]), artboard('a2', 'First', [rect('o2', 'Studio B')])],
      };
      await mount(
        floors,
        '<button id="t" data-sw-imap-trigger-object-on-click="Studio A">A</button>' +
          '<button id="first" data-sw-imap-change-artboard="First">First</button>' +
          '<button id="ground" data-sw-imap-change-artboard="Ground">Ground</button>',
      );
      document.getElementById('t')!.click();
      await wait(120);
      expect(shown()).toEqual([['Studio A tooltip', '0px']]);
      document.getElementById('first')!.click();
      await wait(150);
      expect(shown()).toEqual([]);
      document.getElementById('ground')!.click();
      await wait(150);
      const [first, second] = await followsPointer('o1');
      expect(first).not.toBe('closed');
      expect(second).not.toBe(first);
    });

    it('a second trigger replaces the first: its tooltip opens pinned at ITS hotspot, and the first one is released', async () => {
      await mount(
        TWO,
        '<button id="a" data-sw-imap-trigger-object-on-mouseover="Studio A">A</button>' +
          '<button id="b" data-sw-imap-trigger-object-on-mouseover="Studio B">B</button>',
      );
      const a = document.getElementById('a')!;
      const b = document.getElementById('b')!;
      a.dispatchEvent(new MouseEvent('mouseover', { clientX: 650, clientY: 30, bubbles: true }));
      await wait(120);
      a.dispatchEvent(new MouseEvent('mouseout', { clientX: 650, clientY: 52, bubbles: true }));
      b.dispatchEvent(new MouseEvent('mouseover', { clientX: 650, clientY: 52, bubbles: true }));
      await wait(150);
      pointerAt(700, 60);
      await wait(60);
      expect(shown()).toEqual([['Studio B tooltip', '0px']]);
      b.dispatchEvent(new MouseEvent('mouseout', { clientX: 990, clientY: 690, bubbles: true }));
      await wait(120);
      const [first, second] = await followsPointer('o1');
      expect(first).not.toBe('closed');
      expect(second).not.toBe(first);
    });

    it('an in-map hover that lands while a trigger-opened tooltip is still open un-pins it', async () => {
      // A keyboard-activated trigger while the pointer is already moving onto the same hotspot: the
      // trigger's tooltip opens (pinned) between the map's own hide and its own show, so the map's
      // show finds it ALREADY open — and must still release the pin, or the tooltip stays frozen at
      // the hotspot while the pointer moves over it.
      await mount(TWO, '<button id="t" data-sw-imap-trigger-object-on-click="Studio A">A</button>');
      document.getElementById('t')!.click();
      hoverHotspot('o1', 200);
      await wait(150);
      const at = shown()[0]?.[1];
      hoverHotspot('o1', 260);
      await wait(60);
      expect(shown()).toHaveLength(1);
      expect(shown()[0]![1]).not.toBe(at);
    });
  });

  it("a trigger naming a GROUP opens the group's own tooltip (it used to never get there)", async () => {
    const config = {
      general: { name: 'Floor' },
      artboards: [artboard('a1', 'Ground', [
        {
          id: 'g1', title: 'West wing', type: 'group',
          tooltip_content: [{ type: 'Paragraph', text: 'West wing tooltip' }],
          children: [rect('o2', 'Studio B', { parent_id: 'g1', tooltip_content: [] })],
        },
      ])],
    };
    await mount(config, '<button id="g" data-sw-imap-trigger-object-on-click="West wing">West wing</button>');
    document.getElementById('g')!.click();
    await wait(150);
    expect(shown().map(([text]) => text)).toEqual(['West wing tooltip']);
  });

  it('a hotspot that shares its title with an ARTBOARD is the one a trigger acts on', async () => {
    // A floor plan's overview hotspot is naturally named after the floor's own artboard ("First").
    // The lookup matched the artboard, so the trigger switched floors and showed nothing.
    const config = {
      general: { name: 'Building' },
      artboards: [artboard('ov', 'Overview', [rect('f1', 'First')]), artboard('fp', 'First', [rect('ap', 'Apartment 1A')])],
    };
    await mount(config, '<button id="t" data-sw-imap-trigger-object-on-click="First">First</button>');
    document.getElementById('t')!.click();
    await wait(150);
    expect(shown().map(([text]) => text)).toEqual(['First tooltip']);
  });

  it('a trigger that names a GROUP no longer stops every later trigger on the page from working', async () => {
    // Highlighting a (non-single) group returned from inside a Promise executor without settling,
    // which wedged the action queue that awaits it: every trigger after it did nothing, for good.
    const config = {
      general: { name: 'Floor' },
      artboards: [artboard('a1', 'Ground', [
        { id: 'g1', title: 'West wing', type: 'group', children: [rect('o2', 'Studio B', { parent_id: 'g1' })] },
        rect('o1', 'Studio A'),
      ])],
    };
    await mount(
      config,
      '<button id="g" data-sw-imap-trigger-object-on-click="West wing">West wing</button>' +
        '<button id="t" data-sw-imap-trigger-object-on-click="Studio A">Studio A</button>',
    );
    document.getElementById('g')!.click();
    await wait(150);
    document.getElementById('t')!.click();
    await wait(150);
    expect(shown().map(([text]) => text)).toEqual(['Studio A tooltip']);
  });
});
