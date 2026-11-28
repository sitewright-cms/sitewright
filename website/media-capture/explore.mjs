// Development aid: opens editor screens and saves a screenshot plus the ARIA snapshot of each, so scenes can be written
// against the real control names.   node explore.mjs <name>…
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, signedIn, OUT } from './lib.mjs';
import { ADMIN } from './admin.mjs';

const browser = await launch();
const ctx = await signedIn(browser, ADMIN.email, ADMIN.password, { width: 1600, height: 1000, scale: 1, reducedMotion: 'reduce' });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log(`  ! ${e.message}`));
const open = async () => {
  await page.goto('/');
  await page.getByRole('button', { name: /Example Project/ }).first().click();
  await page.getByRole('button', { name: /^Home/ }).first().waitFor();
  await page.waitForTimeout(800);
};
const screens = {
  'forms-edit': async () => { await page.getByRole('tab', { name: 'Forms' }).click(); await page.getByRole('button', { name: 'Project enquiry' }).click(); },
  shop: async () => { await page.getByRole('tab', { name: 'Website Settings' }).click(); await page.getByRole('button', { name: 'Edit shop settings' }).click(); },
  system: async () => { await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.waitForTimeout(600); },
  'preview-options': async () => { await page.getByRole('button', { name: 'Preview options' }).click(); },
  'team-entry': async () => { await page.getByRole('button', { name: 'Open Datasets' }).click(); await page.getByRole('button', { name: /^Team \/team$/ }).click(); await page.waitForTimeout(800); },
  'products-schema': async () => { await page.getByRole('button', { name: 'Open Datasets' }).click(); await page.getByRole('button', { name: /^Products \/products$/ }).click(); await page.waitForTimeout(800); await page.getByRole('button', { name: /schema/ }).first().click(); },
  'website-tiles': async () => { await page.getByRole('tab', { name: 'Website Settings' }).click(); await page.mouse.wheel(0, 1600); },

  datasets: async () => { await page.getByRole('button', { name: 'Open Datasets' }).click(); },
  files: async () => { await page.getByRole('button', { name: 'Open File Manager' }).click(); },
  library: async () => { await page.getByRole('button', { name: /System Library/i }).first().click(); },
  identity: async () => { await page.getByRole('tab', { name: 'Corporate Identity' }).click(); },
  website: async () => { await page.getByRole('tab', { name: 'Website Settings' }).click(); },
  forms: async () => { await page.getByRole('tab', { name: 'Forms' }).click(); },
  stats: async () => { await page.getByRole('tab', { name: 'Statistics' }).click(); },
  history: async () => { await page.getByRole('tab', { name: 'History' }).click(); },
  gear: async () => { await page.getByRole('button', { name: /Settings/ }).last().click(); },
  account: async () => { await page.getByRole('button', { name: 'Account', exact: true }).click(); },
  deploy: async () => { await page.getByRole('button', { name: /^Deploy/ }).last().click(); },
  previewmenu: async () => { await page.locator('button:right-of(:text("Preview"))').first().click(); },
  audit: async () => {
    await page.getByRole('button', { name: /^Home/ }).first().click();
    await page.getByRole('button', { name: 'Page Audit', exact: true }).click();
  },
  content: async () => {
    await page.getByRole('button', { name: /^About/ }).first().click();
    await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
  },
};
for (const name of process.argv.slice(2)) {
  await open();
  try {
    await screens[name]();
  } catch (e) {
    console.log(`${name}: ${e.message.split('\n')[0]}`);
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, `x-${name}.png`) });
  const aria = await page.locator('body').ariaSnapshot().catch((e) => `aria failed: ${e.message}`);
  writeFileSync(join(OUT, `x-${name}.aria.txt`), aria);
  console.log(`${name}: ${aria.split('\n').length} aria lines`);
}
await browser.close();
