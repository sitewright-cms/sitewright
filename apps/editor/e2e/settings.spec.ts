import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Drives the glassmorphic Settings editor against the live editor + the unified
// Corporate Identity backend: edit identity + a brand color + website siteUrl,
// save, then reload and confirm everything persisted (full round-trip).

test('edit Corporate Identity + Website settings, save, and persist across reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`settings-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Acme Site');
  await page.getByLabel('Project slug').fill(`acme-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Open the Corporate Identity top tab → edit identity + a brand color directly.
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();

  await page.getByLabel('Display name').fill('Acme');
  await page.getByLabel('Legal name').fill('Acme Corporation');
  // Edit two mandatory brand colors via their CARD pickers (the six mandatory tokens render as
  // cards with no typed input — the color picker is the only way to set them), then add a custom
  // color whose value is likewise set via its swatch picker.
  await page.getByRole('button', { name: 'Edit Primary Color' }).click();
  await page.getByRole('dialog', { name: 'Primary Color picker' }).getByLabel('HEX').fill('#abcdef');
  await page.getByRole('tab', { name: 'Corporate Identity' }).click(); // click away → close popover
  await page.getByRole('button', { name: 'Edit Background Color' }).click();
  await page.getByRole('dialog', { name: 'Background Color picker' }).getByLabel('HEX').fill('#fedcba');
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await page.getByRole('button', { name: '+ Add color' }).click();
  await page.getByLabel('brand-teal 1', { exact: true }).fill('brand-teal');
  await page.getByRole('button', { name: 'Edit brand-teal 1' }).click();
  await page.getByRole('dialog', { name: 'brand-teal 1 picker' }).getByLabel('HEX').fill('#0d9488');
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  // Map embed URL (Contact & location).
  await page.getByLabel('Map embed URL').fill('https://www.google.com/maps/embed?pb=demo');
  // Social profile: entering the URL auto-fills the name + icon from the host.
  await page.getByRole('button', { name: '+ Add profile' }).click();
  await page.getByLabel('Social URL 1', { exact: true }).fill('https://wa.me/15551234');
  await expect(page.getByLabel('Social name 1', { exact: true })).toHaveValue('WhatsApp');
  await expect(page.getByLabel('Social icon 1', { exact: true })).toHaveValue('brand:whatsapp');

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();

  // Website Settings top tab: set the production URL.
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  await page.getByLabel(/Production URL/).fill('https://acme.example');

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();

  // Reload → re-open the project → values persisted via the API.
  await page.reload();
  await page.getByRole('button', { name: /Acme Site/ }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await expect(page.getByLabel('Legal name')).toHaveValue('Acme Corporation');
  // The mandatory color cards show their value as text (no input). Non-default values so the
  // match is unambiguous (a default token can share a common hex like #0ea5e9).
  await expect(page.getByText('#abcdef')).toBeVisible();
  await expect(page.getByText('#fedcba')).toBeVisible();
  await expect(page.getByLabel('brand-teal 1', { exact: true })).toHaveValue('brand-teal');
  await expect(page.getByLabel('#0d9488 1', { exact: true })).toHaveValue('#0d9488');
  await expect(page.getByLabel('Map embed URL')).toHaveValue('https://www.google.com/maps/embed?pb=demo');
  await expect(page.getByLabel('Social URL 1', { exact: true })).toHaveValue('https://wa.me/15551234');
  await expect(page.getByLabel('Social name 1', { exact: true })).toHaveValue('WhatsApp');
  await expect(page.getByLabel('Social icon 1', { exact: true })).toHaveValue('brand:whatsapp');
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  await expect(page.getByLabel(/Production URL/)).toHaveValue('https://acme.example');
});

// The brand color rows have a swatch BUTTON that opens a powerful picker: edit in any of
// HEX/RGB/HSL/OKLCH (live cross-space conversion) with an alpha channel. The picker stores
// sRGB hex — 8-digit #rrggbbaa when alpha < 1. Verifies an alpha edit converts live across
// the lenses and round-trips through the bound input, save, and reload.
test('Corporate Identity: edit a brand color via the multi-space picker (alpha → 8-digit hex)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`color-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Color Site');
  await page.getByLabel('Project slug').fill(`color-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();

  // Open the Primary color picker from its swatch button.
  await page.getByRole('button', { name: 'Edit Primary Color' }).click();
  const picker = page.getByRole('dialog', { name: 'Primary Color picker' });
  await expect(picker).toBeVisible();

  // Type a translucent color into the HEX lens; the OTHER lenses convert live…
  await picker.getByLabel('HEX').fill('#ff000080');
  await expect(picker.getByLabel('RGB')).toHaveValue('rgb(255 0 0 / 0.502)');
  await expect(picker.getByLabel('HSL')).toHaveValue('hsl(0 100% 50% / 0.502)');
  // …and the bound row input adopts the canonical 8-digit hex.
  await expect(page.getByText('#ff000080')).toBeVisible(); // the Primary card value updates live

  // Click away to close the popover, then persist.
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();

  // Reload → reopen → the alpha hex persisted via the API.
  await page.reload();
  await page.getByRole('button', { name: /Color Site/ }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await expect(page.getByText('#ff000080')).toBeVisible(); // the Primary card value updates live
});

// The website partials are edited via an EDIT button that opens the large black CodeMirror
// editor in a modal (not an inline textarea). Verifies that flow end-to-end: open a partial,
// edit its source in CodeMirror, save the modal, persist the settings, and confirm it round-trips.
test('edit a website partial in the code-editor modal, save, and persist across reload', async ({ page }) => {
  const marker = `E2EPARTIAL${stamp}`;
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`partials-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Partials Site');
  await page.getByLabel('Project slug').fill(`partials-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('tab', { name: 'Website Settings' }).click();

  // Open the topNav partial's code editor in a modal (no inline textarea).
  await page.getByRole('button', { name: /Edit topNav/ }).click();
  const dialog = page.getByRole('dialog', { name: 'topNav partial' });
  await expect(dialog).toBeVisible();

  // Type into the black CodeMirror editor, then Save (the modal's ✓ button).
  await dialog.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(`<div>${marker}</div>`);
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();

  // The compact CodeField shows a line count (no inline source preview); the source itself
  // is verified by the reopen round-trip below.
  await expect(page.getByText('1 line', { exact: true })).toBeVisible();

  // Persist the settings bundle, then reload and confirm the partial round-tripped.
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: /Partials Site/ }).click();
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  await page.getByRole('button', { name: /Edit topNav/ }).click();
  const reopened = page.getByRole('dialog', { name: 'topNav partial' });
  await expect(reopened.locator('.cm-content')).toContainText(marker);
});

// website.data is an editable JSON object managed via a graphical tree editor with a raw-JSON
// source toggle (the "Edit data" button in Website Settings). Verifies the source-view round-trips
// through Apply → modal Save → settings Save → reload.
test('edit website.data via the JSON source view, save, and persist across reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`wdata-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Data Site');
  await page.getByLabel('Project slug').fill(`data-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('tab', { name: 'Website Settings' }).click();

  // Open the Site data modal and enter an object via the raw JSON source view.
  await page.getByRole('button', { name: 'Edit data' }).click();
  const dialog = page.getByRole('dialog', { name: 'Site data' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /JSON source/ }).click();
  await dialog.getByLabel('JSON source').fill('{"hero":{"headline":"Built here"},"highlights":["fast","safe"]}');
  await dialog.getByRole('button', { name: 'Apply JSON' }).click(); // → back to the tree (parsed OK)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('2 keys')).toBeVisible(); // summary reflects the saved object

  // Persist the settings bundle.
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();

  // Reload → reopen → the data round-tripped (verify via the source view).
  await page.reload();
  await page.getByRole('button', { name: /Data Site/ }).click();
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  await page.getByRole('button', { name: 'Edit data' }).click();
  const reopened = page.getByRole('dialog', { name: 'Site data' });
  await reopened.getByRole('button', { name: /JSON source/ }).click();
  await expect(reopened.getByLabel('JSON source')).toHaveValue(/Built here/);
  await expect(reopened.getByLabel('JSON source')).toHaveValue(/highlights/);
});

// The Business type (schema.org @type) is picked from a searchable modal — a known list plus
// Default / Disabled. Verifies the pick round-trips through save + reload.
test('Corporate Identity: pick a schema.org business type via the modal, save, and persist', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`btype-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Biz Site');
  await page.getByLabel('Project slug').fill(`biz-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();

  const btn = page.getByRole('button', { name: 'Business type (schema.org @type)' });
  await expect(btn).toContainText('Default'); // unset → Default (Organization)
  await btn.click();
  const modal = page.getByRole('dialog', { name: 'Business type' });
  await modal.getByLabel('Search business types').fill('restaurant');
  await modal.getByRole('button', { name: 'Restaurant Restaurant' }).click();
  await expect(modal).toBeHidden(); // selecting closes the modal
  await expect(btn).toContainText('Restaurant');

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: /Biz Site/ }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await expect(page.getByRole('button', { name: 'Business type (schema.org @type)' })).toContainText('Restaurant');
});

// The MINI SHOP config (website.shop) is edited in the Website Settings → Shop card: a currency plus
// an add/remove list of checkout channels (a discriminated kind selector with per-kind fields).
// Verifies the currency + a WhatsApp channel round-trip through save + reload.
test('Website Settings: configure the mini-shop currency + a WhatsApp channel, save, and persist', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`shopui-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Shop UI Site');
  await page.getByLabel('Project slug').fill(`shopui-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('tab', { name: 'Website Settings' }).click();

  // Shop card: set a currency and add a WhatsApp checkout channel.
  await page.getByLabel('Currency code').fill('EUR');
  await page.getByLabel('Currency symbol').fill('€');
  await page.getByRole('button', { name: '+ Add channel' }).click();
  await page.getByLabel('Channel 1 WhatsApp number').fill('+14155550123');

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();

  // Reload → reopen → the shop config persisted via the API (proves toBundle wrote website.shop).
  await page.reload();
  await page.getByRole('button', { name: /Shop UI Site/ }).click();
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  await expect(page.getByLabel('Currency code')).toHaveValue('EUR');
  await expect(page.getByLabel('Channel 1 WhatsApp number')).toHaveValue('+14155550123');
});
