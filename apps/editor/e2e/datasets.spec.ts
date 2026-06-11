import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The dataset manager (CMS): define a dataset + schema and add an entry. Code-first pages
// consume datasets via `{{#each data.<set>}}` in the template source (no block-binding UI).
test('define a dataset, its schema, and add an entry', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`data-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Data Site');
  await page.getByLabel('Project slug').fill(`data-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Data rail (bottom-left panel): create a "Posts" dataset with a "title" field.
  await page.getByRole('button', { name: 'Open Datasets' }).hover();
  await expect(page.getByLabel('Dataset name')).toBeVisible();
  await page.getByLabel('Dataset name').fill('Posts');
  await page.getByRole('button', { name: 'Create dataset' }).click();
  // The schema editor is collapsed by default — expand it to add fields.
  await page.getByRole('button', { name: /schema/ }).click();
  await page.getByLabel('New field name').fill('title');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: 'Save schema' }).click();

  // Add an entry; it appears in the entry list.
  await page.getByRole('button', { name: 'New entry' }).click();
  await page.getByLabel('title', { exact: true }).fill('Hello World');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hello World' })).toBeVisible();
});

// Deleting a dataset is guarded by a confirmation dialog: cancelling keeps it, confirming removes it.
test('deleting a dataset requires confirmation (cancel keeps it, confirm removes it)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`datadel-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Del Site');
  await page.getByLabel('Project slug').fill(`datadel-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: 'Open Datasets' }).hover();
  await page.getByLabel('Dataset name').fill('Temp');
  await page.getByRole('button', { name: 'Create dataset' }).click();
  // Delete dataset now lives inside the schema editor, which is collapsed by default — expand it.
  await page.getByRole('button', { name: /schema/ }).click();
  await expect(page.getByRole('button', { name: 'Delete dataset' })).toBeVisible();

  // Cancel → the dataset survives.
  await page.getByRole('button', { name: 'Delete dataset' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete dataset' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Delete dataset' })).toBeVisible();

  // Confirm → the dataset is removed (no selection → no Delete button).
  await page.getByRole('button', { name: 'Delete dataset' }).click();
  await page.getByRole('dialog', { name: 'Delete dataset' }).getByRole('button', { name: 'Delete dataset' }).click();
  await expect(page.getByRole('button', { name: 'Delete dataset' })).toHaveCount(0);
});

// An `image`-type entry field renders the reusable AssetField/FilePicker (not a bare text input),
// so editors browse the library or paste/import a URL — same control as the identity logo fields.
test('dataset image field uses the file picker (browse a URL into an entry)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`dataimg-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Gallery Site');
  await page.getByLabel('Project slug').fill(`dataimg-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Open the Data rail. A "Gallery" dataset with a text "title" + an "image"-type "photo" field.
  await page.getByRole('button', { name: 'Open Datasets' }).hover();
  await expect(page.getByLabel('Dataset name')).toBeVisible();
  await page.getByLabel('Dataset name').fill('Gallery');
  await page.getByRole('button', { name: 'Create dataset' }).click();
  // The schema editor is collapsed by default — expand it to add fields.
  await page.getByRole('button', { name: /schema/ }).click();
  await page.getByLabel('New field name').fill('title');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByLabel('New field name').fill('photo');
  await page.getByLabel('New field type').selectOption('image');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: 'Save schema' }).click();

  // New entry: the photo field is an AssetField (Browse button); the text field is not.
  await page.getByRole('button', { name: 'New entry' }).click();
  await expect(page.getByRole('button', { name: 'Browse for photo' })).toBeVisible();
  await page.getByLabel('title', { exact: true }).fill('Sunset');

  // Open the picker from the image field → URL tab → use a remote URL as-is.
  await page.getByRole('button', { name: 'Browse for photo' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose photo' });
  await picker.getByRole('button', { name: 'URL', exact: true }).click();
  await picker.getByLabel('URL').fill('https://cdn.example.com/remote-photo.jpg');
  await picker.getByRole('button', { name: 'Use URL as-is' }).click();
  await expect(page.locator('#entry-photo')).toHaveValue('https://cdn.example.com/remote-photo.jpg');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sunset' })).toBeVisible();
});

// The entry editor is a modal with a draft/published SWITCH (top-right); entries can be duplicated.
test('entry editor modal: status toggle + duplicate', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`dataedit-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Editorial');
  await page.getByLabel('Project slug').fill(`dataedit-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: 'Open Datasets' }).hover();
  await page.getByLabel('Dataset name').fill('Posts');
  await page.getByRole('button', { name: 'Create dataset' }).click();
  // The schema editor is collapsed by default — expand it to add fields.
  await page.getByRole('button', { name: /schema/ }).click();
  await page.getByLabel('New field name').fill('title');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: 'Save schema' }).click();

  // Add an entry via the modal.
  await page.getByRole('button', { name: 'New entry' }).click();
  await page.getByLabel('title', { exact: true }).fill('Alpha');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Alpha' })).toBeVisible();

  // Open it → the modal has a Draft/Published switch; select Published, save, and the badge updates.
  await page.getByRole('button', { name: 'Alpha', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: /Edit/ });
  await expect(editDialog).toBeVisible();
  await editDialog.getByRole('button', { name: 'published' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const alphaRow = page.locator('li', { has: page.getByRole('button', { name: 'Alpha', exact: true }) });
  await expect(alphaRow.getByText('published', { exact: true })).toBeVisible();

  // Duplicate it → a second "Alpha" appears (reset to draft).
  await alphaRow.getByRole('button', { name: /Duplicate entry/ }).click();
  await expect(page.getByRole('button', { name: 'Alpha', exact: true })).toHaveCount(2);
});

// Duplicating a dataset clones its schema + entries under "<slug>-copy"; an existing entry's KEY can
// be changed via the gated "Edit key" button (which recreates the entry, with a warning).
test('duplicate a dataset, then edit an existing entry key', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`datadup-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Dup Site');
  await page.getByLabel('Project slug').fill(`datadup-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: 'Open Datasets' }).hover();
  await page.getByLabel('Dataset name').fill('Posts');
  await page.getByRole('button', { name: 'Create dataset' }).click();
  await page.getByRole('button', { name: /schema/ }).click();
  await page.getByLabel('New field name').fill('title');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: 'Save schema' }).click();
  await page.getByRole('button', { name: 'New entry' }).click();
  await page.getByLabel('title', { exact: true }).fill('Hello');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hello' })).toBeVisible();

  // Duplicate the dataset → "posts-copy" appears and is auto-selected, with the entry cloned.
  await page.getByRole('button', { name: 'Duplicate dataset Posts' }).click();
  await expect(page.getByText('/posts-copy')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hello' })).toBeVisible();

  // Edit the cloned entry's key → the recreate warning shows; saving keeps the row (new id).
  await page.getByRole('button', { name: 'Hello' }).click();
  const dlg = page.getByRole('dialog', { name: /Edit/ });
  await dlg.getByRole('button', { name: 'Edit key' }).click();
  await dlg.getByLabel('Entry key').fill('greeting');
  await expect(dlg.getByText(/Renaming the key recreates/)).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hello' })).toBeVisible();
});

// Renaming a dataset's SLUG migrates all its entries to the new slug (ids preserved); page bindings
// must be updated to the new slug by hand (the modal warns) — the old slug then renders nothing.
test('rename a dataset slug migrates its entries; bindings use the new slug', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`datarename-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Rename Site');
  await page.getByLabel('Project slug').fill(`datarename-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: 'Open Datasets' }).hover();
  await page.getByLabel('Dataset name').fill('Posts');
  await page.getByRole('button', { name: 'Create dataset' }).click();
  await page.getByRole('button', { name: /schema/ }).click();
  await page.getByLabel('New field name').fill('title');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: 'Save schema' }).click();
  await page.getByRole('button', { name: 'New entry' }).click();
  await page.getByLabel('title', { exact: true }).fill('Hello');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hello' })).toBeVisible();

  // Rename the slug posts → articles (schema editor stays expanded after adding the field).
  await page.getByRole('button', { name: 'Rename dataset' }).click();
  const renameDlg = page.getByRole('dialog', { name: /Rename/ });
  await renameDlg.getByLabel('Dataset slug').fill('articles');
  await expect(renameDlg.getByText(/re-points all/)).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // The dataset now carries the new slug and still holds its entry.
  await expect(page.getByText('/articles')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hello' })).toBeVisible();

  // Bindings: the new slug renders the migrated entry; the old slug renders nothing.
  await page.getByRole('region', { name: 'Datasets' }).getByRole('button', { name: 'Close Datasets' }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(
    '<ul>{{#each data.articles}}<li class="a">{{title}}</li>{{/each}}</ul><ul>{{#each data.posts}}<li class="p">{{title}}</li>{{/each}}</ul>',
  );
  const preview = page.frameLocator('iframe[title="Preview"]');
  await expect(preview.locator('.a')).toHaveText('Hello');
  await expect(preview.locator('.p')).toHaveCount(0);
});

// Schema fields can be drag-reordered; the FIRST text field is the entry title in lists, so moving a
// different text field to the front re-titles existing entries (after Save schema).
test('drag-reorder schema fields to change which field is the entry title', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`fieldorder-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Field Order');
  await page.getByLabel('Project slug').fill(`fieldorder-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Two text fields, added in the order [blurb, heading] → blurb is the first text field (the title).
  await page.getByRole('button', { name: 'Open Datasets' }).hover();
  await page.getByLabel('Dataset name').fill('Posts');
  await page.getByRole('button', { name: 'Create dataset' }).click();
  await page.getByRole('button', { name: /schema/ }).click();
  await page.getByLabel('New field name').fill('blurb');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByLabel('New field name').fill('heading');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: 'Save schema' }).click();

  // An entry: its list label uses the first text field (blurb).
  await page.getByRole('button', { name: 'New entry' }).click();
  await page.getByLabel('blurb', { exact: true }).fill('Blurb text');
  await page.getByLabel('heading', { exact: true }).fill('Heading text');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Blurb text' })).toBeVisible();

  // Drag `heading` above `blurb` so heading becomes the first text field, then save.
  const headingHandle = page
    .locator('li', { has: page.getByText('heading', { exact: true }) })
    .locator('[title="Drag to reorder"]');
  const blurbRow = page.locator('li', { has: page.getByText('blurb', { exact: true }) });
  await headingHandle.dragTo(blurbRow, { targetPosition: { x: 20, y: 1 } });
  await page.getByRole('button', { name: 'Save schema' }).click();

  // The entry is now titled by `heading`.
  await expect(page.getByRole('button', { name: 'Heading text' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Blurb text' })).toHaveCount(0);
});
