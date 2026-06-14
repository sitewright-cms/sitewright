// Multilingual locale management — the atomic, multi-entity operations behind the
// editor's "Add translation" flow (see docs/i18n-content-model.md). Adding a locale
// scaffolds every default-language page into it; removing one cascade-deletes that
// language's pages; "translate" propagates one page into all languages; "delete-group"
// removes a page across the languages that INHERIT its code (keeping forked/template
// variants). Each write goes through `applyLocaleChange` so a half-built locale subtree
// is never committed.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { LocaleSchema, IdSchema, type Page } from '@sitewright/schema';
import {
  scaffoldLocale,
  propagatePageToLocales,
  inheritingVariants,
  independentVariants,
  localeOf,
  pagesInLocale,
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
}
