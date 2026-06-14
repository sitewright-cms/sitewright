// The `website.data` cell-write route — the persist behind an inline `{{sw-control
// target="website.data.<path>"}}` edit. `website.data` is the project-wide free-form JSON store (a
// GLOBAL counterpart to per-page `page.data`); editing one leaf is a focused, server-side
// read-modify-write of the settings singleton, so the client never round-trips the whole bundle (the
// Settings → Website "Edit data" modal still saves it in bulk via the settings PUT). Mirrors the
// translation cell route in locales.ts.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { WebsiteSettings } from '@sitewright/schema';
import { setWebsiteDataLeaf } from '@sitewright/core';
import type { ContentRepository, Settings } from '../repo/content.js';
import type { ProjectContext } from '../repo/context.js';
import type { ApiKeyCapability } from '../db/schema.js';

type ProjectReq = FastifyRequest<{ Params: { projectId: string } }>;

export interface WebsiteDataDeps {
  resolveProject: (
    req: ProjectReq,
    access: ApiKeyCapability | 'session-only',
  ) => Promise<{ ctx: ProjectContext; project: { id: string; slug: string } }>;
  contentRepo: ContentRepository;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

// `key` is a dotted path of identifier segments WITHIN website.data (e.g. `footerImage`, `hero.bg`);
// `value` is a string leaf. The whole settings bundle is re-validated (incl. WebsiteDataSchema bounds)
// on the put, so this length cap is just a cheap upfront guard.
const WEBSITE_DATA_VALUE_MAX = 10_000;
// A dotted path of identifier segments — validated by SPLITTING (a simple per-segment regex, no nested
// quantifiers → no ReDoS surface) rather than one combined pattern. Reject prototype-pollution segments
// at THIS (outermost) boundary too: the regex alone permits `__proto__` (underscores are id chars).
const WD_SEGMENT = /^[A-Za-z0-9_]+$/;
const WD_PROTO = new Set(['__proto__', 'constructor', 'prototype']);
const WebsiteDataCellBody = z.object({
  key: z
    .string()
    .min(1)
    .max(256)
    .refine((k) => k.split('.').every((s) => WD_SEGMENT.test(s) && !WD_PROTO.has(s)), 'invalid website.data key path'),
  value: z.string().max(WEBSITE_DATA_VALUE_MAX),
});

export function registerWebsiteDataRoutes(app: FastifyInstance, deps: WebsiteDataDeps): void {
  const { resolveProject, contentRepo, rl } = deps;

  app.put<{ Params: { projectId: string }; Body: unknown }>(
    '/projects/:projectId/website-data',
    { config: rl(120) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      const { key, value } = WebsiteDataCellBody.parse(req.body);
      // Belt-and-suspenders: the Zod refine already rejects prototype-pollution segments; this redundant
      // guard means a future schema change can't silently open the hole (setWebsiteDataLeaf also guards).
      if (key.split('.').some((s) => WD_PROTO.has(s))) {
        return reply.code(400).send({ error: 'invalid key path' });
      }
      const settings = (await contentRepo.get(ctx, 'settings', 'settings')) as Settings;
      const current =
        settings.website?.data && typeof settings.website.data === 'object' && !Array.isArray(settings.website.data)
          ? (settings.website.data as Record<string, unknown>)
          : {};
      // setWebsiteDataLeaf returns a plain Record; the bounded JsonObject shape is re-validated by the
      // settings put below (schemaFor('settings').parse), so the cast is safe.
      const nextData = setWebsiteDataLeaf(current, key, value) as WebsiteSettings['data'];
      const w: WebsiteSettings = { ...(settings.website ?? {}), data: nextData };
      await contentRepo.put(ctx, 'settings', 'settings', { ...settings, website: w });
      return reply.send({ key, value });
    },
  );
}
