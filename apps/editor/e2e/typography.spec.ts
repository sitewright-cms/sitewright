import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Per-project typography: heading + body font slots (system families + weight) applied in the
// editor settings, persisted, and reflected in the published page CSS.

test('typography slots: edit heading/body font + weight, persist, and publish applies them', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`typo-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Type Site');
  await page.getByLabel('Project slug').fill(`typo-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Corporate Identity → Typography card. Defaults: heading Serif/700, body Sans-serif/400.
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await expect(page.getByLabel('Heading font family')).toHaveValue('serif');
  await expect(page.getByLabel('Body font family')).toHaveValue('sans-serif');

  // Change the BODY font to a serif at 700, and the HEADING to monospace.
  await page.getByLabel('Body font family').selectOption('serif');
  await page.getByLabel('Body font weight').selectOption('700');
  await page.getByLabel('Heading font family').selectOption('monospace');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();

  // Reload → reopen → the selections persisted.
  await page.reload();
  await page.getByRole('button', { name: /Type Site/ }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await expect(page.getByLabel('Body font family')).toHaveValue('serif');
  await expect(page.getByLabel('Body font weight')).toHaveValue('700');
  await expect(page.getByLabel('Heading font family')).toHaveValue('monospace');

  // Publish → the home page's typography CSS reflects the slots (applied to body + h1–h6).
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('button', { name: 'Publish actions' }).click();
  const href = await page.getByRole('menuitem', { name: 'View published site' }).getAttribute('href');
  const origin = new URL(page.url()).origin;
  const html = await (await page.request.get(`${origin}${href!.replace(/\/$/, '')}/`)).text();
  expect(html).toContain('--sw-font-body-weight:700');
  expect(html).toMatch(/--sw-font-body:[^;]*serif/);
  expect(html).toMatch(/--sw-font-heading:[^;]*monospace/);
  expect(html).toContain('body{font-family:var(--sw-font-body);font-weight:var(--sw-font-body-weight)}');
  expect(html).toContain('h1,h2,h3,h4,h5,h6{font-family:var(--sw-font-heading)');
});

// Google Fonts: browse the bundled catalog, SELECT a weight (the server downloads + self-hosts it),
// the slot persists, and the published page references the LOCAL woff2 — never Google.
test('google fonts: pick a heading webfont, self-host on select, publish loads it locally', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`gfont-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Font Site');
  await page.getByLabel('Project slug').fill(`gfont-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('tab', { name: 'Corporate Identity' }).click();

  // Open the heading slot's font picker → Google tab → search → pick weight 700 (downloads + self-hosts
  // it as a kind:font library asset).
  await page.getByRole('button', { name: 'Choose a font for the heading font' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a heading font' });
  // Google Fonts is the default tab — its search field shows immediately, no tab switch needed.
  await expect(picker.getByLabel('Search Google Fonts')).toBeVisible();
  await picker.getByRole('button', { name: 'Google Fonts', exact: true }).click();
  await picker.getByLabel('Search Google Fonts').fill('Playfair Display');
  await picker.getByTitle('Use Playfair Display 700').first().click();

  // On select the slot becomes an `asset` slot (select value '__asset__') referencing the new font.
  await expect(page.getByLabel('Heading font family')).toHaveValue('__asset__', { timeout: 30000 });
  await expect(page.getByLabel('Heading font family')).toContainText('Playfair Display');

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();

  // Reload → the asset slot persisted.
  await page.reload();
  await page.getByRole('button', { name: /Font Site/ }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await expect(page.getByLabel('Heading font family')).toHaveValue('__asset__');

  // Publish → the page self-hosts the woff2 (bundled _assets path) and carries ZERO Google references.
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('button', { name: 'Publish actions' }).click();
  const href = await page.getByRole('menuitem', { name: 'View published site' }).getAttribute('href');
  const origin = new URL(page.url()).origin;
  const base = `${origin}${href!.replace(/\/$/, '')}`;
  const html = await (await page.request.get(`${base}/`)).text();
  expect(html).toContain('@font-face');
  expect(html).toMatch(/--sw-font-heading:"Playfair Display"/);
  // Self-hosted faces are stored as <family-slug>-<weight>.<ext> — e.g. playfair-display-700.woff2.
  const m = html.match(/_assets\/([a-f0-9-]+)\/playfair-display-700\.woff2/);
  expect(m).toBeTruthy();
  expect(html).toMatch(/src:url\(_assets\/[a-f0-9-]+\/playfair-display-700\.woff2\) format\("woff2"\)/);
  expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);

  // And the bundled woff2 is actually served from the published artifact.
  const woff2 = await page.request.get(`${base}/_assets/${m![1]}/playfair-display-700.woff2`);
  expect(woff2.status()).toBe(200);
  expect(woff2.headers()['content-type']).toBe('font/woff2');
});

// A minimal sfnt/TrueType header (magic 0x00010000) — enough to pass the server's magic-byte check.
const TTF_BYTES = Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.alloc(64)]);

// Custom named slot → a `font-<name>` utility + `--sw-font-<name>` var on the published page.
test('custom named font slot: add "boombox", persist, and publish emits its --sw-font-boombox var', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`named-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Named Site');
  await page.getByLabel('Project slug').fill(`named-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await page.getByRole('button', { name: '+ Add custom font' }).click();
  await page.getByLabel('Custom font name').fill('boombox');
  await page.getByLabel('boombox font weight').selectOption('700');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();

  // Reload → the named slot persisted.
  await page.reload();
  await page.getByRole('button', { name: /Named Site/ }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await expect(page.getByLabel('Custom font name')).toHaveValue('boombox');

  // Publish → the page exposes the --sw-font-boombox var (+ weight) for the font-boombox utility.
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('button', { name: 'Publish actions' }).click();
  const href = await page.getByRole('menuitem', { name: 'View published site' }).getAttribute('href');
  const origin = new URL(page.url()).origin;
  const html = await (await page.request.get(`${origin}${href!.replace(/\/$/, '')}/`)).text();
  expect(html).toMatch(/--sw-font-boombox:[^;]+;--sw-font-boombox-weight:700;/);
});

// Local font upload: a .ttf is self-hosted PROJECT-scoped and the published page loads it locally.
test('local font upload: upload a .ttf for the body, self-host on save, publish loads it locally', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`upload-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Upload Site');
  await page.getByLabel('Project slug').fill(`upload-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  // Open the body slot's font picker → Upload tab → attach a ttf + name it → upload.
  await page.getByRole('button', { name: 'Choose a font for the body font' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a body font' });
  await picker.getByRole('button', { name: 'Upload', exact: true }).click();
  await picker.getByLabel('Font file').setInputFiles({ name: 'uploadtest.ttf', mimeType: 'font/ttf', buffer: TTF_BYTES });
  await picker.getByLabel('Family name').fill('Uploadtest');
  await picker.getByRole('button', { name: 'Upload + use' }).click();

  // On success the body slot becomes an `asset` slot referencing the uploaded font.
  await expect(page.getByLabel('Body font family')).toHaveValue('__asset__', { timeout: 20000 });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();

  // Publish → the page self-hosts the ttf (bundled _assets path + format("truetype")), zero Google refs.
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('button', { name: 'Publish actions' }).click();
  const href = await page.getByRole('menuitem', { name: 'View published site' }).getAttribute('href');
  const origin = new URL(page.url()).origin;
  const base = `${origin}${href!.replace(/\/$/, '')}`;
  const html = await (await page.request.get(`${base}/`)).text();
  expect(html).toMatch(/--sw-font-body:"Uploadtest"/);
  // The uploaded family "Uploadtest" self-hosts as uploadtest-400.ttf (<family-slug>-<weight>.<ext>).
  const m = html.match(/_assets\/([a-f0-9-]+)\/uploadtest-400\.ttf/);
  expect(m).toBeTruthy();
  expect(html).toMatch(/src:url\(_assets\/[a-f0-9-]+\/uploadtest-400\.ttf\) format\("truetype"\)/);
  expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);

  // The bundled ttf is served from the published artifact with the right type.
  const ttf = await page.request.get(`${base}/_assets/${m![1]}/uploadtest-400.ttf`);
  expect(ttf.status()).toBe(200);
  expect(ttf.headers()['content-type']).toBe('font/ttf');
});
