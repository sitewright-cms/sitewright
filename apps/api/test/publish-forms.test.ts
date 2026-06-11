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
      formatVersion: 2 as const,
      id: 'proj1',
      name: 'Acme',
      slug: 'acme',
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    },
    pages: [
      {
        id: 'contact',
        path: 'contact',
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
  it('does NOT generate contact.php when no form uses contactPhp', async () => {
    await buildSite({ publishedAt: '2026-05-31T00:00:00.000Z', outDir, bundle: bundle() });
    await expect(readFile(join(outDir, 'contact.php'), 'utf8')).rejects.toThrow();
  });

  it('generates a contact.php mail() handler for a contactPhp-mode form (recipient baked server-side)', async () => {
    const b = bundle();
    b.forms = [{ ...b.forms![0]!, mode: 'contactPhp' as const }];
    await buildSite({ publishedAt: '2026-05-31T00:00:00.000Z', outDir, bundle: b });
    const php = await readFile(join(outDir, 'contact.php'), 'utf8');
    expect(php).toContain('<?php');
    expect(php).toContain('mail('); // PHP mail() handler
    // The recipient is baked into the PHP (server-side), never the exported page HTML.
    expect(php).toContain('secret-recipient@acme.com');
  });
});
