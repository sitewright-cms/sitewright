import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectBundle } from '@sitewright/core';
import { buildSite } from '../src/publish/build.js';

let outDir: string;
beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'sw-forms-'));
});
afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

function bundle(): ProjectBundle {
  return {
    project: {
      id: 'proj1',
      name: 'Acme',
      slug: 'acme',
      brand: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    },
    pages: [
      {
        id: 'contact',
        path: '/contact',
        title: 'Contact',
        root: { id: 'r', type: 'Section', children: [{ id: 'f', type: 'Form', props: { formId: 'contact' } }] },
      },
    ],
    partials: [],
    datasets: [],
    entries: [],
    forms: [
      {
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
        hcaptcha: false,
      },
    ],
  } as unknown as ProjectBundle;
}

describe('buildSite — Form blocks', () => {
  it('emits an absolute submission endpoint and ships the form JS, never leaking the recipient', async () => {
    await buildSite({
      publishedAt: '2026-05-31T00:00:00.000Z',
      outDir,
      bundle: bundle(),
      publicBaseUrl: 'https://cms.example/',
    });
    const html = await readFile(join(outDir, 'contact', 'index.html'), 'utf8');
    expect(html).toContain('data-sw-component="form"');
    // Absolute endpoint to the platform (trailing slash on the base normalized away).
    expect(html).toContain('data-sw-endpoint="https://cms.example/f/proj1/contact"');
    expect(html).toContain('<input type="email" name="email" required');
    // The recipient (server-side) must NEVER appear in the exported HTML.
    expect(html).not.toContain('secret-recipient@acme.com');
    expect(html).not.toContain('New lead');
    // The component bundle (with the submit handler) is linked + written.
    expect(html).toContain('components.js');
    const js = await readFile(join(outDir, 'components.js'), 'utf8');
    expect(js).toContain("data-sw-component=\"form\"");
    expect(js).toContain('_elapsed');
  });

  it('falls back to a same-origin endpoint when no public base URL is set', async () => {
    await buildSite({ publishedAt: '2026-05-31T00:00:00.000Z', outDir, bundle: bundle() });
    const html = await readFile(join(outDir, 'contact', 'index.html'), 'utf8');
    expect(html).toContain('data-sw-endpoint="/f/proj1/contact"');
  });
});
