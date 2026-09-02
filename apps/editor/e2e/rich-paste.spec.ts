import { test, expect, type Page } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();

/**
 * Pasting from a word processor into the two rich-text surfaces.
 *
 * The clipboard cannot be primed with `text/html` from Playwright (the OS clipboard is not reachable
 * and `navigator.clipboard.write` needs a user gesture plus permissions the headless shell will not
 * grant), so each spec dispatches a real `ClipboardEvent` carrying a `DataTransfer` — the same event
 * object the browser delivers, through the same handler, with the same `preventDefault` semantics.
 * What is asserted is the OUTCOME in the editable, which is the part that was ever in doubt.
 */

// What Word actually puts on the clipboard: its own class names, its own namespaced elements, and a
// font stack on every run — none of which mean anything on a Sitewright page.
const WORD_HTML = `
<html xmlns:o="urn:schemas-microsoft-com:office:office">
<meta name=Generator content="Microsoft Word 15">
<body><div class=WordSection1>
<p class=MsoNormal style='margin:0cm;font-size:11.0pt;font-family:"Calibri",sans-serif'>
<span style='font-family:"Times New Roman",serif;color:black'>Quarterly report</span></p>
<p class=MsoNormal><span style='font-weight:bold;font-family:"Calibri"'>Revenue rose</span><o:p></o:p></p>
<p class=MsoNormal>&nbsp;</p>
<p class=MsoNormal style='text-align:center'><span style='color:#DC2626'>See appendix</span></p>
</div></body></html>`;

/** Dispatch a paste carrying `html` onto the element `selector` resolves to, inside `root`. */
async function pasteInto(page: Page, selector: string, html: string, text = ''): Promise<void> {
  await page.evaluate(
    ({ selector, html, text }) => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) throw new Error(`no element for ${selector}`);
      el.focus();
      const dt = new DataTransfer();
      if (html) dt.setData('text/html', html);
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    { selector, html, text },
  );
}

/** Sign in, create a project, and give it a dataset with a single `richtext` field. */
async function openRichTextEntry(page: Page, key: string): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await signUp(page, `${key}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Paste Site');
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

test('a Word paste is offered for cleanup, and cleaning snaps it onto the platform primitives', async ({ page }) => {
  await openRichTextEntry(page, `paste-${stamp}`);
  await editable(page).click();
  await pasteInto(page, '[role="textbox"][aria-label="body"]', WORD_HTML, 'Quarterly report');

  await expect(page.getByText('Clean up pasted formatting?')).toBeVisible();
  await page.getByRole('button', { name: 'Clean up' }).click();

  const html = await editable(page).evaluate((el) => el.innerHTML);
  // The words survive…
  await expect(editable(page)).toContainText('Quarterly report');
  await expect(editable(page)).toContainText('Revenue rose');
  await expect(editable(page)).toContainText('See appendix');
  // …and the foreign dialect does not.
  expect(html).not.toMatch(/Mso/i);
  expect(html).not.toContain('WordSection1');
  expect(html).not.toContain('font-family');
  expect(html).not.toContain('font-size');

  // The bold run became the SEMANTIC tag the toolbar itself emits…
  await expect(editable(page).locator('strong')).toContainText('Revenue rose');
  // …the colour snapped to a palette class that genuinely paints…
  await expect(editable(page).locator('.text-red-600')).toHaveCount(1);
  const red = await editable(page).locator('.text-red-600').evaluate((el) => getComputedStyle(el).color);
  const [r, g, b] = await page.evaluate((c) => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const [rr, gg, bb] = ctx.getImageData(0, 0, 1, 1).data;
    return [rr, gg, bb] as [number, number, number];
  }, red);
  expect(r, `expected a red, got rgb(${r},${g},${b})`).toBeGreaterThan(g + 60);
  // …and the alignment became the class, laying the block out centred.
  const centred = editable(page).locator('.text-center');
  await expect(centred).toHaveCount(1);
  expect(await centred.evaluate((el) => getComputedStyle(el).textAlign)).toBe('center');
});

test('keeping the original formatting still sanitizes, and never leaves the choice unapplied', async ({ page }) => {
  await openRichTextEntry(page, `pastekeep-${stamp}`);
  await editable(page).click();
  await pasteInto(page, '[role="textbox"][aria-label="body"]', `${WORD_HTML}<script>window.__pwned = 1</script>`, 'x');

  await expect(page.getByText('Clean up pasted formatting?')).toBeVisible();
  await page.getByRole('button', { name: 'Keep original formatting' }).click();

  // The text lands either way — declining the cleanup must not mean declining the paste.
  await expect(editable(page)).toContainText('Quarterly report');
  const html = await editable(page).evaluate((el) => el.innerHTML);
  // Kept means kept-as-authored, NOT unfiltered: the XSS boundary still runs.
  expect(html).not.toContain('script');
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
});

test('an ordinary paste is left to the browser — no prompt, nothing intercepted', async ({ page }) => {
  await openRichTextEntry(page, `pasteplain-${stamp}`);
  await editable(page).click();
  // Content this editor itself would produce. Prompting here would put a dialog in front of every
  // copy-paste within a page, which is the failure mode a broad detector has.
  await pasteInto(page, '[role="textbox"][aria-label="body"]', '<p class="text-center"><strong>Ours</strong></p>', 'Ours');

  await expect(page.getByText('Clean up pasted formatting?')).toHaveCount(0);
});

test('the on-page toolbar sends a Word paste to the editor and inserts the answer at the caret', async ({ page }) => {
  // The preview is a sandboxed, opaque-origin iframe: it cannot import the cleaner, so it round-trips
  // the clipboard HTML through the parent. That hop is the part worth an E2E — a broken postMessage
  // contract looks exactly like "paste does nothing".
  await page.setViewportSize({ width: 1400, height: 900 });
  const slug = `pastebridge-${stamp}`;
  await signUp(page, `${slug}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Bridge Paste');
  await page.getByLabel('Project slug').fill(slug);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /^Home/ }).click();

  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<section data-sw-html="body"><p>Start</p></section>');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();

  const preview = page.frameLocator('iframe[title="Preview"]');
  const region = preview.locator('[data-sw-html="body"]');
  await expect(region).toHaveAttribute('contenteditable', 'true');
  await region.click();

  await page.frames()[1]!.evaluate((html) => {
    const el = document.querySelector<HTMLElement>('[data-sw-html="body"]')!;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    dt.setData('text/plain', 'Quarterly report');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, WORD_HTML);

  // The prompt is the EDITOR's, outside the iframe — that is the whole point of the round trip.
  await expect(page.getByText('Clean up pasted formatting?')).toBeVisible();
  await page.getByRole('button', { name: 'Clean up' }).click();

  await expect(region).toContainText('Quarterly report');
  await expect(region.locator('strong')).toContainText('Revenue rose');
  const html = await region.evaluate((el) => el.innerHTML);
  expect(html).not.toMatch(/Mso/i);
  expect(html).not.toContain('font-family');

  // …and it persisted through the normal rich-edit path, not just into the DOM.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
});
