// The capture scenes, one function per media slot (or per group of slots that share a set-up).
//
//   CAPTURE_BASE=http://dind.local:<port> node scenes.mjs <scene>…   (no names: all of them)
//
// Every scene starts from a fresh, signed-in browser context and saves nothing it changes in the editor, so the
// scenes are independent and can be re-run in any order. Editor scenes run at 1600×1000 CSS px (the main tab bar
// wraps at 1440); screenshots at 1.5× (2400×1500), videos at 1600×1000.
import { launch, signedIn, withCursor, glide, tap, typeSlowly, shot, record, api, ok, BASE, SITES_DOMAIN } from './lib.mjs';
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

  // The System Library rail over the page editor: references, assets, builders & studios.
  async feat_editor_library() {
    const page = await editor();
    await openCode(page);
    await page.getByRole('button', { name: /System Library/i }).first().click();
    await page.getByText('Builders & Studios', { exact: false }).first().waitFor();
    await page.waitForTimeout(900);
    await park(page);
    await shot(page, 'feat_editor_library');
    await page.context().close();
  },

  // A first site: the Home page's code, the strip opened by hovering it, the page under it.
  async doc_first_site_code() {
    const page = await editor();
    await openCode(page);
    await page.locator('.cm-scroller').hover();
    await page.waitForTimeout(1200);
    await page.evaluate(() => { const c = document.getElementById('__cap_cursor'); if (c) c.style.display = 'none'; });
    await shot(page, 'doc_first_site_code');
    await page.context().close();
  },

  // File Manager → Projects, as a grid, one picture selected with its details.
  async feat_media_library() {
    const page = await editor();
    await page.getByRole('button', { name: 'Open File Manager' }).click();
    await page.getByRole('button', { name: 'grid view' }).click();
    await page.getByRole('button', { name: /^Projects \d/ }).click();
    await page.waitForTimeout(1200);
    await page.locator('figure button:visible').nth(1).click({ timeout: 8000 }).catch(async () => { await page.locator('figure button:visible').nth(1).click({ force: true }); });
    await page.waitForTimeout(1200);
    await park(page);
    await shot(page, 'feat_media_library');
    await page.context().close();
  },

  // Website Settings → Languages: the main language and its translations.
  async doc_languages() {
    const page = await editor();
    await page.getByRole('tab', { name: 'Website Settings' }).click();
    await page.getByRole('button', { name: 'Open Languages' }).click();
    const dialog = page.getByRole('dialog').last();
    await dialog.waitFor();
    await page.waitForTimeout(900);
    await park(page);
    await shot(page, 'doc_languages');
    await page.context().close();
  },

  // Website Settings → Translations: every key, every language, what is missing.
  async feat_languages_coverage() {
    const page = await editor();
    await page.getByRole('tab', { name: 'Website Settings' }).click();
    await page.getByRole('button', { name: 'Open Translations' }).click();
    const dialog = page.getByRole('dialog').last();
    await dialog.waitFor();
    await page.waitForTimeout(1200);
    await park(page);
    await shot(page, 'feat_languages_coverage');
    await page.context().close();
  },

  // Account Settings → Access keys: project tokens and a member token. Made for this shot and revoked after it (every
  // token counts as a connected agent, and that pill's pulse slows every other capture).
  async doc_access_keys() {
    const a = await api(ADMIN.email, ADMIN.password);
    const { projects } = await ok(a.get('/projects'), 'projects');
    const pid = projects.find((p) => p.slug === 'example').id;
    for (const key of [
      { name: 'CI deploys', role: 'owner', capabilities: ['content:read', 'deploy'], expiresInDays: 90 },
      { name: 'Staging agent', role: 'member', capabilities: ['content:read', 'content:write'], expiresInDays: 30 },
    ]) await ok(a.post(`/projects/${pid}/api-keys`, { data: key }), `key ${key.name}`);
    await ok(a.post('/account/member-tokens', { data: { currentPassword: ADMIN.password, name: 'Claude Code (laptop)', capabilities: ['content:read', 'content:write', 'publish'], expiresInDays: 60 } }), 'member token');
    try {
      const page = await editor();
      await page.getByRole('button', { name: 'Account', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Account Settings' }).or(page.getByRole('button', { name: 'Account Settings' })).first().click();
      const dialog = page.getByRole('dialog').last();
      await dialog.waitFor();
      await dialog.getByRole('tab', { name: /Access keys/ }).or(dialog.getByRole('button', { name: /Access keys/ })).first().click();
      await page.waitForTimeout(1200);
      await park(page);
      await shot(page, 'doc_access_keys', { around: [dialog], pad: 16 });
      await page.context().close();
    } finally {
      for (const k of (await ok(a.get(`/projects/${pid}/api-keys`), 'keys')).items ?? []) await ok(a.delete(`/projects/${pid}/api-keys/${k.id}`), 'revoke');
      for (const t of (await ok(a.get('/account/member-tokens'), 'tokens')).items ?? []) if (!t.revokedAt) await ok(a.delete(`/account/member-tokens/${t.id}`), 'revoke');
    }
  },

  // What an agent's preview_page returns: the live Pricing page at phone, tablet and desktop size.
  async agent_sizes() {
    const url = `http://example.${SITES_DOMAIN}:${new URL(BASE).port}/services/pricing/`;
    // The phone shot starts below the demo's header, which squashes its logo at phone width (the demo is replaced).
    for (const [slot, width, height, scale, top] of [['agent_mobile', 430, 836, 2, 72], ['agent_tablet', 768, 1024, 1.5, 0], ['agent_desktop', 1600, 1000, 1.5, 0]]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'networkidle' });
      // A first visit gets the demo's consent bar; answer it, as a visitor would.
      await page.getByRole('button', { name: 'Accept all' }).click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await shot(page, slot, top ? { clip: { x: 0, y: top, width, height: height - top } } : {});
      await context.close();
    }
  },

  // The OAuth consent screen an agent's sign-in opens: which project, which permissions.
  async agent_consent() {
    const a = await api(ADMIN.email, ADMIN.password);
    const { projects } = await ok(a.get('/projects'), 'projects');
    if (!projects.some((p) => p.slug === 'alpine-outfitters')) await ok(a.post('/projects', { data: { name: 'Alpine Outfitters', slug: 'alpine-outfitters' } }), 'second project');
    const client = await ok(a.post('/oauth/register', { data: { client_name: 'Claude Code', redirect_uris: ['http://127.0.0.1:33418/callback'] } }), 'register client');
    const page = await editor();
    const q = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: 'http://127.0.0.1:33418/callback',
      response_type: 'code',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
      scope: 'content:read content:write content:delete deploy',
      state: 'capture',
    });
    await page.goto(`/oauth/authorize?${q}`);
    await page.getByRole('heading', { name: /Authorize/ }).waitFor();
    await page.waitForTimeout(1000);
    await park(page);
    // The innermost element holding both the heading and the Approve button: the consent card.
    const card = page.locator('div').filter({ has: page.getByRole('heading', { name: /Authorize/ }) }).filter({ has: page.getByRole('button', { name: 'Approve' }) }).last();
    await shot(page, 'doc_agent_consent', { around: [card], pad: 48 });
    await shot(page, 'feat_agents_consent', { around: [card], pad: 24 });
    await page.context().close();
  },

  // White-label: an agency's name, colours, logo and animated background on the admin chrome and the sign-in screen.
  async branding() {
    const a = await api(ADMIN.email, ADMIN.password);
    const logo = await a.get('/media/example/l5o6Jm-brand-icon.png');
    const data = Buffer.from(await logo.body()).toString('base64');
    await ok(a.put('/admin/settings', { data: {
      platformName: 'Northwind Studio', brandPrimary: '#0f766e', brandSecondary: '#f59e0b',
      platformLogo: { mime: 'image/png', data },
      platformBackground: { preset: 'mesh-gradient', angle: 35, colors: ['#0f766e', '#f59e0b', 'auto'] },
    } }), 'branding');
    try {
      const page = await editor();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('menuitem', { name: 'System Settings' }).or(page.getByRole('button', { name: 'System Settings' })).first().click();
      const dialog = page.getByRole('dialog').last();
      await dialog.waitFor();
      await page.waitForTimeout(1200);
      await park(page);
      await shot(page, 'doc_whitelabel_settings', { around: [dialog], pad: 16 });
      await page.context().close();
      // Signed out: the sign-in screen in the agency's colours, its background animating (motion allowed here).
      const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
      const signin = await context.newPage();
      await signin.goto('/');
      await signin.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
      await signin.waitForTimeout(2500);
      await shot(signin, 'doc_whitelabel_signin');
      const card = signin.locator('form').filter({ has: signin.getByRole('button', { name: 'Sign in', exact: true }) }).first();
      await shot(signin, 'feat_security_branding', { around: [card], pad: 220 });
      await context.close();
    } finally {
      await ok(a.put('/admin/settings', { data: { platformName: 'Sitewright', brandPrimary: null, brandSecondary: null, platformLogo: null, platformBackground: null } }), 'branding back');
    }
  },

  // Page Audit: a real Lighthouse run against a deploy-equivalent build of the page, then its findings.
  async audits() {
    for (const [slot, row, mode] of [['doc_editor_tour_audit', /^Home/, 'Mobile'], ['feat_seo_audit', /^Services/, 'Desktop']]) {
      const page = await editor();
      await page.getByRole('button', { name: row }).first().click();
      await page.getByRole('button', { name: 'Page Audit', exact: true }).click();
      await page.getByRole('button', { name: mode, exact: true }).click();
      await page.getByRole('button', { name: 'Run Lighthouse audit' }).click();
      // Done when the run button is back (it reads "Running…" meanwhile).
      await page.getByRole('button', { name: /Run Lighthouse audit|Run again|Re-run/ }).waitFor({ timeout: 240_000 });
      await page.waitForTimeout(1500);
      await park(page);
      // The audit column, from the search preview down to the first recommendations.
      await shot(page, slot, { around: [page.getByText('SEO preview', { exact: true }), page.getByText(/recommendations/i).first()], pad: 150 });
      await page.context().close();
    }
  },

  // The code view: retype the eyebrow and tint the headline with a Tailwind class; the page follows.
  async feat_editor_code() {
    const page = await editor({ scale: 1 });
    await openCode(page);
    await glide(page, { x: 1100, y: 760 }, 10);
    const stop = await record(page, 'feat_editor_code', EDITOR);
    await page.waitForTimeout(1200);
    await glide(page, page.locator('.cm-scroller'), 700);
    await page.waitForTimeout(500);
    await selectInCode(page, 'Boutique web studio · San Francisco');
    await page.waitForTimeout(600);
    await typeSlowly(page, 'Now booking autumn projects', 55);
    await page.waitForTimeout(500);
    await selectInCode(page, 'tracking-tight sm:text-6xl');
    await page.keyboard.press('End');
    await page.evaluate(() => {
      const el = document.querySelector('.cm-content');
      const view = el?.cmView?.view ?? el?.cmTile?.view;
      const doc = view.state.doc.toString();
      const at = doc.indexOf('tracking-tight sm:text-6xl') + 'tracking-tight'.length;
      view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
    });
    await page.waitForTimeout(400);
    await typeSlowly(page, ' text-amber-200', 70);
    await page.waitForTimeout(600);
    await glide(page, { x: 1494, y: 700 }, 700);
    await page.waitForTimeout(150);
    await glide(page, { x: 1180, y: 880 }, 700);
    await page.waitForTimeout(3000);
    await stop({ hold: 300 });
    await page.context().close();
  },

  // A developer's loop: one {{#each}} over the team dataset, and the page shows a card per person.
  async way_developer() {
    const page = await editor({ scale: 1 });
    await openCode(page, /^FAQ/);
    await glide(page, { x: 1100, y: 760 }, 10);
    const stop = await record(page, 'way_developer', EDITOR);
    await page.waitForTimeout(1000);
    await glide(page, page.locator('.cm-scroller'), 700);
    await page.evaluate(() => {
      const el = document.querySelector('.cm-content');
      const view = el?.cmView?.view ?? el?.cmTile?.view;
      view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
      view.focus();
    });
    await page.waitForTimeout(400);
    const chunks = [
      '<section class="mx-auto grid max-w-6xl gap-6 px-6 pt-16 sm:grid-cols-4">\n',
      '  {{#each dataset.team}}\n',
      '  <div class="rounded-2xl border border-base-300 p-6 text-center">\n',
      '    {{sw-image photo alt=name class="mx-auto h-24 w-24 rounded-full object-cover"}}\n',
      '    <h3 class="mt-4 font-bold">{{name}}</h3>\n',
      '    <p class="text-sm opacity-60">{{role}}</p>\n',
      '  </div>\n',
      '  {{/each}}\n',
      '</section>\n',
    ];
    for (const c of chunks) {
      await page.keyboard.insertText(c);
      await page.waitForTimeout(380);
    }
    await page.waitForTimeout(700);
    await glide(page, { x: 1494, y: 700 }, 700);
    await page.waitForTimeout(150);
    await glide(page, { x: 1150, y: 860 }, 700);
    await page.waitForTimeout(3200);
    await stop({ hold: 300 });
    await page.context().close();
  },

  // A client edits in place: hover the heading, click, retype it, save.
  async way_client() {
    const page = await editor({ scale: 1 });
    await page.getByRole('button', { name: /^About/ }).first().click();
    await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
    const preview = page.frameLocator('iframe[title="Preview"]');
    const heading = preview.locator('[data-sw-translate="about.headline"]');
    await heading.waitFor();
    await page.waitForTimeout(2000);
    await glide(page, { x: 1200, y: 800 }, 10);
    const stop = await record(page, 'way_client', EDITOR);
    await page.waitForTimeout(1000);
    await glide(page, heading, 900);
    await page.waitForTimeout(800);
    await tap(page, heading, { ms: 200 });
    await page.keyboard.press('ControlOrMeta+a');
    await page.waitForTimeout(300);
    await typeSlowly(page, 'Five people. Every one senior.', 65);
    await page.waitForTimeout(700);
    await tap(page, page.getByRole('button', { name: 'Save', exact: true }), { ms: 800 });
    await page.waitForTimeout(2200);
    await stop({ hold: 300 });
    await page.context().close();
  },

  // A client in the content view: the heading's outline and name badge, retype it; then swap the photo from the media
  // library. (Serves doc_client_editing and doc_inline_editing.)
  async doc_client_editing() {
    const page = await editor({ scale: 1 });
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Case study: Alpine Outfitters /case-study/' }).click();
    await page.getByRole('dialog', { name: /Case study/ }).waitFor();
    await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
    const preview = page.frameLocator('iframe[title="Preview"]');
    const heading = preview.locator('[data-sw-text="cs_title"]');
    const image = preview.locator('[data-sw-src="cs_image"]');
    await heading.waitFor();
    await page.waitForTimeout(2500);
    await glide(page, { x: 1300, y: 900 }, 10);
    const stop = await record(page, 'doc_client_editing', EDITOR);
    await page.waitForTimeout(900);
    await glide(page, heading, 900);
    await page.waitForTimeout(900);
    await tap(page, heading, { ms: 200 });
    await page.keyboard.press('ControlOrMeta+a');
    await page.waitForTimeout(250);
    await typeSlowly(page, 'Alpine Outfitters, live in six weeks', 55);
    await page.waitForTimeout(600);
    await tap(page, image, { ms: 800 });
    const picker = page.getByRole('dialog', { name: 'Replace image' });
    await picker.waitFor();
    await page.waitForTimeout(700);
    await tap(page, picker.getByRole('button', { name: /^Projects \d/ }), { ms: 700 });
    await page.waitForTimeout(900);
    await tap(page, picker.locator('figure button:visible, button:has(img):visible').nth(3), { ms: 700 });
    await page.waitForTimeout(2600);
    await stop({ hold: 300 });
    await page.context().close();
  },

  // Templating: a card is a dataset entry. Click it, change the role, save, and the card shows it.
  async feat_templating_click() {
    const page = await editor({ scale: 1 });
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Case study: Alpine Outfitters /case-study/' }).click();
    await page.getByRole('dialog', { name: /Case study/ }).waitFor();
    await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
    const preview = page.frameLocator('iframe[title="Preview"]');
    await preview.locator('[data-sw-text="cs_title"]').waitFor();
    const card = preview.locator('[data-sw-entry]').nth(1);
    await card.waitFor({ state: 'attached', timeout: 60_000 });
    // Scroll the preview so the team row sits in the middle of it.
    await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(2000);
    await glide(page, { x: 1300, y: 900 }, 10);
    const stop = await record(page, 'feat_templating_click', EDITOR);
    await page.waitForTimeout(900);
    await glide(page, card, 900);
    await page.waitForTimeout(700);
    await tap(page, card, { ms: 200 });
    const dialog = page.getByRole('dialog', { name: /^Edit / }).last();
    await dialog.waitFor();
    await page.waitForTimeout(700);
    const role = dialog.locator('input:visible').nth(1);
    await tap(page, role, { ms: 700 });
    await page.keyboard.press('ControlOrMeta+a');
    await typeSlowly(page, 'Head of UX', 70);
    await page.waitForTimeout(500);
    await tap(page, dialog.getByRole('button', { name: /^Save/ }).first(), { ms: 700 });
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await glide(page, card, 700);
    await page.waitForTimeout(2600);
    await stop({ hold: 300 });
    await page.context().close();
  },

  // The SVG animation studio: an example plays, an element is picked to show its animation, and it plays again.
  async feat_components_studio() {
    const page = await editor({ scale: 1, reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: /System Library/i }).first().click();
    await page.getByRole('button', { name: /^SVG animation studio/ }).click();
    await page.getByRole('button', { name: 'View Orbit mark in the studio' }).click();
    const play = page.getByRole('button', { name: /Play/ }).first();
    await play.waitFor();
    await page.waitForTimeout(1500);
    await glide(page, { x: 1100, y: 760 }, 10);
    const stop = await record(page, 'feat_components_studio', EDITOR);
    await page.waitForTimeout(700);
    await tap(page, play, { ms: 800 });
    await page.waitForTimeout(3800);
    await tap(page, page.getByRole('button', { name: 'ellipse', exact: true }), { ms: 900 });
    await page.waitForTimeout(1600);
    await tap(page, play, { ms: 900 });
    await page.waitForTimeout(3800);
    await stop({ hold: 300 });
    await page.context().close();
  },

  // Add a language: search, pick French, and every page gains a French version that follows the English layout.
  // (It changes the slot, so it runs last; 21:9 at 1680×720.)
  async feat_languages_add() {
    const size = { width: 1680, height: 720 };
    // Start without French (a previous run added it).
    const a = await api(ADMIN.email, ADMIN.password);
    const { projects } = await ok(a.get('/projects'), 'projects');
    const pid = projects.find((p) => p.slug === 'example').id;
    await a.delete(`/projects/${pid}/locales/fr`);
    const context = await signedIn(browser, ADMIN.email, ADMIN.password, { ...size, scale: 1, reducedMotion: 'reduce' });
    await withCursor(context);
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: /Example Project/ }).first().click();
    await page.getByRole('tab', { name: 'Website Settings' }).click();
    const tile = page.getByRole('button', { name: 'Open Languages' });
    await tile.waitFor();
    await tile.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await glide(page, { x: 1300, y: 600 }, 10);
    const stop = await record(page, 'feat_languages_add', size);
    await page.waitForTimeout(700);
    await tap(page, tile, { ms: 800 });
    const dialog = page.getByRole('dialog', { name: 'Languages' });
    await dialog.waitFor();
    await page.waitForTimeout(600);
    await tap(page, dialog.getByRole('button', { name: /Add language/ }), { ms: 700 });
    const add = page.getByRole('dialog', { name: 'Add a language' });
    await add.getByRole('searchbox').waitFor();
    await typeSlowly(page, 'Fren', 90);
    await page.waitForTimeout(500);
    await tap(page, add.getByRole('button', { name: 'French fr' }), { ms: 700 });
    await page.waitForTimeout(1200);
    // Picking it adds the language at once (its pages are created); the dialog stays open to show it.
    await page.waitForTimeout(1400);
    await tap(page, dialog.getByRole('button', { name: 'Close', exact: true }), { ms: 700 });
    await page.waitForTimeout(700);
    await tap(page, page.getByRole('tab', { name: 'Pages' }), { ms: 800 });
    await page.waitForTimeout(800);
    const fr = page.getByRole('tab', { name: 'fr', exact: true });
    await tap(page, fr, { ms: 700 });
    await page.waitForTimeout(3000);
    await stop({ hold: 300 });
    await context.close();
  },
});

const wanted = process.argv.slice(2);
for (const name of wanted.length ? wanted : Object.keys(scenes)) {
  if (!scenes[name]) throw new Error(`no scene "${name}"`);
  console.log(`▶ ${name}`);
  await scenes[name]();
}
await browser.close();
