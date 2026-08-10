import { test, expect } from '@playwright/test';
import { signUp, seedApiUser } from './helpers.js';

const stamp = Date.now();
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const REDIRECT = 'http://127.0.0.1:8976/callback';

const authorizeUrl = () =>
  `/oauth/authorize?${new URLSearchParams({
    client_id: 'sitewright-cli',
    redirect_uri: REDIRECT,
    response_type: 'code',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'chrome-state',
  })}`;

// The consent surface is server-rendered HTML with its own stylesheet and its own script — none of
// which jsdom can judge. These assertions are about what a browser actually PAINTS and RUNS: whether
// the admin's brand colour reaches the pixels, whether the shader runtime takes over the background,
// and whether the search box really filters and Enter really approves.

test('consent screen wears the admin branding and runs the shared shader background', async ({ page, baseURL }) => {
  const admin = await seedApiUser(baseURL!, `cadm-${stamp}@e2e.test`, 'admin');
  // Instance-global writes must be restored, or the next run inherits them (re-runnability).
  const before = await (await admin.get('/admin/settings')).json();
  await admin.put('/admin/settings', {
    data: {
      platformName: 'Acme Studio',
      brandPrimary: '#ff0055',
      brandSecondary: '#00ddaa',
      platformBackground: { preset: 'mesh-gradient', angle: 20, colors: ['#112233', '#445566', 'auto'] },
    },
  });

  try {
    await signUp(page, `chrome-${stamp}@e2e.test`);
    await page.request.post('/projects', { data: { name: 'Chrome Site', slug: `chrome-${stamp}` } });
    await page.goto(authorizeUrl());

    // MEASURED, not asserted from the class list: the brand colour has to reach a painted pixel.
    const approve = page.getByRole('button', { name: 'Approve' });
    await expect(approve).toBeVisible();
    const bg = await approve.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg).toContain('rgb(255, 0, 85)'); // #ff0055
    expect(bg).toContain('rgb(0, 221, 170)'); // #00ddaa
    await expect(page.getByText('Acme Studio')).toBeVisible();

    // The shared shader runtime enhances the host and paints a real canvas with real dimensions.
    const host = page.locator('[data-sw-component="shader-bg"]');
    await expect(host).toHaveAttribute('data-sw-enhanced', 'true', { timeout: 15_000 });
    const size = await host.locator('canvas').evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height }));
    expect(size.w).toBeGreaterThan(0);
    expect(size.h).toBeGreaterThan(0);

    // ★ With an admin-chosen background behind it, the heading must not sit on bare page — the
    // palette is the admin's and its `auto` slot ranges from near-white to near-black, so no fixed
    // text colour is safe. The shell becomes an opaque-enough frosted panel; MEASURE that rather
    // than trusting the class, since a stylesheet edit could silently drop it.
    await expect(page.locator('body')).toHaveClass(/has-bg/);
    const shell = await page.locator('.shell').evaluate((el) => {
      const cs = getComputedStyle(el);
      const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor);
      const parts = m ? m[1]!.split(',').map((n) => parseFloat(n)) : [];
      return { alpha: parts.length === 4 ? parts[3]! : parts.length === 3 ? 1 : 0, radius: cs.borderRadius };
    });
    expect(shell.alpha).toBeGreaterThan(0.6); // a real scrim, not a hint of one
    expect(shell.radius).not.toBe('0px');

    // The whole panel has to be REACHABLE on a short viewport: centring with align-items would clip
    // it at both ends with nothing to scroll to, and Approve is what falls off.
    await page.setViewportSize({ width: 900, height: 560 });
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
    const reachable = await page.evaluate(() => {
      const btn = document.querySelector('#sw-approve') as HTMLElement;
      btn.scrollIntoView({ block: 'end' });
      const r = btn.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight + 1;
    });
    expect(reachable).toBe(true);
  } finally {
    // Restore: null every field this test set that was previously unset.
    await admin.put('/admin/settings', {
      data: {
        platformName: before.settings?.platformName ?? null,
        brandPrimary: before.settings?.brandPrimary ?? null,
        brandSecondary: before.settings?.brandSecondary ?? null,
        platformBackground: before.settings?.platformBackground ?? null,
      },
    });
    await admin.dispose();
  }
});

test('consent screen: projects sort alphabetically, search filters, Enter approves', async ({ page }) => {
  const s = `${stamp}b`;
  await signUp(page, `search-${s}@e2e.test`);
  // Created deliberately OUT of alphabetical order — the picker must not show membership order.
  for (const [i, name] of ['Zulu Corp', 'Alpha Ltd', 'Mike GmbH', 'Bravo AG', 'Yankee SA', 'Charlie Oy'].entries()) {
    await page.request.post('/projects', { data: { name, slug: `srch-${s}-${i}` } });
  }
  await page.goto(authorizeUrl());

  const names = page.locator('.project .nm');
  await expect(names.first()).toBeVisible();
  expect(await names.allTextContents()).toEqual(['Alpha Ltd', 'Bravo AG', 'Charlie Oy', 'Mike GmbH', 'Yankee SA', 'Zulu Corp']);

  // The search box appears for a list this long and filters the CARDS (visibility, not just markup).
  const search = page.getByLabel('Search projects');
  await expect(search).toBeVisible();
  await search.fill('mike');
  await expect(page.locator('.project:visible')).toHaveCount(1);
  await expect(page.locator('.project:visible .nm')).toHaveText('Mike GmbH');
  // Filtering moves the selection onto a VISIBLE card, so approval can't submit a hidden project.
  await expect(page.locator('.project:visible input')).toBeChecked();

  // A search matching nothing says so, and Enter is inert rather than approving a stale selection.
  await search.fill('zzzz-no-such-project');
  await expect(page.getByText('No project matches that search')).toBeVisible();
  await search.press('Enter');
  await expect(page.getByRole('heading', { name: /Authorize/ })).toBeVisible(); // still on the consent page

  // Enter on a real match approves — the whole point of the shortcut.
  await search.fill('charlie');
  await search.press('Enter');
  await expect(page.getByRole('heading', { name: /Approved/ })).toBeVisible();
  await expect(page.locator('#sw-code')).not.toBeEmpty();
});

test('admin can allow the panel to be iframed, and it really loads in one', async ({ page, baseURL }) => {
  const admin = await seedApiUser(baseURL!, `eadm-${stamp}@e2e.test`, 'admin');
  const before = await (await admin.get('/admin/settings')).json();
  try {
    // Denied by default: an iframe of the panel must not load.
    await page.goto('/');
    // ★ `onload` fires for a BLOCKED frame too (the browser loads its own error document), so the
    // verdict has to come from inspecting the frame's document — never from the load event.
    const probe = (src: string) =>
      page.evaluate(
        (url) =>
          new Promise<string>((resolve) => {
            const f = document.createElement('iframe');
            f.src = url;
            document.body.appendChild(f);
            const verdict = () => {
              try {
                resolve(f.contentDocument?.body?.childElementCount ? 'loaded' : 'blocked');
              } catch {
                resolve('blocked'); // cross-origin-ish opaque document = refused
              }
            };
            f.addEventListener('load', () => setTimeout(verdict, 600));
            setTimeout(verdict, 6000);
          }),
        src,
      );
    expect(await probe('/')).toBe('blocked');

    // The header is the contract the browser acts on — assert it directly too.
    const denied = await page.request.get('/');
    expect(denied.headers()['x-frame-options']).toBe('DENY');
    expect(denied.headers()['content-security-policy']).toContain("frame-ancestors 'none'");

    // Allow this very origin, then the SAME check must flip.
    const origin = new URL(baseURL!).origin;
    expect((await admin.put('/admin/settings', { data: { embedding: { enabled: true, origins: [origin], allowSelf: true } } })).status()).toBe(200);

    const allowed = await page.request.get('/');
    expect(allowed.headers()['x-frame-options']).toBeUndefined();
    expect(allowed.headers()['content-security-policy']).toContain(`frame-ancestors 'self' ${origin}`);

    await page.reload();
    expect(await probe('/')).toBe('loaded');
  } finally {
    await admin.put('/admin/settings', { data: { embedding: before.settings?.embedding ?? null } });
    await admin.dispose();
  }
});
