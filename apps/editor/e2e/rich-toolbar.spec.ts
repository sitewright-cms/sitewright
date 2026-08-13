import { test, expect, type Page } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();

/**
 * The dataset richtext WYSIWYG toolbar, driven the way an author drives it, asserting what an author
 * SEES — the computed style of the styled text — not that a class was written.
 *
 * That distinction is the whole point of this spec. Every one of these controls already "worked": it
 * captured the selection, wrapped it in a `<span>`, and set the right Tailwind class. It just did
 * nothing on screen, because the editor SPA's stylesheet is compiled from the editor's OWN source and
 * never sees a class the toolbar applies at runtime — so a utility had a rule only when the editor
 * chrome happened to use the same one somewhere else. 14 of 44 had none at all. A test that asserted
 * `toHaveClass('text-red-600')` would have passed throughout.
 */

/** Sign in, create a project, and give it a dataset with a single `richtext` field. */
async function openRichTextEntry(page: Page, key: string): Promise<void> {
  await signUp(page, `${key}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Rich Site');
  await page.getByLabel('Project slug').fill(key);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: 'Open Datasets' }).click();
  await page.getByRole('button', { name: 'New dataset' }).click();
  await expect(page.getByLabel('Dataset name')).toBeVisible();
  await page.getByLabel('Dataset name').fill('Posts');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: /schema/ }).click();
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByLabel('New field name').fill('body');
  await page.getByLabel('New field type').selectOption('richtext');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Save schema' }).click();

  await page.getByRole('button', { name: 'New entry' }).click();
  await expect(page.getByRole('textbox', { name: 'body' })).toBeVisible();
}

const editable = (page: Page) => page.getByRole('textbox', { name: 'body' });

/** Type `text` into the editable and select all of it, leaving a live selection for the toolbar. */
async function typeAndSelectAll(page: Page, text: string): Promise<void> {
  const el = editable(page);
  await el.click();
  await el.fill(''); // clear any placeholder state
  await page.keyboard.type(text);
  await page.keyboard.press('ControlOrMeta+a');
}

/** The computed value of `prop` on the element carrying `cls` inside the editable. */
async function computed(page: Page, cls: string, prop: string): Promise<string> {
  return page.evaluate(
    ({ cls, prop }) => {
      const el = document.querySelector<HTMLElement>(`[role="textbox"] .${CSS.escape(cls)}`);
      if (!el) throw new Error(`no element carrying .${cls} in the editable`);
      return getComputedStyle(el).getPropertyValue(prop);
    },
    { cls, prop },
  );
}

test('a text colour changes the rendered colour, not just the class', async ({ page }) => {
  await openRichTextEntry(page, `rtcolor-${stamp}`);
  await typeAndSelectAll(page, 'colour me');

  const before = await editable(page).evaluate((el) => getComputedStyle(el).color);
  await page.getByRole('button', { name: 'Text color' }).click();
  await page.getByRole('button', { name: 'Red', exact: true }).click();

  // The class landed…
  await expect(editable(page).locator('.text-red-600')).toHaveCount(1);
  // …AND it paints. Tailwind emits red-600 in oklch; assert it MOVED and is genuinely reddish.
  const after = await computed(page, 'text-red-600', 'color');
  expect(after).not.toBe(before);
  // Tailwind emits palette colours in oklch, and `getComputedStyle` hands back the oklch string —
  // so resolve to real sRGB bytes through a canvas rather than scraping numbers out of the notation.
  const [r, g, b] = await page.evaluate((c) => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const [rr, gg, bb] = ctx.getImageData(0, 0, 1, 1).data;
    return [rr, gg, bb] as [number, number, number];
  }, after);
  expect(r, `expected a red, got rgb(${r},${g},${b})`).toBeGreaterThan(150);
  expect(r).toBeGreaterThan(g + 60);
  expect(r).toBeGreaterThan(b + 60);
});

test('a highlight paints a background', async ({ page }) => {
  await openRichTextEntry(page, `rthigh-${stamp}`);
  await typeAndSelectAll(page, 'highlight me');

  await page.getByRole('button', { name: 'Highlight' }).click();
  await page.getByRole('button', { name: 'Yellow', exact: true }).click();

  const bg = await computed(page, 'bg-yellow-200', 'background-color');
  // The pre-fix build had NO `bg-yellow-200` rule at all — the span was transparent.
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(bg).not.toBe('transparent');
});

test('every step of the size scale renders a DIFFERENT size (Tiny is not Small)', async ({ page }) => {
  await openRichTextEntry(page, `rtsize-${stamp}`);

  // Tiny and Small were both 14px in the field: the editor's own readability floor lifts `--text-xs`
  // to 0.875rem for chrome, and that leaked into author content — two menu steps, one rendered size.
  const sizeOf = async (label: string, cls: string): Promise<number> => {
    await typeAndSelectAll(page, `size ${label}`);
    await page.getByRole('button', { name: 'Text size' }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
    const px = await computed(page, cls, 'font-size');
    return parseFloat(px);
  };

  const tiny = await sizeOf('Tiny', 'text-xs');
  const small = await sizeOf('Small', 'text-sm');
  const large = await sizeOf('Large', 'text-lg');
  const huge = await sizeOf('6XL', 'text-6xl');

  expect(tiny).toBeCloseTo(12, 1); // the SITE's scale, not the editor chrome's 14px floor
  expect(small).toBeCloseTo(14, 1);
  expect(tiny).toBeLessThan(small);
  expect(small).toBeLessThan(large);
  expect(large).toBeLessThan(huge);
  expect(huge).toBeCloseTo(60, 1); // the top of the scale actually reaches 60px
});

test('alignment and indent move the block', async ({ page }) => {
  await openRichTextEntry(page, `rtblock-${stamp}`);
  await typeAndSelectAll(page, 'align me');

  await page.getByRole('button', { name: 'Alignment' }).click();
  await page.getByRole('button', { name: 'Justify', exact: true }).click();
  // `text-justify` had no rule before — the block stayed `start`.
  expect(await computed(page, 'text-justify', 'text-align')).toBe('justify');

  // Indent four times to reach the deepest step (pl-16), which also had no rule.
  await editable(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Increase indent' }).click();
  expect(parseFloat(await computed(page, 'pl-16', 'padding-left'))).toBeCloseTo(64, 1);
});

test("a brand colour renders the PROJECT's brand, not the editor's default palette", async ({ page }) => {
  const key = `rtbrand-${stamp}`;
  await signUp(page, `${key}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Brand Site');
  await page.getByLabel('Project slug').fill(key);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Set a brand primary that is nothing like the editor chrome's default indigo, so "resolved to the
  // editor default" and "resolved to this project's brand" cannot be mistaken for each other.
  const projectId = await page.evaluate(async () => {
    const r = await fetch('/projects', { credentials: 'include' });
    return (await r.json()).projects[0].id as string;
  });
  // The settings singleton is content, addressed by the entity id `settings` — NOT `/projects/<id>/settings`.
  const ok = await page.evaluate(async (id) => {
    const url = `/projects/${id}/content/settings/settings`;
    const cur = await (await fetch(url, { credentials: 'include' })).json();
    const identity = { ...(cur.item?.identity ?? {}), colors: { ...(cur.item?.identity?.colors ?? {}), primary: '#ff0090' } };
    const res = await fetch(url, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...(cur.item ?? {}), identity }),
    });
    return res.ok;
  }, projectId);
  expect(ok, 'setting the brand primary').toBe(true);
  // The CI palette + its stylesheet are fetched once per opened project, so reload to pick up the new
  // brand — which drops back to the project selector, hence re-opening it here.
  await page.reload();
  const datasets = page.getByRole('button', { name: 'Open Datasets' });
  if (!(await datasets.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Brand Site' }).first().click();
  }
  await datasets.click();
  await page.getByRole('button', { name: 'New dataset' }).click();
  await page.getByLabel('Dataset name').fill('Posts');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: /schema/ }).click();
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByLabel('New field name').fill('body');
  await page.getByLabel('New field type').selectOption('richtext');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Save schema' }).click();
  await page.getByRole('button', { name: 'New entry' }).click();

  await typeAndSelectAll(page, 'brand me');
  await page.getByRole('button', { name: 'Text color' }).click();
  await page.getByRole('button', { name: 'Primary', exact: true }).click();

  // #ff0090. Before, this resolved to the editor's own DaisyUI default primary in every project.
  expect(await computed(page, 'text-primary', 'color')).toBe('rgb(255, 0, 144)');
});

test('a font slot renders in the brand face', async ({ page }) => {
  await openRichTextEntry(page, `rtfont-${stamp}`);
  await typeAndSelectAll(page, 'font me');

  const before = await editable(page).evaluate((el) => getComputedStyle(el).fontFamily);
  await page.getByRole('button', { name: 'Font', exact: true }).click();
  await page.getByRole('button', { name: 'Heading', exact: true }).click();

  // `font-heading` had NO rule in the editor sheet — the control was a complete no-op.
  const after = await computed(page, 'font-heading', 'font-family');
  expect(after).not.toBe(before);
  expect(after.toLowerCase()).toContain('serif'); // the platform default heading slot
});

test('the active state is visible in dark mode, and hovering it does not wash it out', async ({ page }) => {
  await openRichTextEntry(page, `rtdark-${stamp}`);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await typeAndSelectAll(page, 'bold me');
  const bold = page.getByRole('button', { name: 'Bold' });
  await bold.click();

  // Two traps this measurement has to avoid, both of which read as "the fix didn't work":
  //  1. `.transition` animates background-color, so reading it straight after the click returns the
  //     START of the transition — fully transparent.
  //  2. Playwright leaves the pointer ON the button it clicked, and a `hover:` utility outranks the
  //     active fill, so the resting look is never what a hovered read reports.
  await page.mouse.move(0, 0);
  const alphaOf = async (): Promise<number> => {
    const bg = await bold.evaluate((el) => getComputedStyle(el).backgroundColor);
    const parts = bg.match(/[\d.]+/g)!.map(Number);
    return parts.length > 3 ? parts[3]! : 1;
  };
  await expect.poll(alphaOf, { message: 'active background never settled to an opaque fill' }).toBeGreaterThan(0.85);

  // …and it STAYS readable while the pointer is on it (a translucent hover used to win here).
  await bold.hover();
  await expect.poll(alphaOf, { message: 'hovering an active button washed the active state out' }).toBeGreaterThan(0.85);
});

test('re-typing after clearing formatted text does not strand an inline style over the class', async ({ page }) => {
  await openRichTextEntry(page, `rtinline-${stamp}`);

  // contentEditable carries a deleted run's "typing style" into newly typed text as inline CSS. An
  // inline declaration beats a utility class, so every later size pick would set a class that changes
  // nothing — reached by nothing more exotic than select-all, delete, type again.
  await typeAndSelectAll(page, 'first');
  await page.getByRole('button', { name: 'Text size' }).click();
  await page.getByRole('button', { name: 'Tiny', exact: true }).click();

  await editable(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('second');
  await page.keyboard.press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'Text size' }).click();
  await page.getByRole('button', { name: '4XL', exact: true }).click();

  expect(parseFloat(await computed(page, 'text-4xl', 'font-size'))).toBeCloseTo(36, 1);
  expect(await editable(page).evaluate((el) => el.innerHTML)).not.toContain('font-size');
});
