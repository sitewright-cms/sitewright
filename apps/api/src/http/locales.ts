// Multilingual locale management — the atomic, multi-entity operations behind the
// editor's "Add translation" flow (see docs/i18n-content-model.md). Adding a locale
// scaffolds every default-language page into it; removing one cascade-deletes that
// language's pages; "translate" propagates one page into all languages; "delete-group"
// removes a page across the languages that INHERIT its code (keeping forked/template
// variants). Each write goes through `applyLocaleChange` so a half-built locale subtree
// is never committed.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { LocaleSchema, IdSchema, KeyNameSchema, TRANSLATION_VALUE_MAX, type Page, type WebsiteSettings } from '@sitewright/schema';
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
const TranslateBody = z.object({ locales: z.array(LocaleSchema).max(100).optional() });
// One translation-catalog cell write (the inline `data-sw-translate` editor). `value` reuses the
// schema's TranslationCellsSchema bound (TRANSLATION_VALUE_MAX); an empty value clears the cell.
const TranslationCellBody = z.object({
  key: KeyNameSchema,
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
