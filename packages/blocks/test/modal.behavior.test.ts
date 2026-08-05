// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { componentAssets } from '../src/components.js';

// Behavioral coverage for the modal's WIDTH GUARANTEE. A width the class split cannot recognise by
// NAME — a project CSS class (`.bng-modal{max-width:680px}`), an id rule, an inline style — sizes the
// CARD while the PANEL keeps its 32rem default. The panel is what centres the card and what the close
// button hangs off, so the card ends up off-centre with the close sitting inside it. String-contains
// assertions can't prove the correction fires, so run the REAL shipped runtime against stubbed
// geometry: jsdom has no layout, so each part reports the width its CSS would have produced.
const PANEL_DEFAULT = 512; // 32rem, the platform default
const CARD_WIDE = 680; // what the author's own CSS makes the card

const MODAL_JS = componentAssets(['Modal']).js;

function rect(width: number): DOMRect {
  return { width, height: 200, top: 0, left: 0, right: width, bottom: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}

/** Mount a marked <dialog>, run the runtime, and stub the geometry the author's CSS would produce:
 *  the panel measures its inline width when one is pinned, else the platform default; the card
 *  measures `cardWidth`, or the panel's width when it has none of its own (the `width:100%` default). */
function mount(cardWidth: number | null): { dialog: HTMLDialogElement; panel: HTMLElement; card: HTMLElement } {
  document.body.innerHTML = '<a href="#m">open</a><dialog id="m" data-sw-component="modal"><p>hi</p></dialog>';
  const dialog = document.getElementById('m') as HTMLDialogElement;
  // jsdom implements showModal() but not the top layer; `open` is what the runtime keys on.
  dialog.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  dialog.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  (0, eval)(MODAL_JS);
  const panel = dialog.querySelector('[data-sw-part="panel"]') as HTMLElement;
  const card = panel.querySelector('[data-sw-part="body"]') as HTMLElement;
  const panelWidth = (): number => (panel.style.width ? parseFloat(panel.style.width) : PANEL_DEFAULT);
  panel.getBoundingClientRect = () => rect(panelWidth());
  card.getBoundingClientRect = () => rect(cardWidth ?? panelWidth());
  return { dialog, panel, card };
}

describe('Modal width guarantee (jsdom)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('pins the panel to a card widened by CSS the class split cannot see', () => {
    const { panel } = mount(CARD_WIDE);
    // Nothing to measure while shut — the dialog is display:none, so no premature pin.
    expect(panel.style.width).toBe('');
    (document.querySelector('a[href="#m"]') as HTMLElement).click();
    // Both properties: the :where() default max-width:32rem would clamp a bare width straight back down.
    expect(panel.style.width).toBe(`${CARD_WIDE}px`);
    expect(panel.style.maxWidth).toBe(`${CARD_WIDE}px`);
  });

  it('leaves a card that fits the panel alone (no pointless pin)', () => {
    const { panel } = mount(null); // the default card: width:100% of whatever the panel is
    (document.querySelector('a[href="#m"]') as HTMLElement).click();
    expect(panel.style.width).toBe('');
    expect(panel.style.maxWidth).toBe('');
  });

  it('FOLLOWS the card back down when a resize narrows it (never pinned to a stale number)', () => {
    // A card sized in vw: 680 at first, narrower after the viewport shrinks.
    let card = CARD_WIDE;
    const { panel } = mount(CARD_WIDE);
    const cardEl = panel.querySelector('[data-sw-part="body"]') as HTMLElement;
    cardEl.getBoundingClientRect = () => rect(card);
    (document.querySelector('a[href="#m"]') as HTMLElement).click();
    expect(panel.style.width).toBe(`${CARD_WIDE}px`);
    card = 560; // still wider than the 512 default, so the pin FOLLOWS it down rather than sticking at 680
    window.dispatchEvent(new Event('resize'));
    expect(panel.style.width).toBe('560px');
    // …and all the way back to no pin at all once the card fits inside the default again.
    card = 300;
    window.dispatchEvent(new Event('resize'));
    expect(panel.style.width).toBe('');
    expect(panel.style.maxWidth).toBe('');
  });

  it('clamps a card wider than the container, so the overhanging close is never clipped away', () => {
    const { dialog, panel, card } = mount(CARD_WIDE);
    // The container is 600 wide with the platform's 2rem gutter → 536 of content box. A 680 card would
    // put the close (which overhangs 1.5rem past the card) off the edge, where overflow-x:hidden eats it.
    dialog.style.padding = '32px';
    Object.defineProperty(dialog, 'clientWidth', { value: 600, configurable: true });
    (document.querySelector('a[href="#m"]') as HTMLElement).click();
    expect(card.style.maxWidth).toBe('536px');
    expect(card.style.minWidth).toBe('0'); // an author's INLINE min-width would otherwise beat the clamp
    expect(panel.style.width).toBe('536px');
  });

  it('clamps the PANEL too — a min-width the panel cannot shrink away from strands the close off-screen', () => {
    // The panel is a flex item, so a plain over-wide `width` shrinks to the container on its own. A
    // recognised `min-w-*` utility does NOT (min-width outranks width and blocks flex shrinking), so the
    // panel stayed wider than the container while the card was correctly clamped — and the close, anchored
    // to the PANEL's corner, ended up hundreds of px off-screen. Measured live before this clamp existed:
    // at a 420px viewport a `min-w-[900px]` panel put the close 598px past the card.
    const { dialog, panel, card } = mount(null);
    dialog.style.padding = '32px';
    Object.defineProperty(dialog, 'clientWidth', { value: 420, configurable: true });
    // The panel reports its unshrinkable min-width while nothing has pinned it; the card fills it.
    panel.getBoundingClientRect = () => rect(panel.style.width ? parseFloat(panel.style.width) : 900);
    card.getBoundingClientRect = () => rect(panel.getBoundingClientRect().width);
    (document.querySelector('a[href="#m"]') as HTMLElement).click();
    expect(panel.style.width).toBe('356px'); // 420 − 2×32 of gutter
    expect(panel.style.maxWidth).toBe('356px');
    expect(panel.style.minWidth).toBe('0'); // the author's min-width is released, or the width can't land
    expect(card.style.maxWidth).toBe('356px');
  });

  it('releases the clamp when the container grows back', () => {
    const { dialog, panel, card } = mount(CARD_WIDE);
    dialog.style.padding = '32px';
    Object.defineProperty(dialog, 'clientWidth', { value: 600, configurable: true });
    (document.querySelector('a[href="#m"]') as HTMLElement).click();
    expect(card.style.maxWidth).toBe('536px');
    Object.defineProperty(dialog, 'clientWidth', { value: 1400, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(card.style.maxWidth).toBe(''); // the author's own 680 fits again — no platform clamp left on it
    expect(panel.style.width).toBe(`${CARD_WIDE}px`);
  });

  it('syncs an open driven by author script (showModal direct), not just our own trigger', async () => {
    const { dialog, panel } = mount(CARD_WIDE);
    dialog.showModal();
    // The attribute MutationObserver lands on the microtask checkpoint — before paint, after this tick.
    await Promise.resolve();
    expect(panel.style.width).toBe(`${CARD_WIDE}px`);
  });

  it('measures the modal’s OWN card, never a nested component’s same-named part', () => {
    // A Tabs inside a modal has its own [data-sw-part="panel"]s; a descendant query would find those.
    document.body.innerHTML =
      '<a href="#n">open</a><dialog id="n" data-sw-component="modal">' +
      '<div data-sw-component="tabs"><div data-sw-part="panel"><div data-sw-part="body">tab</div></div></div>' +
      '</dialog>';
    const dialog = document.getElementById('n') as HTMLDialogElement;
    dialog.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    (0, eval)(MODAL_JS);
    const panels = dialog.querySelectorAll('[data-sw-part="panel"]');
    expect(panels.length).toBe(2); // the modal's own, plus the tab panel it wrapped
    const own = dialog.children[0] as HTMLElement; // the modal's panel is the dialog's direct child
    const nested = panels[1] as HTMLElement;
    own.getBoundingClientRect = () => rect(PANEL_DEFAULT);
    (own.children[0] as HTMLElement).getBoundingClientRect = () => rect(CARD_WIDE);
    nested.getBoundingClientRect = () => rect(99);
    (document.querySelector('a[href="#n"]') as HTMLElement).click();
    expect(own.style.width).toBe(`${CARD_WIDE}px`);
    expect(nested.style.width).toBe('');
  });
});
