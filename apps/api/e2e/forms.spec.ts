import { test, expect } from '@playwright/test';
import { seedUser, enableLocalHosting } from './helpers.js';

// Full forms loop over HTTP: author a form + a page that embeds it, publish,
// confirm the exported HTML carries the JS-only form (no recipient), submit via
// the PUBLIC endpoint, and read it back from the authenticated inbox. Honeypot
// and unknown-form paths are checked too. (No SMTP is configured on the DinD
// instance, so the submission is stored but not emailed — exactly the desired
// "inbox is the source of truth" behavior; email delivery is unit-tested.)
test('author → publish → public submit → inbox', async ({ playwright, baseURL }) => {
    const stamp = Date.now();
  const api = await seedUser(playwright, baseURL, `forms-${stamp}@e2e.test`);
  const slug = `forms-${stamp}`;
  const proj = await api.post(`/projects`, { data: { name: 'Forms Site', slug } });
  const projectId = (await proj.json()).project.id as string;
  const base = `/projects/${projectId}`;

  // Author the form (recipient is server-side only).
  const putForm = await api.put(`${base}/content/form/contact`, {
    data: {
      id: 'contact',
      name: 'Contact form',
      fields: [
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'message', label: 'Message', type: 'textarea' },
      ],
      recipient: 'secret-recipient@acme.example',
    },
  });
  expect(putForm.status()).toBe(200);

  // A page embedding the form (code-first: the `{{sw-form}}` helper resolves to the full definition
  // with a same-origin `/f/<id>/<form>` endpoint at publish time).
  const putPage = await api.put(`${base}/content/page/contact`, {
    data: {
      id: 'contact',
      path: 'contact',
      title: 'Contact',
      source: '<section class="mx-auto max-w-3xl px-6 py-16">{{sw-form "contact"}}</section>',
    },
  });
  expect(putPage.status()).toBe(200);

  // Local Hosting is opt-in (a `local` deploy target) — required for the site to be SERVED at the
  // `/sites/<slug>/` path form AND the `<slug>.<SW_SITES_DOMAIN>` subdomain. (Tolerate 409 in case the
  // instance auto-provisions one.)
  const localTarget = await api.post(`${base}/deploy-targets`, { data: { name: 'Local Hosting', protocol: 'local' } });
  expect([201, 409]).toContain(localTarget.status());

  await enableLocalHosting(api, projectId);
  expect((await api.post(`${base}/publish`)).status()).toBe(200);

  // The exported page carries the JS-only form pointing at the platform endpoint;
  // the recipient is NOT in the HTML.
  const exported = await api.get(`/sites/${slug}/contact/`);
  expect(exported.status()).toBe(200);
  const html = await exported.text();
  expect(html).toContain('data-sw-component="form"');
  expect(html).not.toContain('secret-recipient@acme.example');
  // ★ THE SUBMISSION ENDPOINT IS NOT IN THE MARKUP. It used to be written straight onto the form as
  // `data-sw-endpoint="/f/<project>/<form>"` — a ready-to-POST address a scraper can grep for once and
  // then hit forever, without ever loading the page again. The form now carries only its ID and the
  // runtime assembles the URL from an encoded payload, which is what these three assertions pin:
  expect(html).toContain(`data-sw-routed="contact"`);
  expect(html).not.toContain('data-sw-endpoint');
  expect(html).not.toContain(`/f/${projectId}/`);
  // …and the payload itself carries the PARTS, so decoding it still hands over no URL.
  const payload = /JSON\.parse\(atob\("([^"]+)"\)\)/.exec(html)?.[1];
  expect(payload, 'the page must carry the encoded resolver').toBeTruthy();
  const decoded = Buffer.from(payload!, 'base64').toString('utf8');
  expect(decoded).toContain(projectId);
  expect(decoded).not.toContain('/f/');

  // LOCAL HOSTING TARGET 1 — the `/sites/<slug>/` PATH FORM (same-origin as the API). Assert CORS + storage.
  const submit = await api.post(`/f/${projectId}/contact`, {
    data: { email: 'lead@x.co', message: 'Hello from E2E', _elapsed: '5000' },
  });
  expect(submit.status()).toBe(200);
  expect(await submit.json()).toEqual({ ok: true });
  expect(submit.headers()['access-control-allow-origin']).toBe('*');

  // LOCAL HOSTING TARGET 2 — the `<slug>.<SW_SITES_DOMAIN>` SUBDOMAIN. The page is served at the
  // subdomain root, so its form posts to the root-relative `/f/<id>/contact` ON the subdomain host. That
  // must reach the platform endpoint (not be rewritten into `/sites/<slug>/f/…`). Drive it with a Host
  // header (the :2003 instance runs SW_SITES_DOMAIN=dind.local). The page is reachable at the subdomain
  // root too. A cross-domain `Origin` exercises the CORS path.
  const subHost = `${slug}.dind.local`;
  const subPage = await api.get(`/contact/`, { headers: { host: subHost } });
  expect(subPage.status()).toBe(200);
  const subHtml = await subPage.text();
  expect(subHtml).toContain(`data-sw-routed="contact"`);
  expect(subHtml).not.toContain(`/f/${projectId}/`); // still no address in the markup on this host either
  const subPre = await api.fetch(`/f/${projectId}/contact`, {
    method: 'OPTIONS',
    headers: { host: subHost, origin: `http://${subHost}`, 'access-control-request-method': 'POST' },
  });
  expect(subPre.status()).toBe(204);
  expect(subPre.headers()['access-control-allow-origin']).toBe('*');
  const subSubmit = await api.post(`/f/${projectId}/contact`, {
    headers: { host: subHost, origin: `http://${subHost}` },
    data: { email: 'sub@x.co', message: 'Hello from the subdomain', _elapsed: '5000' },
  });
  expect(subSubmit.status()).toBe(200);
  expect(await subSubmit.json()).toEqual({ ok: true });
  expect(subSubmit.headers()['access-control-allow-origin']).toBe('*');

  // Read BOTH submissions back from the authenticated inbox — one per local hosting target.
  const inbox = await api.get(`${base}/submissions`);
  expect(inbox.status()).toBe(200);
  const body = await inbox.json();
  expect(body.total).toBe(2);
  const emails = body.items.map((i: { fields: { email: string } }) => i.fields.email).sort();
  expect(emails).toEqual(['lead@x.co', 'sub@x.co']);

  // Honeypot-filled submission is dropped (still 200, not stored) — count stays at the 2 real ones.
  const trap = await api.post(`/f/${projectId}/contact`, {
    data: { email: 'bot@x.co', _hpt: 'i am a bot', _elapsed: '5000' },
  });
  expect(trap.status()).toBe(200);
  expect((await (await api.get(`${base}/submissions`)).json()).total).toBe(2);

  // Unknown form → 404.
  expect((await api.post(`/f/${projectId}/nope`, { data: { a: '1' } })).status()).toBe(404);

  await api.dispose();
});
