// Multilingual locale management — the atomic, multi-entity operations behind the
// editor's "Add translation" flow (see docs/i18n-content-model.md). Adding a locale
// scaffolds every default-language page into it; removing one cascade-deletes that
// language's pages; "translate" propagates one page into all languages; "delete-group"
// removes a page across the languages that INHERIT its code (keeping forked/template
// variants). Each write goes through `applyLocaleChange` so a half-built locale subtree
// is never committed.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { LocaleSchema, IdSchema, TranslationKeySchema, TRANSLATION_VALUE_MAX, type Page, type WebsiteSettings } from '@sitewright/schema';
import {
  scaffoldLocale,
  propagatePageToLocales,
  inheritingVariants,
  independentVariants,
  localeOf,
  pagesInLocale,
  setTranslationCell,
  pruneTranslationsLocale,
} from '@sitewright/core';
import type { ContentRepository, Settings } from '../repo/content.js';
import type { ProjectContext } from '../repo/context.js';
import type { ApiKeyCapability } from '../db/schema.js';

type ProjectReq = FastifyRequest<{ Params: { projectId: string } }>;

export interface LocaleDeps {
  resolveProject: (
    req: ProjectReq,
    access: ApiKeyCapability | 'session-only',
  ) => Promise<{ ctx: ProjectContext; project: { id: string; slug: string } }>;
  contentRepo: ContentRepository;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

const AddLocaleBody = z.object({ locale: LocaleSchema });
const SetDefaultLocaleBody = z.object({ locale: LocaleSchema });
const TranslateBody = z.object({ locales: z.array(LocaleSchema).max(100).optional() });
// One translation-catalog cell write (the inline `data-sw-translate` editor). `value` reuses the
// schema's TranslationCellsSchema bound (TRANSLATION_VALUE_MAX); an empty value clears the cell.
const TranslationCellBody = z.object({
  key: TranslationKeySchema,
  locale: LocaleSchema,
  value: z.string().max(TRANSLATION_VALUE_MAX),
});

/** Read the project's settings bundle + its pages — the inputs every locale op needs. */
async function loadContext(
  contentRepo: ContentRepository,
  ctx: ProjectContext,
): Promise<{ settings: Settings; pages: Page[] }> {
  const settings = (await contentRepo.get(ctx, 'settings', 'settings')) as Settings;
  const pages = (await contentRepo.list(ctx, 'page')) as Page[];
  return { settings, pages };
}

export function registerLocaleRoutes(app: FastifyInstance, deps: LocaleDeps): void {
  const { resolveProject, contentRepo, rl } = deps;

  // Add a translation target: append the locale to settings + scaffold a locale variant of
  // every default-language page (the locale subtree under `/<locale>/…`, code inherited).
  app.post<{ Params: { projectId: string }; Body: unknown }>(
    '/projects/:projectId/locales',
    { config: rl(20) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      const { locale } = AddLocaleBody.parse(req.body);
      const { settings, pages } = await loadContext(contentRepo, ctx);
      const defaultLocale = settings.settings.defaultLocale;
      if (locale === defaultLocale) {
        return reply.code(409).send({ error: `"${locale}" is already the default locale` });
      }
      if (settings.settings.locales.includes(locale)) {
        return reply.code(409).send({ error: `locale "${locale}" already exists` });
      }
      const { created, updated } = scaffoldLocale(pages, locale, defaultLocale);
      const nextSettings: Settings = {
        ...settings,
        settings: { ...settings.settings, locales: [...settings.settings.locales, locale] },
      };
      await contentRepo.applyLocaleChange(ctx, { putPages: [...updated, ...created], settings: nextSettings });
      return reply.code(201).send({ locale, created: created.length, pages: created });
    },
  );

  // Remove a translation target: drop the locale from settings + cascade-delete every page
  // that belongs to it. The default locale cannot be removed (it owns the code).
  app.delete<{ Params: { projectId: string; locale: string } }>(
    '/projects/:projectId/locales/:locale',
    { config: rl(20) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:delete');
      const locale = LocaleSchema.parse(req.params.locale);
      const { settings, pages } = await loadContext(contentRepo, ctx);
      const defaultLocale = settings.settings.defaultLocale;
      if (locale === defaultLocale) {
        return reply.code(400).send({ error: 'the default locale cannot be removed' });
      }
      if (!settings.settings.locales.includes(locale)) {
        return reply.code(404).send({ error: `locale "${locale}" is not configured` });
      }
      const removePageIds = pagesInLocale(pages, locale, defaultLocale).map((p) => p.id);
      const nextSettings: Settings = {
        ...settings,
        settings: {
          ...settings.settings,
          locales: settings.settings.locales.filter((l) => l !== locale),
        },
      };
      // Locale-sync: drop the removed language's column from the translation catalog so it never keeps
      // cells for a locale that no longer exists (a key left empty is dropped; an emptied catalog removed).
      if (settings.website?.translations) {
        const pruned = pruneTranslationsLocale(settings.website.translations, locale);
        const w: WebsiteSettings = { ...settings.website };
        if (Object.keys(pruned).length) w.translations = pruned;
        else delete w.translations;
        nextSettings.website = w;
      }
      await contentRepo.applyLocaleChange(ctx, { removePageIds, settings: nextSettings });
      return reply.send({ locale, removed: removePageIds.length });
    },
  );

  // Change the MAIN (default) language by RE-LABELLING it: the default-language content keeps its
  // pages/datasets and simply becomes the new language code, which replaces the old default in the
  // configured-locales list. This is a relabel, NOT a promotion of a translation — so the new main
  // language MUST NOT already be an active locale (that would collide with its translation). Nothing
  // is translated and no datasets are renamed: the default-locale pages carry no explicit `locale`
  // (they follow `defaultLocale`) and resolve the bare/base datasets, so only settings change. The
  // old default's catalog column is dropped (the default language never holds catalog cells).
  app.put<{ Params: { projectId: string }; Body: unknown }>(
    '/projects/:projectId/locales/default',
    { config: rl(20) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      const { locale } = SetDefaultLocaleBody.parse(req.body);
      const { settings, pages } = await loadContext(contentRepo, ctx);
      const old = settings.settings.defaultLocale;
      if (locale === old) {
        return reply.code(409).send({ error: `"${locale}" is already the main language` });
      }
      if (settings.settings.locales.includes(locale)) {
        return reply
          .code(409)
          .send({ error: `"${locale}" is already a language on this site — the new main language must be one that isn't added yet` });
      }
      // Invariant: the default locale is always in the configured list — bail rather than write a
      // self-inconsistent settings record (new default set but the list still naming the old one).
      if (!settings.settings.locales.includes(old)) {
        return reply.code(409).send({ error: 'settings inconsistency: the current main language is not in the locales list' });
      }
      // The old default keeps its slot in the list; the new code takes its place.
      const locales = settings.settings.locales.map((l) => (l === old ? locale : l));
      // Default-locale pages carry no explicit `locale` (so they follow the new default automatically).
      // Defensively re-tag any page that WAS explicitly the old default → unset, so it can't orphan.
      const putPages = pages
        .filter((p) => p.locale === old)
        .map((p) => {
          const next: Page = { ...p };
          delete next.locale;
          return next;
        });
      const nextSettings: Settings = {
        ...settings,
        settings: { ...settings.settings, defaultLocale: locale, locales },
      };
      // Carry the locale-keyed website settings over to the new code: the catalog drops the old
      // default's column (defensive — the default language uses inline `default=` copy), and the
      // `locale_flags` map (the documented convention the default nav reads) moves its old-default
      // entry to the new code so the language switcher's main-language flag keeps rendering.
      const websiteHasTranslations = !!settings.website?.translations;
      const flags = (settings.website?.data as { locale_flags?: Record<string, unknown> } | undefined)?.locale_flags;
      const flagsHaveOld = !!flags && typeof flags === 'object' && Object.prototype.hasOwnProperty.call(flags, old);
      if (websiteHasTranslations || flagsHaveOld) {
        const w: WebsiteSettings = { ...settings.website };
        if (websiteHasTranslations) {
          const pruned = pruneTranslationsLocale(settings.website!.translations!, old);
          if (Object.keys(pruned).length) w.translations = pruned;
          else delete w.translations;
        }
        if (flagsHaveOld) {
          const nextFlags = { ...(flags as Record<string, unknown>) };
          nextFlags[locale] = nextFlags[old];
          delete nextFlags[old];
          w.data = { ...(settings.website!.data as Record<string, unknown>), locale_flags: nextFlags } as WebsiteSettings['data'];
        }
        nextSettings.website = w;
      }
      await contentRepo.applyLocaleChange(ctx, { putPages, settings: nextSettings });
      return reply.send({ defaultLocale: locale, locales });
    },
  );

  // Make an existing default-language page available in all (or the given) languages —
  // the "new page → all languages" propagation. Each created variant inherits the page's code.
  app.post<{ Params: { projectId: string; pageId: string }; Body: unknown }>(
    '/projects/:projectId/pages/:pageId/translate',
    { config: rl(30) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      const pageId = IdSchema.parse(req.params.pageId);
      const body = TranslateBody.parse(req.body ?? {});
      const { settings, pages } = await loadContext(contentRepo, ctx);
      const defaultLocale = settings.settings.defaultLocale;
      const owner = pages.find((p) => p.id === pageId);
      if (!owner) return reply.code(404).send({ error: 'page not found' });
      if (localeOf(owner, defaultLocale) !== defaultLocale) {
        return reply
          .code(400)
          .send({ error: 'only a default-language page can be made available in all languages' });
      }
      const targets = (body.locales ?? settings.settings.locales).filter((l) => l !== defaultLocale);
      const { created, updated } = propagatePageToLocales(owner, pages, targets, defaultLocale);
      await contentRepo.applyLocaleChange(ctx, { putPages: [...updated, ...created] });
      return reply.code(201).send({ created: created.length, pages: created });
    },
  );

  // Cascade-delete a page across languages: remove the page + the variants that INHERIT its
  // code (they can't stand without it); KEEP forked/template variants (self-sufficient).
  app.post<{ Params: { projectId: string; pageId: string } }>(
    '/projects/:projectId/pages/:pageId/delete-group',
    { config: rl(30) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      const pageId = IdSchema.parse(req.params.pageId);
      const { settings, pages } = await loadContext(contentRepo, ctx);
      const defaultLocale = settings.settings.defaultLocale;
      const owner = pages.find((p) => p.id === pageId);
      if (!owner) return reply.code(404).send({ error: 'page not found' });
      if (owner.path === '') return reply.code(400).send({ error: 'the home page cannot be deleted' });
      // Only the MAIN-language page is a valid group-delete target — deleting from a variant would
      // tear its siblings apart from an unexpected starting point (mirrors the translate guard).
      if (localeOf(owner, defaultLocale) !== defaultLocale) {
        return reply.code(400).send({ error: 'only a default-language page can be deleted across languages' });
      }
      const cascaded = inheritingVariants(owner, pages);
      // Forked/template variants survive — but DETACH them from the now-deleted owner's group so a
      // future locale op doesn't resolve a dangling owner (they become standalone pages).
      const detached = independentVariants(owner, pages).map((p) => {
        const copy: Page = { ...p }; // fresh copy — deleting from it does not mutate the input
        delete copy.translationGroup;
        return copy;
      });
      const removePageIds = [owner.id, ...cascaded.map((p) => p.id)];
      await contentRepo.applyLocaleChange(ctx, { removePageIds, putPages: detached });
      return reply.send({ removed: removePageIds, kept: detached.map((p) => p.id) });
    },
  );

  // Set one project-translation cell: `website.translations[key][locale] = value` — the persist behind
  // the inline `data-sw-translate` editor (and reusable for any single-cell write). An EMPTY value clears
  // the cell (reverting to the default-language string); a key left with no cells is dropped. A focused,
  // server-side read-modify-write of the settings singleton so the client never round-trips the whole
  // bundle (the Settings → Translations grid still saves cells in bulk via the settings PUT).
  app.put<{ Params: { projectId: string }; Body: unknown }>(
    '/projects/:projectId/translations',
    { config: rl(120) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      const { key, locale, value } = TranslationCellBody.parse(req.body);
      // Read-modify-write of the settings singleton. Like every other settings write it has no optimistic
      // concurrency (last write wins) — acceptable: the inline editor debounces, and a cell is small.
      const settings = (await contentRepo.get(ctx, 'settings', 'settings')) as Settings;
      // Only a CONFIGURED locale may hold a cell (mirrors the DELETE guard) — never accumulate orphan
      // columns for a language that isn't in the project.
      if (locale !== settings.settings.defaultLocale && !settings.settings.locales.includes(locale)) {
        return reply.code(400).send({ error: `locale "${locale}" is not a configured project locale` });
      }
      const next = setTranslationCell(settings.website?.translations, key, locale, value);
      const w: WebsiteSettings = { ...(settings.website ?? {}) };
      if (Object.keys(next).length) w.translations = next;
      else delete w.translations;
      await contentRepo.put(ctx, 'settings', 'settings', { ...settings, website: w });
      return reply.send({ key, locale, value });
    },
  );
}
