import { test, expect } from '@playwright/test';

const stamp = Date.now();

// {{sw-control}}: a content-editor-only control chip sets a whitelisted page / page.data value from
// inside the preview. The chip shows ONLY in content mode and is stripped from the published output.
test('sw-control: a control sets a page.data value (preview updates) and is stripped on publish', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`ctrl-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Control Site');
  await page.getByLabel('Project slug').fill(`ctrl-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Author a page that binds page.data.tagline + places a control to set it.
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<h1 class="tag">{{page.data.tagline}}</h1>{{sw-control target="tagline" label="Tagline"}}');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();

  const preview = page.frameLocator('iframe[title="Preview"]');
  const chip = preview.locator('[data-sw-control="tagline"]');
  await expect(chip).toBeVisible(); // shown only in content mode

  // Click the chip → its popover → set the value → Apply.
  await chip.click();
  await preview.locator('.sw-pop .sw-cval').fill('Hello World');
  await preview.locator('.sw-pop .sw-ok').click();

  // The preview reloads and the bound heading shows the new value.
  await expect(preview.locator('h1.tag')).toHaveText('Hello World');

  // Save + publish; the published page keeps the bound value but has NO control chip.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('button', { name: 'Publish actions' }).click();
  const href = await page.getByRole('menuitem', { name: 'View published site' }).getAttribute('href');

  await page.goto(href!);
  await expect(page.locator('h1.tag')).toHaveText('Hello World');
  await expect(page.locator('[data-sw-control]')).toHaveCount(0); // chip stripped on publish
});

// as="file" opens the FILE picker (filtered to uploaded files) and sets the target to the chosen URL.
test('sw-control as="file": opens the file picker and sets a page.data file URL', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`ctrlfile-${Date.now()}@e2e.test`);
  await page.getByLabel('Password').fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Control File');
  await page.getByLabel('Project slug').fill(`ctrlfile-${Date.now()}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<a class="dl" href="{{sw-url page.data.brochure}}">Download</a>{{sw-control target="brochure" as="file" label="Brochure"}}');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();

  const preview = page.frameLocator('iframe[title="Preview"]');
  await expect(preview.locator('[data-sw-control="brochure"]')).toBeVisible();
  await preview.locator('[data-sw-control="brochure"]').click();

  // The editor's FILE picker opens (titled "Choose file" — image controls say "Choose image"); paste a URL.
  const picker = page.getByRole('dialog', { name: 'Choose file' });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'URL', exact: true }).click();
  await picker.getByLabel('URL').fill('/media/seed/x/file/doc.pdf');
  await picker.getByRole('button', { name: 'Use URL as-is' }).click();

  // page.data.brochure is set → the bound link's href updates after the preview reload.
  await expect(preview.locator('a.dl')).toHaveAttribute('href', '/media/seed/x/file/doc.pdf');
});

// as="select" renders a dropdown of the author's own options="…" list and writes the chosen value.
test('sw-control as="select": renders a dropdown of author options and sets the value', async ({ page }) => {
  const s = Date.now();
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`ctrlsel-${s}@e2e.test`);
  await page.getByLabel('Password').fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Control Select');
  await page.getByLabel('Project slug').fill(`ctrlsel-${s}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<p class="st">{{page.data.status}}</p>{{sw-control target="status" as="select" options="Draft, Published, Archived" label="Status"}}');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();

  const preview = page.frameLocator('iframe[title="Preview"]');
  const chip = preview.locator('[data-sw-control="status"]');
  await expect(chip).toBeVisible();
  await chip.click();

  // The popover field is a <select> carrying the author's options.
  const sel = preview.locator('.sw-pop select.sw-cval');
  await expect(sel).toBeVisible();
  await expect(sel.locator('option')).toContainText(['Draft', 'Published', 'Archived']);
  await sel.selectOption('Published');
  await preview.locator('.sw-pop .sw-ok').click();

  await expect(preview.locator('p.st')).toHaveText('Published');
});

// Overlay handle: a control inside a display:none (Tailwind `hidden`) wrapper renders at 0x0 and is
// unreachable in-place — the bridge attaches an always-on-top HANDLE (proxied to a visible ancestor)
// so it stays editable without un-hiding the wrapper.
test('sw-control: a control hidden behind display:none is reachable via an overlay handle', async ({ page }) => {
  const s = Date.now();
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`ctrlrev-${s}@e2e.test`);
  await page.getByLabel('Password').fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Control Reveal');
  await page.getByLabel('Project slug').fill(`ctrlrev-${s}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  // The control lives inside a hidden wrapper (the "settings chips" pattern) — invisible on the page.
  await page.keyboard.insertText('<div class="hidden">{{sw-control target="motto" label="Motto"}}</div><p class="mt">{{page.data.motto}}</p>');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();

  const preview = page.frameLocator('iframe[title="Preview"]');
  await expect(preview.locator('[data-sw-control="motto"]')).toBeHidden(); // stays hidden (no reveal)
  const handle = preview.locator('.sw-handle');
  await expect(handle.first()).toBeVisible(); // an overlay handle stands in for the hidden control
  await handle.first().click(); // single hidden leaf → opens its control popover directly
  await preview.locator('.sw-pop .sw-cval').fill('Built to last');
  await preview.locator('.sw-pop .sw-ok').click();

  await expect(preview.locator('p.mt')).toHaveText('Built to last');

  // Leaving content mode removes the overlay handles.
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await expect(preview.locator('.sw-handle')).toHaveCount(0);
});

// Occlusion: an editable element covered by an absolute overlay can't be clicked in place — the bridge's
// top-layer handle sits ABOVE the overlay so the element stays editable (here a plain-text leaf → textarea popover).
test('overlay handle: an occluded editable element is editable via its top-layer handle', async ({ page }) => {
  const s = Date.now();
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`occl-${s}@e2e.test`);
  await page.getByLabel('Password').fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Occluded');
  await page.getByLabel('Project slug').fill(`occl-${s}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  // The caption is fully covered by an absolute overlay painted on top (the hero-slider pattern).
  await page.keyboard.insertText('<div style="position:relative;height:120px"><span class="cap" data-sw-text="cap">Hi</span><div style="position:absolute;inset:0;background:rgba(0,0,0,.3)"></div></div>');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();

  const preview = page.frameLocator('iframe[title="Preview"]');
  const handle = preview.locator('.sw-handle');
  await expect(handle.first()).toBeVisible(); // a handle stands over the occluded caption
  await handle.first().click(); // occluded plain text → textarea popover
  await preview.locator('.sw-pop .sw-tval').fill('Now editable');
  await preview.locator('.sw-pop .sw-ok').click();

  await expect(preview.locator('span.cap')).toHaveText('Now editable');
});
