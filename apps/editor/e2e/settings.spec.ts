import { test, expect, type Locator, type Page } from '@playwright/test';
import { signUp, openSettingsTile, closeSettingsSheet } from './helpers.js';

const stamp = Date.now();

/** Brand colors is an INLINE tile — the six core colours are picked right on it — so its drill-in (where
 *  the custom colours live) opens from the tile's custom-colours row, not from the tile itself. */
async function openBrandColors(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Edit custom colors', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Brand colors', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

// The Corporate Identity / Website Settings save control is a permanently-visible, sticky group of
// two icon buttons — "Save" (primary) + "Discard" (revert) — both enabled ONLY while unsaved edits
// exist; save/discard outcomes surface as toasts ("Settings saved" / "Changes discarded").

// Drives the glassmorphic Settings editor against the live editor + the unified
// Corporate Identity backend: edit identity + a brand color + website siteUrl,
// save, then reload and confirm everything persisted (full round-trip).

test('edit Corporate Identity + Website settings, save, and persist across reload', async ({ page }) => {
  await signUp(page, `settings-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Acme Site');
  await page.getByLabel('Project slug').fill(`acme-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Open the Corporate Identity top tab → its board. Each tile drills into that section's form; closing a
  // drill-in keeps its edits pending, so ONE page Save at the end persists the whole section.
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();

  let sheet = await openSettingsTile(page, 'Identity');
  await sheet.getByLabel('Display name').fill('Acme');
  await sheet.getByLabel('Legal name').fill('Acme Corporation');
  await closeSettingsSheet(sheet);

  // Edit two mandatory brand colors via their CARD pickers (the six mandatory tokens render as
  // cards with no typed input — the color picker is the only way to set them), then add a custom
  // color whose value is likewise set via its swatch picker. Escape closes ONLY the picker — the
  // drill-in around it must stay open (one Escape per layer).
  sheet = await openBrandColors(page);
  const clickAway = async () => {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /picker$/ })).toHaveCount(0);
    await expect(sheet).toBeVisible();
  };
  await sheet.getByRole('button', { name: 'Edit Primary Color' }).click();
  await page.getByRole('dialog', { name: 'Primary Color picker' }).getByLabel('HEX').fill('#abcdef');
  await clickAway();
  await sheet.getByRole('button', { name: 'Edit Background Color' }).click();
  await page.getByRole('dialog', { name: 'Background Color picker' }).getByLabel('HEX').fill('#fedcba');
  await clickAway();
  await sheet.getByRole('button', { name: '+ Add color' }).click();
  await sheet.getByLabel('brand-teal 1', { exact: true }).fill('brand-teal');
  await sheet.getByRole('button', { name: 'Edit brand-teal 1' }).click();
  await page.getByRole('dialog', { name: 'brand-teal 1 picker' }).getByLabel('HEX').fill('#0d9488');
  await clickAway();
  await closeSettingsSheet(sheet);

  // Map embed URL + Booking URL (Contact & location).
  sheet = await openSettingsTile(page, 'Contact & location');
  await sheet.getByLabel('Map embed URL').fill('https://www.google.com/maps/embed?pb=demo');
  await sheet.getByLabel('Booking URL').fill('https://calendly.com/acme/intro');
  await closeSettingsSheet(sheet);

  // Social profile: entering the URL auto-fills the name + icon from the host.
  sheet = await openSettingsTile(page, 'Social profiles');
  await sheet.getByRole('button', { name: '+ Add profile' }).click();
  await sheet.getByLabel('Social URL 1', { exact: true }).fill('https://wa.me/15551234');
  await expect(sheet.getByLabel('Social name 1', { exact: true })).toHaveValue('WhatsApp');
  await expect(sheet.getByLabel('Social icon 1', { exact: true })).toHaveValue('brand:whatsapp');
  await closeSettingsSheet(sheet);

  // The tiles already read back the pending edits.
  await expect(page.getByRole('button', { name: 'Open Identity' })).toContainText('Acme Corporation');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  // Website Settings top tab: the production URL and the no-code nav/button effects are edited right on
  // their tiles.
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  await page.getByLabel(/Production URL/).fill('https://acme.example');
  // `pill` is not a nav effect any more — the scheme names are `box-solid` / `sliding-pill` /
  // `glass-pill` / … (see NAV_EFFECTS).
  await page.getByLabel('Nav effect').selectOption('sliding-pill');
  // Button effect is no longer a bare select: it is a MODAL picker (effect + hover accent + shape,
  // with a live preview), applied with "Apply".
  await page.getByRole('button', { name: /accent ·/ }).click();
  const btnFx = page.getByRole('dialog', { name: 'Button effects' });
  await btnFx.getByLabel('Button effect').selectOption('lift');
  await btnFx.getByRole('button', { name: 'Apply' }).click();
  await expect(btnFx).toBeHidden();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  // Reload → re-open the project → values persisted via the API.
  await page.reload();
  await page.getByRole('button', { name: /Acme Site/ }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  sheet = await openSettingsTile(page, 'Identity');
  await expect(sheet.getByLabel('Legal name')).toHaveValue('Acme Corporation');
  await closeSettingsSheet(sheet);
  sheet = await openBrandColors(page);
  // The mandatory color cards show their value as text (no input). Non-default values so the
  // match is unambiguous (a default token can share a common hex like #0ea5e9).
  await expect(sheet.getByText('#abcdef')).toBeVisible();
  await expect(sheet.getByText('#fedcba')).toBeVisible();
  await expect(sheet.getByLabel('brand-teal 1', { exact: true })).toHaveValue('brand-teal');
  await expect(sheet.getByLabel('#0d9488 1', { exact: true })).toHaveValue('#0d9488');
  await closeSettingsSheet(sheet);
  sheet = await openSettingsTile(page, 'Contact & location');
  await expect(sheet.getByLabel('Map embed URL')).toHaveValue('https://www.google.com/maps/embed?pb=demo');
  await expect(sheet.getByLabel('Booking URL')).toHaveValue('https://calendly.com/acme/intro');
  await closeSettingsSheet(sheet);
  sheet = await openSettingsTile(page, 'Social profiles');
  await expect(sheet.getByLabel('Social URL 1', { exact: true })).toHaveValue('https://wa.me/15551234');
  await expect(sheet.getByLabel('Social name 1', { exact: true })).toHaveValue('WhatsApp');
  await expect(sheet.getByLabel('Social icon 1', { exact: true })).toHaveValue('brand:whatsapp');
  await closeSettingsSheet(sheet);
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  await expect(page.getByLabel(/Production URL/)).toHaveValue('https://acme.example');
  // The no-code effect picks persisted (website.theme).
  await expect(page.getByLabel('Nav effect')).toHaveValue('sliding-pill');
  // The button effect surfaces as the trigger's summary line, not a select on this screen.
  await expect(page.getByRole('button', { name: /accent ·/ })).toContainText('Lift');

  // Changing ONLY a nav effect must dirty the Website section's Save (it's a Website field) — then
  // persist on its own.
  await page.getByLabel('Nav effect').selectOption('line-bottom');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Acme Site/ }).click();
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  await expect(page.getByLabel('Nav effect')).toHaveValue('line-bottom');
});

// The brand color rows have a swatch BUTTON that opens a powerful picker: edit in any of
// HEX/RGB/HSL/OKLCH (live cross-space conversion) with an alpha channel. The picker stores
// sRGB hex — 8-digit #rrggbbaa when alpha < 1. Verifies an alpha edit converts live across
// the lenses and round-trips through the bound input, save, and reload.
test('Corporate Identity: edit a brand color via the multi-space picker (alpha → 8-digit hex)', async ({ page }) => {
  await signUp(page, `color-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Color Site');
  await page.getByLabel('Project slug').fill(`color-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  // The core colours are picked right on the tile: its swatch IS the picker trigger.
  const swatch = () => page.getByRole('group', { name: 'Brand colors tile' }).getByRole('button', { name: 'Pick primary color' });
  await swatch().click();
  const picker = page.getByRole('dialog', { name: 'primary picker' });
  await expect(picker).toBeVisible();

  // Type a translucent color into the HEX lens; the OTHER lenses convert live…
  await picker.getByLabel('HEX').fill('#ff000080');
  await expect(picker.getByLabel('RGB')).toHaveValue('rgb(255 0 0 / 0.502)');
  await expect(picker.getByLabel('HSL')).toHaveValue('hsl(0 100% 50% / 0.502)');
  // …and the swatch writes the canonical 8-digit hex inside itself, live.
  await expect(swatch()).toContainText('#ff000080');

  // Escape closes the popover; the edit is pending like any other inline one, so the page's Save keeps it.
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  // Reload → the alpha hex persisted via the API: on the tile, and in the drill-in's card.
  await page.reload();
  await page.getByRole('button', { name: /Color Site/ }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await expect(swatch()).toContainText('#ff000080');
  const reopened = await openBrandColors(page);
  await expect(reopened.getByText('#ff000080')).toBeVisible();
});

// The document map opens each part in the editor that suits it: the visible chrome (main nav, sidebars,
// footer) in the FULL editor — live preview, devices, click-to-code — starting in CODE mode, and the
// other partials (bottom, Critical CSS, Head HTML, Scripts) in the black CodeMirror code editor. Both
// save in their own gesture; verified end-to-end with a reload round-trip for each.
test('edit skeleton parts in the full editor (code mode) and the code editor, and persist across reload', async ({ page }) => {
  const marker = `E2EPARTIAL${stamp}`;
  const bottomMarker = `E2EBOTTOM${stamp}`;
  await signUp(page, `partials-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Partials Site');
  await page.getByLabel('Project slug').fill(`partials-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('tab', { name: 'Website Settings' }).click();

  // mainNav → the FULL editor, already in Code Editor mode.
  await page.getByRole('button', { name: /Edit mainNav/ }).click();
  const full = page.getByRole('dialog', { name: 'Main Navigation' });
  await expect(full).toBeVisible();
  await expect(full.getByRole('group', { name: 'Edit mode' }).getByRole('button', { name: 'Code Editor' })).toHaveAttribute('aria-pressed', 'true');
  await full.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(`<div>${marker}</div>`);
  await full.getByRole('button', { name: 'Save', exact: true }).click();
  // Saved = the editor is clean again (its Save disables), and only then is it safe to close.
  await expect(full.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await full.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(full).toBeHidden();
  // The map's part reads back its size (no inline source preview).
  await expect(page.getByRole('button', { name: /Edit mainNav/ })).toContainText('1 line');

  // bottom → the CODE editor.
  await page.getByRole('button', { name: /Edit bottom/ }).click();
  const code = page.getByRole('dialog', { name: 'bottom partial' });
  await expect(code).toBeVisible();
  await code.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(`<div>${bottomMarker}</div>`);
  await code.getByRole('button', { name: 'Save changes' }).click();
  // Saving no longer CLOSES the code editor (#898) — editing is save-look-keep-going; the Save control
  // disabling is the commit signal, so that is what to wait on before closing by hand.
  await expect(code.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await code.getByRole('button', { name: 'Close' }).click();
  await expect(code).toBeHidden();

  // Each editor's own Save PERSISTED its part, so there is nothing left to stage: the page's Save is
  // disabled. That is what proves the editors wrote through rather than silently dropping the edit.
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

  await page.reload();
  await page.getByRole('button', { name: /Partials Site/ }).click();
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  await page.getByRole('button', { name: /Edit mainNav/ }).click();
  const reopened = page.getByRole('dialog', { name: 'Main Navigation' });
  await expect(reopened.locator('.cm-content')).toContainText(marker);
  await reopened.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(reopened).toBeHidden();
  await page.getByRole('button', { name: /Edit bottom/ }).click();
  await expect(page.getByRole('dialog', { name: 'bottom partial' }).locator('.cm-content')).toContainText(bottomMarker);
});

// website.data is an editable JSON object managed via a graphical tree editor with a raw-JSON
// source toggle (the "Edit data" button in Website Settings). Verifies the source-view round-trips
// through Apply → modal Save → settings Save → reload.
test('edit website.data via the JSON source view, save, and persist across reload', async ({ page }) => {
  await signUp(page, `wdata-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Data Site');
  await page.getByLabel('Project slug').fill(`data-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('tab', { name: 'Website Settings' }).click();
  const site = page.getByRole('group', { name: 'Site tile' });

  // Open the Site data modal from the Site tile and enter an object via the raw JSON source view.
  await site.getByRole('button', { name: 'Edit data' }).click();
  const dialog = page.getByRole('dialog', { name: 'Site data' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /JSON source/ }).click();
  await dialog.getByLabel('JSON source').fill('{"hero":{"headline":"Built here"},"highlights":["fast","safe"]}');
  await dialog.getByRole('button', { name: 'Apply JSON' }).click(); // → back to the tree (parsed OK)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(site.getByText('2 keys')).toBeVisible(); // summary reflects the saved object

  // The modal's own Save PERSISTS website.data now (#899) — it used to only stage into the settings
  // form, so the author still had to find the tab's Save. There is nothing left to stage, and the
  // tab's Save being DISABLED is what proves the modal wrote through rather than dropping the edit.
  // (The reload round-trip below is the other half of that proof.)
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

  // Reload → reopen → the data round-tripped (verify via the source view).
  await page.reload();
  await page.getByRole('button', { name: /Data Site/ }).click();
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  const reopenedSite = page.getByRole('group', { name: 'Site tile' });
  await expect(reopenedSite.getByText('2 keys')).toBeVisible();
  await reopenedSite.getByRole('button', { name: 'Edit data' }).click();
  const reopened = page.getByRole('dialog', { name: 'Site data' });
  await reopened.getByRole('button', { name: /JSON source/ }).click();
  await expect(reopened.getByLabel('JSON source')).toHaveValue(/Built here/);
  await expect(reopened.getByLabel('JSON source')).toHaveValue(/highlights/);
});

// The Business type (schema.org @type) is picked from a searchable modal — a known list plus
// Default / Disabled. Verifies the pick round-trips through save + reload.
test('Corporate Identity: pick a schema.org business type via the modal, save, and persist', async ({ page }) => {
  await signUp(page, `btype-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Biz Site');
  await page.getByLabel('Project slug').fill(`biz-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  const identity = await openSettingsTile(page, 'Identity');

  const btn = identity.getByRole('button', { name: 'Business type (schema.org @type)' });
  await expect(btn).toContainText('Default'); // unset → Default (Organization)
  await btn.click();
  const modal = page.getByRole('dialog', { name: 'Business type' });
  await modal.getByLabel('Search business types').fill('restaurant');
  await modal.getByRole('button', { name: 'Restaurant Restaurant' }).click();
  await expect(modal).toBeHidden(); // selecting closes the modal
  await expect(btn).toContainText('Restaurant');

  await identity.getByRole('button', { name: 'Save and close' }).click();
  await expect(identity).toBeHidden();
  await expect(page.getByText('Settings saved')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: /Biz Site/ }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await expect(page.getByRole('button', { name: 'Open Identity' })).toContainText('Restaurant');
  const reopened = await openSettingsTile(page, 'Identity');
  await expect(reopened.getByRole('button', { name: 'Business type (schema.org @type)' })).toContainText('Restaurant');
});

// The MINI SHOP config (website.shop) is edited in the Website Settings → Shop card: an Enable toggle
// gates the section; when on, an Edit button opens a modal holding the structure (currency formatting +
// keyed channels). The cart's display TEXT is translatable (Translations & Labels), not here.
// Verifies the toggle + a keyed WhatsApp channel round-trip through save + reload.
test('Website Settings: enable the shop + add a keyed WhatsApp channel via the modal, save, and persist', async ({ page }) => {
  await signUp(page, `shopui-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Shop UI Site');
  await page.getByLabel('Project slug').fill(`shopui-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('tab', { name: 'Website Settings' }).click();

  // Enable the shop, open its settings modal, and add a keyed WhatsApp channel.
  await page.getByRole('switch', { name: 'Enable shop' }).click();
  await page.getByRole('button', { name: 'Edit shop settings' }).click();
  await page.getByRole('button', { name: '+ Add channel' }).click();
  await page.getByLabel('Channel 1 key').fill('whatsapp');
  await page.getByLabel('Channel 1 WhatsApp number').fill('+14155550123');
  await page.keyboard.press('Escape'); // close the modal (edits patch the draft live)

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  // Reload → reopen → the shop config persisted via the API (proves toBundle wrote website.shop).
  await page.reload();
  await page.getByRole('button', { name: /Shop UI Site/ }).click();
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  await expect(page.getByRole('switch', { name: 'Enable shop' })).toBeChecked();
  await page.getByRole('button', { name: 'Edit shop settings' }).click();
  await expect(page.getByLabel('Channel 1 key')).toHaveValue('whatsapp');
  await expect(page.getByLabel('Channel 1 WhatsApp number')).toHaveValue('+14155550123');
});

// The sticky Save/Discard group gates on unsaved changes: both start disabled, the first edit arms
// them, and Discard reverts the edit (toasting "Changes discarded") and re-disables both — without
// any Save round-trip.
test('Corporate Identity: Save/Discard gate on unsaved changes and Discard reverts', async ({ page }) => {
  await signUp(page, `discard-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Discard Site');
  await page.getByLabel('Project slug').fill(`discard-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();

  const save = page.getByRole('button', { name: 'Save', exact: true });
  // `exact` matters: this test's own project is named "Discard Site", so its switch-project button
  // ("Discard Site — switch project") matches the substring too.
  const discard = page.getByRole('button', { name: 'Discard', exact: true });
  // Freshly loaded → nothing to save.
  await expect(save).toBeDisabled();
  await expect(discard).toBeDisabled();

  // The first edit arms both buttons. Closing the drill-in keeps the edit pending.
  const identity = await openSettingsTile(page, 'Identity');
  await identity.getByLabel('Legal name').fill('Temporary Inc.');
  await expect(save).toBeEnabled();
  await expect(discard).toBeEnabled();
  await closeSettingsSheet(identity);
  await expect(page.getByRole('button', { name: 'Open Identity' })).toContainText('Temporary Inc.');

  // Discard reverts the edit + toasts + re-disables — and never calls the API.
  await discard.click();
  await expect(page.getByText('Changes discarded')).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(discard).toBeDisabled();
  const reopened = await openSettingsTile(page, 'Identity');
  await expect(reopened.getByLabel('Legal name')).toHaveValue('');
});
