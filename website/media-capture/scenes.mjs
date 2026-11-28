// The capture scenes, one function per media slot (or per group of slots that share a set-up).
//
//   CAPTURE_BASE=http://dind.local:<port> node scenes.mjs <scene>…   (no names: all of them)
//
// Every scene starts from a fresh, signed-in browser context and saves nothing it changes in the editor, so the
// scenes are independent and can be re-run in any order. Editor scenes run at 1600×1000 CSS px (the main tab bar
// wraps at 1440); screenshots at 1.5× (2400×1500), videos at 1600×1000.
import { launch, signedIn, withCursor, glide, tap, typeSlowly, shot, record } from './lib.mjs';
import { ADMIN } from './admin.mjs';

const EDITOR = { width: 1600, height: 1000 };
const browser = await launch();

/** A signed-in editor page, the Example Project open. */
async function editor(opts = {}) {
  const context = await signedIn(browser, ADMIN.email, ADMIN.password, { ...EDITOR, scale: opts.scale ?? 1.5, reducedMotion: opts.reducedMotion ?? 'reduce' });
  await withCursor(context);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`  ! page error: ${e.message}`));
  await page.goto('/');
  await page.getByRole('button', { name: /Example Project/ }).first().click();
  await page.getByRole('button', { name: /^Home/ }).first().waitFor();
  return page;
}

/** Opens a page's editor on its Code tab and waits for the preview. */
async function openCode(page, row = /^Home/) {
  await page.getByRole('button', { name: row }).first().click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').waitFor();
  await page.frameLocator('iframe[title="Preview"]').locator('body').waitFor();
  await page.waitForTimeout(2500);
}

/** Selects `text` in the CodeMirror document (the first match) and scrolls it into view. */
async function selectInCode(page, text) {
  const found = await page.evaluate((needle) => {
    const el = document.querySelector('.cm-content');
    const view = el?.cmView?.view ?? el?.cmTile?.view;
    if (!view) return -1;
    const at = view.state.doc.toString().indexOf(needle);
    if (at < 0) return -1;
    view.dispatch({ selection: { anchor: at, head: at + needle.length }, scrollIntoView: true });
    view.focus();
    return at;
  }, text);
  if (found < 0) throw new Error(`"${text}" is not in the page source`);
}

const scenes = {
  // The hero: change the headline in the code, see the page change.
  async hero_product() {
    const page = await editor({ scale: 1 });
    await openCode(page);
    await glide(page, { x: 1000, y: 700 }, 10);
    const stop = await record(page, 'hero_product', EDITOR);
    await page.waitForTimeout(1500);
    await glide(page, page.locator('.cm-scroller'), 800);
    await page.waitForTimeout(700);
    await selectInCode(page, 'win you more business.');
    await page.waitForTimeout(900);
    await typeSlowly(page, 'ship in days, not months.', 70);
    await page.waitForTimeout(700);
    // Back into the preview: the strip folds away and the new headline is in view. (By way of the device rail: the
    // strip folds when the pointer is over the preview's wrapper, and moving straight into the iframe never is.)
    await glide(page, { x: 1494, y: 700 }, 700);
    await page.waitForTimeout(150);
    await glide(page, { x: 1180, y: 880 }, 700);
    await page.waitForTimeout(3200);
    await stop({ hold: 300 });
    await page.context().close();
  },
};


/** Scrolls the page (the app scrolls its MAIN element, or the window) so `locator` sits `top` px from the top. */
async function scrollTo(page, locator, top = 90) {
  await locator.scrollIntoViewIfNeeded();
  await page.evaluate(([y]) => window.scrollBy(0, 0), [top]);
  const box = await locator.boundingBox();
  if (box) await page.mouse.wheel(0, box.y - top);
  await page.waitForTimeout(500);
}

/** Moves the real mouse out of the way (a hover can leave a tooltip in the shot). */
const park = (page) => page.mouse.move(1599, 999);

Object.assign(scenes, {
  // The Pages tab with nothing open: the rails at the edges, the page tree in the middle.
  async doc_editor_tour_layout() {
    const page = await editor();
    await park(page);
    await page.waitForTimeout(800);
    await shot(page, 'doc_editor_tour_layout');
    await page.context().close();
  },

  // Corporate Identity: the business details and the design tokens (brand colours, typography).
  async doc_brand_identity() {
    const page = await editor();
    await page.getByRole('tab', { name: 'Corporate Identity' }).click();
    const tokens = page.getByText('Design tokens', { exact: true });
    await tokens.waitFor();
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(700);
    await park(page);
    await shot(page, 'doc_brand_identity', { around: [page.getByText('Business details', { exact: true }), page.getByText('CSS tokens', { exact: true }), page.getByText('#1a1a23')], pad: 40 });
    await page.context().close();
  },

  // Website Settings → the Document section: the skeleton tile and its neighbour.
  async doc_chrome_skeleton() {
    const page = await editor();
    await page.getByRole('tab', { name: 'Website Settings' }).click();
    const head = page.getByText('Document', { exact: true });
    await head.waitFor();
    await head.scrollIntoViewIfNeeded();
    // Just below the floating History / Discard / Save bar, so it covers no tile.
    const box = await head.boundingBox();
    await page.mouse.wheel(0, box.y - 196);
    await page.waitForTimeout(700);
    await park(page);
    await shot(page, 'doc_chrome_skeleton');
    await page.context().close();
  },

  // Forms → the contact form's editor: its fields.
  async doc_form_editor() {
    const page = await editor();
    await page.getByRole('tab', { name: 'Forms' }).click();
    await page.getByRole('button', { name: 'Project enquiry' }).click();
    const dialog = page.getByRole('dialog').last();
    await dialog.waitFor();
    await page.waitForTimeout(700);
    await park(page);
    await shot(page, 'doc_form_editor', { around: [dialog], pad: 20 });
    await page.context().close();
  },

  // …and further down: how it is delivered, and the spam defences.
  async feat_forms_editor() {
    const page = await editor();
    await page.getByRole('tab', { name: 'Forms' }).click();
    await page.getByRole('button', { name: 'Project enquiry' }).click();
    const dialog = page.getByRole('dialog').last();
    await dialog.waitFor();
    await page.waitForTimeout(500);
    const add = dialog.getByRole('button', { name: 'Add field' });
    await add.hover();
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(700);
    await park(page);
    await shot(page, 'feat_forms_editor', { around: [dialog], pad: 20 });
    await page.context().close();
  },

  // Settings → Shop: currency, shipping and the checkout channels.
  async doc_shop_channels() {
    const page = await editor();
    await page.getByRole('tab', { name: 'Website Settings' }).click();
    await page.getByRole('button', { name: 'Edit shop settings' }).click();
    const dialog = page.getByRole('dialog').last();
    await dialog.getByText('Checkout channels', { exact: false }).first().waitFor();
    await dialog.getByText('Shipping & tax', { exact: false }).first().hover();
    await page.mouse.wheel(0, 420);
    await page.waitForTimeout(700);
    await park(page);
    await shot(page, 'doc_shop_channels', { around: [dialog], pad: 20 });
    await page.context().close();
  },

  // The gear menu → System Settings → Ops: logging, storage & backups, database integrity.
  async doc_storage_backups() {
    const page = await editor();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('menuitem', { name: 'System Settings' }).or(page.getByRole('button', { name: 'System Settings' })).first().click();
    const dialog = page.getByRole('dialog').last();
    await dialog.waitFor();
    await dialog.getByRole('tab', { name: 'Ops' }).or(dialog.getByRole('button', { name: 'Ops', exact: true })).first().click();
    await page.waitForTimeout(1200);
    await park(page);
    await shot(page, 'doc_storage_backups', { around: [dialog], pad: 16 });
    await page.context().close();
  },

  // Preview options → Manage share links: three links, one running out soon.
  async feat_hosting_share() {
    const page = await editor();
    await page.getByRole('button', { name: 'Preview options' }).click();
    await page.getByRole('menuitem', { name: /Manage share links/ }).or(page.getByRole('button', { name: /Manage share links/ })).first().click();
    const dialog = page.getByRole('dialog').last();
    await dialog.waitFor();
    await page.waitForTimeout(900);
    await park(page);
    await shot(page, 'feat_hosting_share', { around: [dialog], pad: 20 });
    await page.context().close();
  },

  // Datasets → Team → an entry: the form, with its image picker.
  async doc_datasets_editor() {
    const page = await editor();
    await page.getByRole('button', { name: 'Open Datasets' }).click();
    await page.getByRole('button', { name: /^Team \/team$/ }).click();
    await page.getByRole('button', { name: 'Inés Romero' }).first().click();
    const dialog = page.getByRole('dialog', { name: /Inés Romero/ });
    await dialog.waitFor();
    await page.waitForTimeout(900);
    await park(page);
    await shot(page, 'doc_datasets_editor', { around: [dialog], pad: 40 });
    await page.context().close();
  },

  // An entry in German: the same fields, translated, behind a language tab.
  async feat_templating_entry() {
    const page = await editor();
    await page.getByRole('button', { name: 'Open Datasets' }).click();
    await page.getByRole('button', { name: /^Team \/team$/ }).click();
    await page.getByRole('button', { name: 'Inés Romero' }).first().click();
    const dialog = page.getByRole('dialog', { name: /Inés Romero/ });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: /^German/ }).or(dialog.getByRole('tab', { name: /^German/ })).first().click();
    // Start the German version from the English one, then translate what differs (nothing is saved).
    await dialog.getByRole('button', { name: 'Translate to German' }).click();
    await page.waitForTimeout(700);
    const fields = dialog.locator('input[type="text"]:visible, input:not([type]):visible, textarea:visible');
    const values = await fields.evaluateAll((els) => els.map((e) => e.value));
    const role = values.findIndex((v) => v === 'UX Strategist');
    const bio = values.findIndex((v) => v.startsWith('Turns fuzzy goals'));
    if (role >= 0) await fields.nth(role).fill('UX-Strategin');
    if (bio >= 0) await fields.nth(bio).fill('Macht aus vagen Zielen Wege, die überzeugen.');
    await page.waitForTimeout(600);
    await park(page);
    await shot(page, 'feat_templating_entry', { around: [dialog], pad: 40 });
    await page.context().close();
  },

  // Datasets → Products → its schema: field names, types, required.
  async doc_dataset_schema() {
    const page = await editor();
    await page.getByRole('button', { name: 'Open Datasets' }).click();
    await page.getByRole('button', { name: /^Products \/products$/ }).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /schema/ }).first().click();
    await page.waitForTimeout(900);
    await park(page);
    await shot(page, 'doc_dataset_schema');
    await page.context().close();
  },
});

const wanted = process.argv.slice(2);
for (const name of wanted.length ? wanted : Object.keys(scenes)) {
  if (!scenes[name]) throw new Error(`no scene "${name}"`);
  console.log(`▶ ${name}`);
  await scenes[name]();
}
await browser.close();
