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

const wanted = process.argv.slice(2);
for (const name of wanted.length ? wanted : Object.keys(scenes)) {
  if (!scenes[name]) throw new Error(`no scene "${name}"`);
  console.log(`▶ ${name}`);
  await scenes[name]();
}
await browser.close();
