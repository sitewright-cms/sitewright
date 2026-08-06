import { test, expect } from '@playwright/test';
import { deployLocally, fetchLiveSite, liveSiteRequest, signUp } from './helpers.js';

const stamp = Date.now();

// Per-project typography: heading + body font slots (system families + weight) applied in the
// editor settings, persisted, and reflected in the published page CSS.

test('typography slots: edit heading/body font + weight, persist, and publish applies them', async ({ page }) => {
  await signUp(page, `typo-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Type Site');
  const SLUG = `typo-${stamp}`;
  await page.getByLabel('Project slug').fill(SLUG);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Corporate Identity → Typography card. Defaults: heading Serif/700, body Sans-serif/400.
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await expect(page.getByLabel('Heading font family')).toHaveValue('serif');
  await expect(page.getByLabel('Body font family')).toHaveValue('sans-serif');

  // Change the BODY font to a serif at 700, and the HEADING to monospace.
  await page.getByLabel('Body font family').selectOption('serif');
  await page.getByLabel('Body font weight').selectOption('700');
  await page.getByLabel('Heading font family').selectOption('monospace');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  // Reload → reopen → the selections persisted.
  await page.reload();
  await page.getByRole('button', { name: /Type Site/ }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await expect(page.getByLabel('Body font family')).toHaveValue('serif');
  await expect(page.getByLabel('Body font weight')).toHaveValue('700');
  await expect(page.getByLabel('Heading font family')).toHaveValue('monospace');

  // Publish → the home page's typography CSS reflects the slots (applied to body + h1–h6).
  await deployLocally(page);
  const live = await fetchLiveSite(page, SLUG);
  expect(live.status, `live site for ${SLUG}`).toBe(200);
  const html = live.html;
  expect(html).toContain('--sw-font-body-weight:700');
  expect(html).toMatch(/--sw-font-body:[^;]*serif/);
  expect(html).toMatch(/--sw-font-heading:[^;]*monospace/);
  const headingRule = html.match(/([^{}]*)\{font-family:var\(--sw-font-heading\)/);
  expect(headingRule, 'a rule must apply the heading face').toBeTruthy();
  for (const sel of ['h1', 'h6', '.sw-h1', '.sw-h6']) {
    expect(headingRule![1].split(',').map((x) => x.trim())).toContain(sel);
  }
  expect(html).toContain('body{font-family:var(--sw-font-body);font-weight:var(--sw-font-body-weight)}');
  // The heading face applies to h1-h6 AND to the `.sw-h*` look-alikes (what rich-content headings are
  // rewritten to). Assert the selector's MEMBERS, not its literal text: the published CSS is minified
  // and the minifier SORTS the selector list, so `h1,…,h6,.sw-h1,…` in the source is emitted as
  // `.sw-h1,…,h1,…`. Pinning the source order passed the unit test and failed only here, on the real
  // published artifact.
});

// Google Fonts: browse the bundled catalog, SELECT a weight (the server downloads + self-hosts it),
// the slot persists, and the published page references the LOCAL woff2 — never Google.
test('google fonts: pick a heading webfont, self-host on select, publish loads it locally', async ({ page }) => {
  await signUp(page, `gfont-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Font Site');
  const SLUG = `gfont-${stamp}`;
  await page.getByLabel('Project slug').fill(SLUG);
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

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  // Reload → the asset slot persisted.
  await page.reload();
  await page.getByRole('button', { name: /Font Site/ }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await expect(page.getByLabel('Heading font family')).toHaveValue('__asset__');

  // Publish → the page self-hosts the woff2 (bundled _assets path) and carries ZERO Google references.
  await deployLocally(page);
  const live = await fetchLiveSite(page, SLUG);
  expect(live.status, `live site for ${SLUG}`).toBe(200);
  const html = live.html;
  expect(html).toContain('@font-face');
  expect(html).toMatch(/--sw-font-heading:"Playfair Display"/);
  // Self-hosted faces are FLAT: `_assets/<id>-<family-slug>-<weight>.<ext>` (the same flat scheme the
  // media library uses) — not a per-asset folder.
  const m = html.match(/_assets\/([\w-]+-playfair-display-700\.woff2)/);
  expect(m).toBeTruthy();
  expect(html).toMatch(/src:url\(_assets\/[\w-]+-playfair-display-700\.woff2\) format\("woff2"\)/);
  expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);

  // And the bundled woff2 is actually served from the published artifact.
  const woff2 = await liveSiteRequest(page, SLUG, `/_assets/${m![1]}`);
  expect(woff2.status()).toBe(200);
  expect(woff2.headers()['content-type']).toBe('font/woff2');
});

// A minimal sfnt/TrueType header (magic 0x00010000) — enough to pass the server's magic-byte check.
const TTF_BYTES = Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.alloc(64)]);

// Custom named slot → a `font-<name>` utility + `--sw-font-<name>` var on the published page.
test('custom named font slot: add "boombox", persist, and publish emits its --sw-font-boombox var', async ({ page }) => {
  await signUp(page, `named-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Named Site');
  const SLUG = `named-${stamp}`;
  await page.getByLabel('Project slug').fill(SLUG);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await page.getByRole('button', { name: '+ Add custom font' }).click();
  await page.getByLabel('Custom font name').fill('boombox');
  await page.getByLabel('boombox font weight').selectOption('700');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  // Reload → the named slot persisted.
  await page.reload();
  await page.getByRole('button', { name: /Named Site/ }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await expect(page.getByLabel('Custom font name')).toHaveValue('boombox');

  // Publish → the page exposes the --sw-font-boombox var (+ weight) for the font-boombox utility.
  await deployLocally(page);
  const live = await fetchLiveSite(page, SLUG);
  expect(live.status, `live site for ${SLUG}`).toBe(200);
  const html = live.html;
  // No trailing `;` — the minifier drops it on the last declaration before `}`.
  expect(html).toMatch(/--sw-font-boombox:[^;]+;--sw-font-boombox-weight:700[;}]/);
});

// Local font upload: a .ttf is self-hosted PROJECT-scoped and the published page loads it locally.
test('local font upload: upload a .ttf for the body, self-host on save, publish loads it locally', async ({ page }) => {
  await signUp(page, `upload-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Upload Site');
  const SLUG = `upload-${stamp}`;
  await page.getByLabel('Project slug').fill(SLUG);
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
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  // Publish → the page self-hosts the ttf (bundled _assets path + format("truetype")), zero Google refs.
  await deployLocally(page);
  const live = await fetchLiveSite(page, SLUG);
  expect(live.status, `live site for ${SLUG}`).toBe(200);
  const html = live.html;
  expect(html).toMatch(/--sw-font-body:"Uploadtest"/);
  // The uploaded family "Uploadtest" self-hosts as uploadtest-400.ttf (<family-slug>-<weight>.<ext>).
  const m = html.match(/_assets\/([\w-]+-uploadtest-400\.ttf)/);
  expect(m).toBeTruthy();
  expect(html).toMatch(/src:url\(_assets\/[\w-]+-uploadtest-400\.ttf\) format\("truetype"\)/);
  expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);

  // The bundled ttf is served from the published artifact with the right type.
  const ttf = await liveSiteRequest(page, SLUG, `/_assets/${m![1]}`);
  expect(ttf.status()).toBe(200);
  expect(ttf.headers()['content-type']).toBe('font/ttf');
});
