import type { Database } from './db/client.js';
import { users } from './db/schema.js';
import { registerAccount } from './repo/accounts.js';
import { ProjectRepository } from './repo/projects.js';
import { ContentRepository } from './repo/content.js';
import { ProjectEventBus } from './events/bus.js';
import { MediaStorage } from './media/storage.js';
import { FontStore } from './fonts/store.js';
import { selectGoogleFont } from './fonts/service.js';
import { seedExampleAssets } from './seed-assets.js';
import type { CorporateIdentity } from '@sitewright/schema';
import {
  EXAMPLE_IDENTITY,
  EXAMPLE_WEBSITE,
  examplePages,
  EXAMPLE_DATASETS,
  exampleEntries,
  EXAMPLE_FORMS,
} from './seed-data.js';

/** The built-in first-boot admin identity (override with SW_ADMIN_EMAIL). */
export const DEFAULT_ADMIN_EMAIL = 'admin@sitewright.example';
/**
 * The FIXED first-boot password (override with SW_ADMIN_PASSWORD). A deliberate,
 * documented product decision: the initial credentials are always the same and
 * never auto-generated, so a fresh instance is predictably reachable. The seed
 * warns loudly when this default is in use — change it after first login.
 */
export const DEFAULT_ADMIN_PASSWORD = '123456';

export interface SeedOptions {
  db: Database;
  /** The super-admin email (SW_ADMIN_EMAIL). Must also be in the instance-admin allowlist. */
  adminEmail: string;
  /** SW_ADMIN_PASSWORD; absent, empty, or whitespace-only → the FIXED default `123456` (warned about). */
  adminPassword?: string;
  /** Media storage root (MEDIA_ROOT). When set, the demo's LOCAL images are generated + filed
   *  into the project's media library; absent (e.g. in unit tests) → the demo seeds without
   *  images (its image refs resolve to empty, never a remote host). */
  mediaRoot?: string;
  /** Font cache root (FONT_ROOT). When set, the demo self-hosts a Google heading font to showcase
   *  typography; best-effort (a fetch failure just leaves the default serif heading). */
  fontRoot?: string;
  /** Sink for the one-time bootstrap notices (defaults to stdout via the caller). */
  log?: (message: string) => void;
}

/**
 * First-boot bootstrap. When the instance has NO users yet, create the super-admin and a
 * showcase "Example Project". Because public registration is invitation-only, this is the ONLY
 * way the first admin is created. The credentials default to the well-known
 * `admin@sitewright.example` / `123456` (never auto-generated); SW_ADMIN_EMAIL /
 * SW_ADMIN_PASSWORD override them.
 *
 * Idempotent by design: it returns immediately once ANY user exists, so re-deploys never
 * re-seed and a demo project the admin deleted stays deleted.
 */
export async function seedInstance({ db, adminEmail, adminPassword, mediaRoot, fontRoot, log = () => {} }: SeedOptions): Promise<void> {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) return; // already bootstrapped — never re-seed

  // Trimmed: a whitespace-only env value must mean "use the default" (with the
  // warning), never an unguessable whitespace password that locks everyone out.
  const configured = adminPassword?.trim();
  const usingDefault = !configured;
  const password = configured || DEFAULT_ADMIN_PASSWORD;

  // The seeded super-admin holds the platform `admin` role (full access to every project +
  // instance settings); registration is otherwise invitation-only.
  const { userId } = await registerAccount(db, adminEmail, password, { platformRole: 'admin' });
  log(
    usingDefault
      ? `[sitewright/seed] WARNING: created admin "${adminEmail}" with the DEFAULT password ` +
          `"${DEFAULT_ADMIN_PASSWORD}" — anyone who can reach this instance can sign in with it. ` +
          `Change it after first login (or set SW_ADMIN_PASSWORD before first boot).`
      : `[sitewright/seed] created admin "${adminEmail}".`,
  );

  // Seed the showcase project via the repos (same validation as the API). The admin is added as its
  // owner so the project list + member management behave exactly as a user-created project.
  const projects = new ProjectRepository(db);
  const contentRepo = new ContentRepository(db, new ProjectEventBus());
  // Atomic create + owner membership (same invariant as the API create route).
  const project = await projects.create({ name: 'Example Project', slug: 'example' }, userId);
  const ctx = { userId, projectId: project.id, role: 'owner' as const };

  // Generate the demo's LOCAL imagery into the media library (Projects/, Team/, Brand/ folders)
  // and reference it from the entries/pages below. BEST-EFFORT: image generation must never abort
  // the content seed (the idempotency guard above would otherwise lock in a half-seeded demo) —
  // on failure the demo simply seeds without images (missing keys default to '', never
  // `undefined`). No MEDIA_ROOT (e.g. unit tests) → skip entirely.
  let assets: Record<string, string> = {};
  if (mediaRoot) {
    try {
      assets = await seedExampleAssets(ctx, contentRepo, new MediaStorage(mediaRoot));
    } catch (err) {
      log(
        `[sitewright/seed] WARNING: demo image generation failed (${err instanceof Error ? err.message : String(err)}); ` +
          `seeding the Example Project without images.`,
      );
    }
  }
  const entries = exampleEntries(assets);
  const pages = examplePages(assets);

  // Showcase the typography feature: self-host a Google heading font (Playfair Display) so the demo
  // ships with a real webfont, not just a system stack. BEST-EFFORT (same rationale as the imagery
  // above): a fetch failure / no FONT_ROOT just leaves the schema-default serif heading. The body
  // keeps the default sans-serif/400.
  let typography: CorporateIdentity['typography'] | undefined;
  if (fontRoot) {
    try {
      const font = await selectGoogleFont(new FontStore(fontRoot), 'Playfair Display', [700]);
      typography = {
        fontFamilies: {},
        fonts: [font],
        heading: { source: 'google', family: font.family, weight: 700, fontId: font.id },
      };
    } catch (err) {
      log(
        `[sitewright/seed] WARNING: demo Google-font download failed (${err instanceof Error ? err.message : String(err)}); ` +
          `seeding the Example Project with the default serif heading.`,
      );
    }
  }

  await contentRepo.put(ctx, 'settings', 'settings', {
    identity: typography ? { ...EXAMPLE_IDENTITY, typography } : EXAMPLE_IDENTITY,
    website: EXAMPLE_WEBSITE,
    // Bilingual demo (English default + German): the showcase includes `/de` locale-variant
    // pages linked by `translationGroup`, a `services-de` dataset, and a language switcher.
    settings: { defaultLocale: 'en', locales: ['en', 'de'] },
  });
  // CMS: dataset schemas + their entries (services / work / team / testimonials), then the
  // contact form, then the pages (which bind the datasets via `{{#each data.<slug>}}` and host the
  // Form block). Order doesn't matter for storage; an entry's `dataset` field (= the dataset slug)
  // keys the `data.*` namespace at build.
  for (const dataset of EXAMPLE_DATASETS) {
    await contentRepo.put(ctx, 'dataset', dataset.id, dataset);
  }
  for (const entry of entries) {
    await contentRepo.put(ctx, 'entry', entry.id, entry);
  }
  for (const form of EXAMPLE_FORMS) {
    await contentRepo.put(ctx, 'form', form.id, form);
  }
  for (const page of pages) {
    await contentRepo.put(ctx, 'page', page.id, page);
  }
  const imageCount = Object.keys(assets).length;
  log(
    `[sitewright/seed] seeded "Example Project" (${pages.length} pages, ` +
      `${EXAMPLE_DATASETS.length} datasets, ${entries.length} entries, ${EXAMPLE_FORMS.length} form` +
      `${imageCount > 0 ? `, ${imageCount} local images` : ''}) — delete it from the editor once you've explored it.`,
  );
}
