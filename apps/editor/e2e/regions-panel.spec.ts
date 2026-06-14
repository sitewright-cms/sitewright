import { test, expect } from '@playwright/test';

// The "Regions" rail lists every editable region the bridge finds in content mode and reaches content
// the page would otherwise hide — here a {{sw-control}} inside a display:none "settings" wrapper, which
// has no in-place click target. Clicking its row opens the control's popover (centred) and the edit applies.
test('Regions panel: lists editable regions and reaches a hidden control', async ({ page }) => {
  const s = Date.now();
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`regions-${s}@e2e.test`);
  await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Regions Site');
  await page.getByLabel('Project slug').fill(`regions-${s}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(
    '<h1 data-sw-text="headline">Hi</h1><div class="hidden">{{sw-control target="motto" label="Motto"}}</div><p class="mt">{{page.data.motto}}</p>',
  );
  // The Regions rail is content-mode only — no tab in the Code Editor.
  await expect(page.getByRole('button', { name: 'Open Regions' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();

  // Open the Regions rail (its collapsed tab).
  await page.getByRole('button', { name: 'Open Regions' }).click();
  const panel = page.getByRole('region', { name: 'Regions' });

  // It lists the visible heading region AND the hidden control (which has no in-place affordance).
  await expect(panel.getByRole('button', { name: 'headline' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Motto' })).toBeVisible();

  // Click the hidden control's row → its popover opens in the preview (centred); set + apply.
  await panel.getByRole('button', { name: 'Motto' }).click();
  const preview = page.frameLocator('iframe[title="Preview"]');
  await preview.locator('.sw-pop .sw-cval').fill('Built to last');
  await preview.locator('.sw-pop .sw-ok').click();

  await expect(preview.locator('p.mt')).toHaveText('Built to last');
});
