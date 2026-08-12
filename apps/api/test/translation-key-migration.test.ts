import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsSchema, ContentRepository } from '../src/repo/content.js';
import { makeTestDb } from './helpers.js';
import { registerAccount, addProjectMember } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { content as content_ } from '../src/db/schema.js';
import { newId } from '../src/id.js';
import { type ProjectContext } from '../src/repo/context.js';
import type { Database } from '../src/db/client.js';

// The reserved translation keys were renamed flat → scoped (`cart_add` → `cart.add`) with NO read-time
// alias, so this preprocess is the ONLY thing standing between a live project and the silent loss of every
// cart/consent/theme override it has ever set. The unit tests in @sitewright/schema cover the mapping;
// this covers the wiring — that a settings row actually goes THROUGH it on read.
//
// The failure mode it guards is quiet: an unmigrated key renders as the built-in English default, so a
// shop's "N$" would revert to "$" with nothing logged and no test failing anywhere else.

const base = {
  identity: { name: 'Forever Living with Elvi', colors: {} },
  settings: { defaultLocale: 'en', locales: ['en'] },
};

describe('settings read: legacy translation keys are lifted onto their scoped names', () => {
  it('migrates a stored row through SettingsSchema, values byte-identical', () => {
    // The real catalog of project jUckbzJv9x00 — a single-locale Namibian shop.
    const parsed = SettingsSchema.parse({
      ...base,
      website: {
        shop: { enabled: true },
        translations: {
          cart_currency_symbol: { en: 'N$' },
          cart_currency_code: { en: 'NAD' },
          cart_title: { en: 'Your order' },
          cart_note: { en: 'Prices are indicative.' },
          nav_cta: { en: 'Order on WhatsApp' }, // an OPERATOR key — must survive untouched
        },
      },
    }) as { website?: { translations?: Record<string, Record<string, string>> } };

    const t = parsed.website!.translations!;
    expect(t['cart.currency_symbol']).toEqual({ en: 'N$' });
    expect(t['cart.currency_code']).toEqual({ en: 'NAD' });
    expect(t['cart.title']).toEqual({ en: 'Your order' });
    expect(t['cart.note']).toEqual({ en: 'Prices are indicative.' });
    expect(t.nav_cta).toEqual({ en: 'Order on WhatsApp' });
    // the legacy names are gone, not duplicated — a project must not carry both spellings
    expect(Object.keys(t).filter((k) => k.startsWith('cart_'))).toEqual([]);
  });

  it('lifts consent, theme and system keys too, not just the cart', () => {
    const parsed = SettingsSchema.parse({
      ...base,
      website: {
        translations: {
          consent_title: { en: 'Privacy' },
          theme_toggle: { en: 'Dark mode' },
          close: { en: 'Shut' },
          slide_next: { en: 'Onward' },
        },
      },
    }) as { website?: { translations?: Record<string, Record<string, string>> } };
    expect(Object.keys(parsed.website!.translations!).sort()).toEqual([
      'consent.title',
      'system.close',
      'system.slide_next',
      'theme.toggle',
    ]);
  });

  it('leaves an already-migrated row exactly as stored (idempotent on every read)', () => {
    const translations = { 'cart.title': { en: 'Your order' }, 'home.headline': { en: 'Hi' } };
    const parsed = SettingsSchema.parse({ ...base, website: { translations } }) as {
      website?: { translations?: Record<string, Record<string, string>> };
    };
    expect(parsed.website!.translations).toEqual(translations);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION (found live on :2003): wiring the migration into SettingsSchema alone was NOT enough.
// ContentRepository.get/list return `row.data` RAW — the kind's schema, and therefore its z.preprocess,
// runs on WRITE only. So publish read the UNMIGRATED catalog and a real shop's cart silently fell back
// from "N$" to the built-in "$" with nothing logged. These pin the READ boundary.
describe('ContentRepository read boundary lifts legacy translation keys', () => {
  let db: Database;
  let content: ContentRepository;
  let ctx: ProjectContext;

  beforeEach(async () => {
    db = await makeTestDb();
    content = new ContentRepository(db);
    const a = await registerAccount(db, 'a@acme.test', 'Pw-secret-1');
    const project = await new ProjectRepository(db).create({ name: 'A', slug: 'a' });
    await addProjectMember(db, a.userId, project.id, 'owner');
    ctx = { userId: a.userId, projectId: project.id, role: 'owner' };
  });

  /** Write the legacy shape straight past the schema, the way a row stored by an older build looks. */
  const seedLegacy = async () =>
    db.insert(content_).values({
      id: newId(),
      projectId: ctx.projectId,
      kind: 'settings',
      entityId: 'settings',
      scope: '',
      createdAt: new Date(),
      updatedAt: new Date(),
      data: {
        identity: { name: 'Elvi', colors: {} },
        settings: { defaultLocale: 'en', locales: ['en'] },
        website: { shop: { enabled: true }, translations: { cart_currency_symbol: { en: 'N$' }, nav_cta: { en: 'Order' } } },
      },
    });

  it('get() returns the SCOPED key for a row stored with the legacy name', async () => {
    await seedLegacy();
    const got = (await content.get(ctx, 'settings', 'settings')) as {
      website: { translations: Record<string, Record<string, string>> };
    };
    expect(got.website.translations['cart.currency_symbol']).toEqual({ en: 'N$' });
    expect(got.website.translations.cart_currency_symbol).toBeUndefined();
    expect(got.website.translations.nav_cta).toEqual({ en: 'Order' }); // operator key untouched
  });

  it('list() lifts too — publish reads the catalog through it', async () => {
    await seedLegacy();
    const [row] = (await content.list(ctx, 'settings')) as Array<{
      website: { translations: Record<string, Record<string, string>> };
    }>;
    expect(row!.website.translations['cart.currency_symbol']).toEqual({ en: 'N$' });
  });

  it('leaves other kinds alone', async () => {
    await content.put(ctx, 'page', 'home', { id: 'home', path: '', title: 'Home', source: '<p>hi</p>' });
    const page = (await content.get(ctx, 'page', 'home')) as { title: string };
    expect(page.title).toBe('Home');
  });
});
