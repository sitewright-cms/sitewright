import type { Database } from './db/client.js';
import { users } from './db/schema.js';
import { registerAccount } from './repo/accounts.js';
import { ProjectRepository } from './repo/projects.js';
import { ContentRepository } from './repo/content.js';
import { ProjectEventBus } from './events/bus.js';
import { MediaStorage } from './media/storage.js';
import { downloadGoogleFont } from './fonts/service.js';
import { createFontAsset } from './fonts/asset.js';
import { seedExampleAssets } from './seed-assets.js';
import type { CorporateIdentity } from '@sitewright/schema';
import {
  EXAMPLE_IDENTITY,
  EXAMPLE_WEBSITE,
  examplePages,
  EXAMPLE_DATASETS,
  exampleEntries,
  EXAMPLE_FORMS,
  EXAMPLE_SETTINGS,
} from './seed/index.js';

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
  /** The super-admin email (SW_ADMIN_EMAIL). The seeded user gets a persisted `platform_role='admin'`
   *  (admin is a role now, not an env email allowlist). */
  adminEmail: string;
  /** SW_ADMIN_PASSWORD; absent, empty, or whitespace-only → the FIXED default `123456` (warned about). */
  adminPassword?: string;
  /** Media storage root (MEDIA_ROOT). When set, the demo's LOCAL images + its showcase Google
   *  heading font are filed into the project's media library; absent (e.g. in unit tests) → the demo
   *  seeds without images/fonts (its refs resolve to empty/system, never a remote host). */
  mediaRoot?: string;
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
export async function seedInstance({ db, adminEmail, adminPassword, mediaRoot, log = () => {} }: SeedOptions): Promise<void> {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) return; // already bootstrapped — never re-seed

  // Trimmed: a whitespace-only env value must mean "use the default" (with the
  // warning), never an unguessable whitespace password that locks everyone out.
  const configured = adminPassword?.trim();
  const usingDefault = !configured;
  const password = configured || DEFAULT_ADMIN_PASSWORD;

  // The seeded super-admin holds the platform `admin` role (full access to every project +
  // instance settings); registration is otherwise invitation-only. When the well-known DEFAULT
  // password is in use, force a password change on first login (closes the known-credential hole);
  // an explicit SW_ADMIN_PASSWORD is trusted as already-chosen and is NOT forced.
  const { userId } = await registerAccount(db, adminEmail, password, {
    platformRole: 'admin',
    mustChangePassword: usingDefault,
  });
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
      assets = await seedExampleAssets(ctx, project.slug, contentRepo, new MediaStorage(mediaRoot));
    } catch (err) {
      log(
        `[sitewright/seed] WARNING: demo image generation failed (${err instanceof Error ? err.message : String(err)}); ` +
          `seeding the Example Project without images.`,
      );
    }
  }
  const entries = exampleEntries(assets);
  const pages = examplePages(assets);

  // Showcase typography: self-host a Google heading font (Space Grotesk — geometric, confident,
  // and a match for the studio brand) as a `kind:'font'` library asset so the demo ships with a
  // real webfont (visible + manageable in Assets), not just a system stack. BEST-EFFORT (same
  // rationale as the imagery): a fetch failure / no MEDIA_ROOT falls back to a DELIBERATE bold
  // system sans — never the schema-default serif, which reads as unstyled on Linux/Windows.
  // The body keeps the default sans-serif/400.
  let typography: CorporateIdentity['typography'] = {
    fontFamilies: {},
    heading: { source: 'system', family: 'sans-serif', weight: 700 },
  };
  if (mediaRoot) {
    try {
      const dl = await downloadGoogleFont('Space Grotesk', [500, 700]);
      const asset = await createFontAsset(contentRepo, new MediaStorage(mediaRoot), ctx, project.slug, {
        family: dl.family,
        fallback: dl.fallback,
        source: 'google',
        folder: 'Brand',
        faces: dl.faces.map((f) => ({ weight: f.weight, style: f.style, format: f.format, bytes: f.bytes })),
      });
      typography = {
        fontFamilies: {},
        heading: { source: 'asset', family: asset.family, weight: 700, assetId: asset.id },
      };
    } catch (err) {
      log(
        `[sitewright/seed] WARNING: demo Google-font download failed (${err instanceof Error ? err.message : String(err)}); ` +
          `seeding the Example Project with a system sans heading instead.`,
      );
    }
  }

  // Wire the generated brand marks into the Corporate Identity (Settings → CI): `logo` drives the
  // preloader + schema.org JSON-LD, `icon` the favicon, `image` the Open Graph / social share card.
  // Guarded on the asset map so the image-less seed (unit tests / no MEDIA_ROOT) keeps its prior shape.
  const brand: Partial<Pick<CorporateIdentity, 'logo' | 'icon' | 'image'>> = {};
  if (assets['brand-logo']) brand.logo = assets['brand-logo'];
  if (assets['brand-icon']) brand.icon = assets['brand-icon'];
  if (assets['brand-og']) brand.image = assets['brand-og'];

  await contentRepo.put(ctx, 'settings', 'settings', {
    identity: { ...EXAMPLE_IDENTITY, typography, ...brand },
    website: EXAMPLE_WEBSITE,
    // Multilingual demo: the FULL site exists per locale as inherit-mode variants (shared code,
    // translated page.data + localized slugs/datasets/forms/chrome strings) with hreflang + a
    // language switcher. EXAMPLE_SETTINGS keeps tests and the seed in lockstep.
    settings: EXAMPLE_SETTINGS,
  });
  // Local Hosting is now an opt-in `local` deploy target (the clean-break replacement for
  // website.localPublish). Seed one so the example is served at /sites/example/ after a publish.
  await contentRepo.put(ctx, 'deploy_target', 'local-hosting', {
    id: 'local-hosting',
    name: 'Local Hosting',
    protocol: 'local',
  });
  // CMS: dataset schemas + their entries (services / work / team / testimonials), then the
  // contact form, then the pages (which bind the datasets via `{{#each dataset.<slug>}}` and host the
  // Form block). Order doesn't matter for storage; an entry's `dataset` field (= the dataset slug)
  // keys the `dataset.*` namespace at build.
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
