import { test, expect, type Frame } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();

/**
 * The scroll-reveal runtime, driven in a real browser against the live preview.
 *
 * ★ Why this is not a unit test. `packages/blocks/test/animations.test.ts` has 30+ tests and every one
 * of them asserts the runtime's SOURCE TEXT. Two separate defects shipped straight past that suite:
 * a flicker loop at the top edge (#900), and — introduced by its fix — elements that stayed at opacity
 * 0 for good once you scrolled back up to them. Both are properties of IntersectionObserver geometry
 * under real scrolling, which no string match and no jsdom can see. So this suite scrolls, and reads
 * computed opacity off the rendered page.
 *
 * The two properties pull against each other, which is exactly how fixing one broke the other, so both
 * are asserted here in one file: nothing may re-trigger while the reader is still (A), and everything
 * must end up visible once the reader is looking at it (B).
 */

// fade-up and slide-up are the two that carry a DOWNWARD hidden transform (4rem and a full element
// height), which is what feeds the flicker; fade-left has none, and is the control that isolates it.
const EFFECTS = ['fade-up', 'slide-up', 'fade-left'] as const;
const GAP = 1200; // taller than the preview viewport, so only one element is ever in view

const PAGE = `<div class="p-0">
${EFFECTS.map(
  (e) =>
    `<div style="height:${GAP}px"></div><div id="${e}" data-sw-animation="${e}" style="height:200px;background:#4f46e5"></div>`,
).join('')}
<div style="height:${GAP}px"></div></div>`;

async function writePage(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(PAGE);
  await expect(page.frameLocator('iframe[title="Preview"]').locator('#fade-left')).toBeAttached();
}

/** The preview document — it scrolls on <body>, which is its own IntersectionObserver root. */
const frameOf = async (page: import('@playwright/test').Page): Promise<Frame> =>
  (await (await page.locator('iframe[title="Preview"]').elementHandle())!.contentFrame())!;

const scrollTo = (f: Frame, y: number) =>
  f.evaluate((v) => {
    const s = getComputedStyle(document.body).overflowY === 'auto' ? document.body : document.documentElement;
    s.scrollTop = v;
  }, y);

/**
 * Wait until the scroller has actually STOPPED.
 *
 * The published/preview page sets `scroll-behavior: smooth`, so assigning `scrollTop` starts an
 * animation rather than jumping. A fixed wait after it is not "the reader is holding still" — it is
 * "the page is still gliding", and the reveals that legitimately fire during that glide look exactly
 * like the self-triggering loop this file exists to catch. (Measured: 4 scroll events and 4 class
 * changes inside a supposed hold, all of them correct.) So sample the position until it repeats.
 */
async function waitForScrollIdle(f: Frame) {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const y = await f.evaluate(() =>
      Math.round((getComputedStyle(document.body).overflowY === 'auto' ? document.body : document.documentElement).scrollTop),
    );
    if (y === last) return y;
    last = y;
    await f.waitForTimeout(100);
  }
  return last;
}

const docTopOf = (f: Frame, id: string) =>
  f.evaluate((i) => {
    let t = 0;
    let n: HTMLElement | null = document.getElementById(i);
    while (n) { t += n.offsetTop || 0; n = n.offsetParent as HTMLElement | null; }
    return t;
  }, id);

const opacityOf = (f: Frame, id: string) =>
  f.evaluate((i) => getComputedStyle(document.getElementById(i)!).opacity, id);

/** Come to rest with the element centred, in small steps — a single jump can skip observer callbacks. */
async function settleOn(f: Frame, id: string) {
  const top = await docTopOf(f, id);
  const vh = await f.evaluate(() => window.innerHeight);
  const from = await f.evaluate(() => (getComputedStyle(document.body).overflowY === 'auto' ? document.body : document.documentElement).scrollTop);
  const target = Math.max(0, top + 100 - vh / 2);
  for (let k = 1; k <= 10; k++) {
    await scrollTo(f, Math.round(from + ((target - from) * k) / 10));
    await f.waitForTimeout(50);
  }
  await waitForScrollIdle(f);
  await f.waitForTimeout(900); // the reveal transition is 450ms by default
}

test('scroll animations: every element is visible once you scroll back UP to it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUp(page, `anim-up-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Anim Site');
  await page.getByLabel('Project slug').fill(`anim-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await writePage(page);

  const f = await frameOf(page);

  // ── First encounter, reading downwards. This direction always worked; it is the control that says
  //    the runtime is alive and the markup is right, so a failure below means the DIRECTION, not setup.
  for (const e of EFFECTS) {
    await settleOn(f, e);
    expect(await opacityOf(f, e), `${e} should reveal on the way down`).not.toBe('0');
  }

  // ── Scroll past everything, then come back UP to each element in turn.
  //    ★ This is the reported defect: the reveal observer fires exactly once as an element enters, and
  //    a reveal declined at that instant used to be declined forever — the element stayed invisible
  //    with the reader looking straight at it. Measured before the fix: fade-up and slide-up stuck in
  //    every configuration tried, on this very surface.
  await scrollTo(f, await f.evaluate(() => document.body.scrollHeight));
  await f.waitForTimeout(400);
  for (const e of [...EFFECTS].reverse()) {
    await settleOn(f, e);
    expect(await opacityOf(f, e), `★ ${e} must not stay invisible after scrolling back up to it`).not.toBe('0');
  }
});

test('scroll animations: nothing re-triggers while the reader is holding still', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUp(page, `anim-flick-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Flicker Site');
  await page.getByLabel('Project slug').fill(`flick-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await writePage(page);

  const f = await frameOf(page);
  await f.evaluate(() => {
    (window as unknown as { __swFlips: number }).__swFlips = 0;
    for (const id of ['fade-up', 'slide-up']) {
      const el = document.getElementById(id)!;
      new MutationObserver(() => { (window as unknown as { __swFlips: number }).__swFlips++; }).observe(el, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
  });

  // Settling is not looping, and the test has to tell them apart. Arriving at a new position
  // legitimately produces a state change or two as the observers catch up; the defect produced them
  // WITHOUT END (36-144 in 1.5s when it was live). So wait for quiescence first, then hold and count.
  const flips = () => f.evaluate(() => (window as unknown as { __swFlips: number }).__swFlips);
  async function waitForQuiet() {
    for (let i = 0; i < 30; i++) {
      const before = await flips();
      await f.waitForTimeout(300);
      if ((await flips()) === before) return;
    }
  }

  // ★ Park just past the top edge and hold. The hidden state's transform is DOWNWARD (fade-up 4rem,
  // slide-up a full height), so an element that resets here used to be shoved back into the region
  // that triggers it — reveal, transform off, snap out, reset, forever. The band that matters is the
  // reach of each effect's own transform, so sweep it rather than testing one distance.
  const top = await docTopOf(f, 'slide-up');
  await waitForQuiet(); // the preview re-renders after the edit; let that finish before measuring
  for (const past of [0, 30, 60, 120, 220]) {
    await scrollTo(f, top + 200 + past); // the element sits fully above the fold by `past` px
    await waitForScrollIdle(f); // `scroll-behavior: smooth` — assigning scrollTop only STARTS the move
    await waitForQuiet();
    await f.evaluate(() => ((window as unknown as { __swFlips: number }).__swFlips = 0));
    await f.waitForTimeout(1500); // hold still — a stationary reader must see a stationary page
    expect(
      await flips(),
      `★ ${past}px past the top edge: the page kept changing state while nobody scrolled`,
    ).toBe(0);
  }
});
