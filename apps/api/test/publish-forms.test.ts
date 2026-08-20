// Publish-time form embedding (code-first): the {{sw-form}} helper / authored `data-sw-form`
// references resolve to the mode-correct submission endpoint via the form-embed pass in
// renderTemplate — see packages/blocks/src/form-embed.ts. These tests drive the FULL buildSite
// path (endpoints, locale resolution, contact.php pairing, asset shipping, loud failures).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectBundle } from '@sitewright/core';
import type { Form, Page } from '@sitewright/schema';
import { buildSite, PublishError } from '../src/publish/build.js';
import { formApiBlob } from './helpers.js';

let outDir: string;
beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'sw-forms-'));
});
afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

const stubRoot = { id: 'r', type: 'Section' as const };

function contactForm(over: Partial<Form> = {}): Form {
  return {
    id: 'contact',
    name: 'Contact form',
    fields: [
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'message', label: 'Message', type: 'textarea', required: false },
    ],
    submitLabel: 'Send',
    successMessage: 'Thanks!',
    errorMessage: 'Oops.',
    recipient: 'secret-recipient@acme.com',
    subject: 'New lead',
    mode: 'globalSmtp' as const,
    captcha: false, pow: false,
    ...over,
  } as Form;
}

function bundle(pages: Partial<Page>[], forms: Form[], website?: Record<string, unknown>): ProjectBundle {
  return {
    project: {
      formatVersion: 2 as const,
      id: 'proj1',
      name: 'Acme',
      slug: 'acme',
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
      website,
    },
    pages: pages.map((p) => ({ root: stubRoot, ...p })),
    datasets: [],
    entries: [],
    forms,
  } as unknown as ProjectBundle;
}

const at = '2026-05-31T00:00:00.000Z';

describe('buildSite — code-first form embedding', () => {
  it('{{sw-form}} renders the full definition with a same-origin endpoint (no publicBaseUrl) and ships the Form assets', async () => {
    const b = bundle(
      [{ id: 'contact', path: 'contact', title: 'Contact', source: '<section>{{sw-form "contact"}}</section>' }],
      [contactForm()],
    );
    await buildSite({ publishedAt: at, outDir, bundle: b });
    const html = await readFile(join(outDir, 'contact/index.html'), 'utf8');
    // ★ THE ENDPOINT IS NOT IN THE MARKUP. A routed form carries only its id; the URL is assembled at
    // runtime from an encoded blob, so the published page is not a ready-to-POST address a scraper can
    // grep for once and hammer forever. Asserting the ABSENCE of the address is the requirement — the
    // presence of `data-sw-routed` is only how it is met.
    expect(html).toContain('data-sw-routed="contact"');
    expect(html).not.toContain('data-sw-endpoint');
    expect(html).not.toContain('/f/proj1/contact');
    expect(html).toContain('data-sw-component="form"');
    expect(html).toContain('<span data-sw-part="label">Email</span>');
    expect(html).toContain('name="_hpt"'); // honeypot injected
    expect(html).not.toContain('data-sw-form'); // publish strips the reference marker
    expect(html).not.toContain('secret-recipient'); // the recipient never reaches the export
    // only-used-ships: the source scan caught the {{sw-form …}} reference → the Form chunk is written
    expect(html).toContain('c-form.js');
    // The shipped chunk is what knows how to build the URL from the blob.
    await expect(readFile(join(outDir, '_assets/_sw/c-form.js'), 'utf8')).resolves.toContain('__swf');
  });

  it('endpoints are absolute when a publicBaseUrl is configured', async () => {
    const b = bundle(
      [{ id: 'contact', path: 'contact', title: 'Contact', source: '<div>{{sw-form "contact"}}</div>' }],
      [contactForm()],
    );
    await buildSite({ publishedAt: at, outDir, bundle: b, publicBaseUrl: 'https://sw.example/' });
    const html = await readFile(join(outDir, 'contact/index.html'), 'utf8');
    // The absolute base moved into the encoded blob rather than onto the form. It must still be the
    // configured origin — a same-origin fallback here would silently break every exported site — but it
    // must not appear as a literal address anywhere in the page.
    expect(html).not.toContain('https://sw.example/f/proj1/contact');
    expect(formApiBlob(html)).toMatchObject({ b: 'https://sw.example', p: 'proj1' });
  });

  it('an authored <form data-sw-form> resolves too, and a de page picks the contact-de variant', async () => {
    const b = bundle(
      [
        { id: 'home', path: '', title: 'Home', source: '<form data-sw-form="contact"><input name="email" /></form>' },
        {
          id: 'home-de',
          path: 'de',
          title: 'Start',
          locale: 'de',
          translationGroup: 'home',
          parent: 'home',
          source: '<form data-sw-form="contact"><input name="email" /></form>',
        },
      ],
      [contactForm(), contactForm({ id: 'contact-de', submitLabel: 'Absenden' })],
    );
    await buildSite({ publishedAt: at, outDir, bundle: b });
    const en = await readFile(join(outDir, 'index.html'), 'utf8');
    const de = await readFile(join(outDir, 'de/index.html'), 'utf8');
    expect(en).toContain('data-sw-routed="contact"');
    expect(de).toContain('data-sw-routed="contact-de"');
    expect(en).not.toContain('data-sw-endpoint');
    expect(de).not.toContain('data-sw-endpoint');
  });

  it('an unknown form id fails the publish loudly with the page + form named', async () => {
    const b = bundle([{ id: 'home', path: '', title: 'Home', source: '{{sw-form "missing"}}' }], [contactForm()]);
    await expect(buildSite({ publishedAt: at, outDir, bundle: b })).rejects.toThrow(PublishError);
    await expect(buildSite({ publishedAt: at, outDir, bundle: b })).rejects.toThrow(/page "home".*unknown form "missing"/);
  });

  it('a contactPhp form posts to the page-relative contact.php and carries the hidden _form field', async () => {
    const b = bundle(
      [
        {
          id: 'deep',
          path: 'a',
          title: 'A',
          source: '{{sw-form "contact"}}',
          // nest one level so the page-relative endpoint is exercised (a/index.html → ../contact.php)
        },
      ],
      [contactForm({ mode: 'contactPhp' as const })],
    );
    await buildSite({ publishedAt: at, outDir, bundle: b });
    const html = await readFile(join(outDir, 'a/index.html'), 'utf8');
    expect(html).toContain('data-sw-endpoint="../contact.php"');
    expect(html).toContain('name="_form"');
    expect(html).toContain('value="contact"');
    const php = await readFile(join(outDir, 'contact.php'), 'utf8');
    expect(php).toContain('<?php');
    expect(php).toContain('mail(');
    expect(php).toContain('secret-recipient@acme.com'); // baked server-side only
  });

  it('a thirdParty form posts directly to its https endpoint', async () => {
    const b = bundle(
      [{ id: 'home', path: '', title: 'Home', source: '{{sw-form "contact"}}' }],
      [contactForm({ mode: 'thirdParty' as const, thirdPartyUrl: 'https://hooks.example/x' })],
    );
    await buildSite({ publishedAt: at, outDir, bundle: b });
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(html).toContain('data-sw-endpoint="https://hooks.example/x"');
  });

  it('renders the widget only when opted in AND the PROJECT configured a captcha (platform-routed only)', async () => {
    const page = { id: 'home', path: '', title: 'Home', source: '{{sw-form "contact"}}' };
    await buildSite({ publishedAt: at, outDir, bundle: bundle([page], [contactForm({ captcha: true })]), captcha: { provider: 'hcaptcha', siteKey: 'site-1' } });
    const withKey = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(withKey).toContain('class="h-captcha"');
    expect(withKey).toContain('data-sitekey="site-1"');
    await rm(outDir, { recursive: true, force: true });
    await buildSite({ publishedAt: at, outDir, bundle: bundle([page], [contactForm({ captcha: true })]) });
    const noKey = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(noKey).not.toContain('data-sitekey');
    expect(noKey).not.toContain('data-sw-captcha'); // inert, not broken
  });

  it('a form referenced from a chrome slot (footer) resolves like a page-body form', async () => {
    const b = bundle(
      [{ id: 'home', path: '', title: 'Home', source: '<div>hello</div>' }],
      [contactForm({ id: 'newsletter' })],
      { footer: '<div>{{sw-form "newsletter"}}</div>' },
    );
    await buildSite({ publishedAt: at, outDir, bundle: b });
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(html).toContain('data-sw-routed="newsletter"');
    expect(html).not.toContain('data-sw-endpoint');
  });

  it('a contactPhpSmtp form posts to the SAME contact.php, which delivers over SMTP', async () => {
    const b = bundle(
      [{ id: 'home', path: '', title: 'Home', source: '{{sw-form "contact"}}' }],
      [contactForm({ mode: 'contactPhpSmtp' as const })],
    );
    await buildSite({ publishedAt: at, outDir, bundle: b });
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(html).toContain('data-sw-endpoint="contact.php"'); // same handler as the mail() mode
    expect(html).toContain('name="_form"');
    const php = await readFile(join(outDir, 'contact.php'), 'utf8');
    expect(php).toContain('sw_smtp_send'); // …but the SMTP client is emitted
    expect(php).toContain('secret-recipient@acme.com'); // recipient still server-side only
  });

  // ★ The credentials live ONLY in a deploy payload (written by the main process — see
  // writePhpSmtpConfig). The BUILD must never emit them: this artifact is what gets persisted as
  // the published site and handed out by the member-readable /publish/archive zip.
  it('★ the build NEVER writes the SMTP credentials file, only the deny rule for it', async () => {
    const b = bundle(
      [{ id: 'home', path: '', title: 'Home', source: '{{sw-form "contact"}}' }],
      [contactForm({ mode: 'contactPhpSmtp' as const })],
    );
    await buildSite({ publishedAt: at, outDir, bundle: b });
    await expect(readFile(join(outDir, 'sw-mail.config.php'), 'utf8')).rejects.toThrow();
    const htaccess = await readFile(join(outDir, '.htaccess'), 'utf8');
    expect(htaccess).toContain('<Files "sw-mail.config.php">');
    expect(htaccess).toContain('Require all denied');
    // The deploy manifest names, sizes and HASHES every uploaded file, so serving it announces that
    // this site carries the credentials file and lets a stranger confirm a guessed copy byte for
    // byte. Denying one filename while the other describes it is not a boundary.
    expect(htaccess).toContain('<Files ".sw-deploy-manifest.json">');
  });

  it('emits no deny rule (and no .htaccess) when nothing needs protecting', async () => {
    const b = bundle(
      [{ id: 'home', path: '', title: 'Home', source: '{{sw-form "contact"}}' }],
      [contactForm({ mode: 'contactPhp' as const })],
    );
    await buildSite({ publishedAt: at, outDir, bundle: b });
    await expect(readFile(join(outDir, '.htaccess'), 'utf8')).rejects.toThrow();
  });

  it('does NOT generate contact.php when no form uses contactPhp', async () => {
    const b = bundle([{ id: 'home', path: '', title: 'Home', source: '{{sw-form "contact"}}' }], [contactForm()]);
    await buildSite({ publishedAt: at, outDir, bundle: b });
    await expect(readFile(join(outDir, 'contact.php'), 'utf8')).rejects.toThrow();
  });
});
