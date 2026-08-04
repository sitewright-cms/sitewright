import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { IMAGE_MAP_TEMPLATES, ImageMapSchema } from '@sitewright/schema';
import { readTemplateConfig, readTemplateImage, templateConfigPath, templateImagePath } from '../src/imagemap-assets.js';

/**
 * The bundled starter templates are vendor DATA, ported once and then frozen — which makes them
 * exactly the thing that rots silently. These tests pin them to the schema they must satisfy and to
 * the assets they reference, so a schema tightening or a missing file fails here rather than when
 * an author picks a template and gets a 400 or a broken image.
 *
 * The vendor's real-estate export cost two rounds of this: its polygon `points` are `{x, y}` objects
 * (not `[x, y]` pairs), its grouped children omit `type`, and its FIRST artboard carries no `id`.
 */

/** Assign ids the way the from-template route does, so we validate what actually gets stored. */
function withArtboardIds(config: Record<string, unknown>): Record<string, unknown> {
  const artboards = config.artboards as Array<Record<string, unknown>>;
  const used = new Set(artboards.map((a) => a.id).filter((v): v is string => typeof v === 'string' && v !== ''));
  return {
    ...config,
    artboards: artboards.map((a) => {
      if (typeof a.id === 'string' && a.id !== '') return a;
      let fresh = `artboard-${randomUUID().slice(0, 8)}`;
      while (used.has(fresh)) fresh = `artboard-${randomUUID().slice(0, 8)}`;
      used.add(fresh);
      return { ...a, id: fresh };
    }),
  };
}

describe('bundled image map templates', () => {
  it('has the five ported demos', () => {
    expect(IMAGE_MAP_TEMPLATES.map((t) => t.id)).toEqual([
      'real-estate',
      'us-national-parks',
      'engineering',
      'education',
      'business',
    ]);
  });

  it.each(IMAGE_MAP_TEMPLATES.map((t) => [t.id, t] as const))('%s: config is on disk and parses', async (_id, t) => {
    expect(existsSync(templateConfigPath(t.id)!)).toBe(true);
    await expect(readTemplateConfig(t.id)).resolves.toBeTruthy();
  });

  it.each(IMAGE_MAP_TEMPLATES.map((t) => [t.id, t] as const))(
    '%s: validates against ImageMapSchema as it is stored',
    async (_id, t) => {
      const config = await readTemplateConfig(t.id);
      const result = ImageMapSchema.safeParse({ ...withArtboardIds(config!), id: t.id });
      // Surface the distinct issues rather than a 900-entry dump.
      const issues = result.success
        ? []
        : [...new Set(result.error.issues.map((i) => `${i.path.map((p) => (typeof p === 'number' ? '#' : p)).join('.')}: ${i.message}`))];
      expect(issues).toEqual([]);
    },
  );

  it.each(IMAGE_MAP_TEMPLATES.map((t) => [t.id, t] as const))(
    '%s: every change-artboard action resolves to a real artboard',
    async (_id, t) => {
      // A dangling target is invisible until a visitor clicks a floor and nothing happens.
      const config = withArtboardIds((await readTemplateConfig(t.id))!);
      const artboards = config.artboards as Array<Record<string, unknown>>;
      const ids = new Set(artboards.map((a) => a.id as string));
      const dangling: string[] = [];
      const walk = (objs: unknown): void => {
        if (!Array.isArray(objs)) return;
        for (const o of objs as Array<Record<string, unknown>>) {
          const a = (o.actions ?? {}) as { click?: string; artboard?: string };
          if (a.click === 'change-artboard' && a.artboard && !ids.has(a.artboard)) {
            dangling.push(`${String(o.title)} → ${a.artboard}`);
          }
          walk(o.children);
        }
      };
      for (const a of artboards) walk(a.children);
      expect(dangling).toEqual([]);
    },
  );

  it.each(IMAGE_MAP_TEMPLATES.map((t) => [t.id, t] as const))(
    '%s: declared images exist and the config references no foreign host',
    async (_id, t) => {
      const raw = readFileSync(templateConfigPath(t.id)!, 'utf8');
      // The vendor served these from its own CloudFront; a self-hosted install cannot depend on it.
      expect(raw).not.toContain('cloudfront');
      expect(raw).not.toMatch(/https?:\/\/[^"]+\.(?:jpg|jpeg|png|gif|webp)/i);

      for (const url of t.images) {
        expect(url.startsWith('/authoring/imagemaps/'), url).toBe(true);
        expect(raw).toContain(url);
        const file = url.split('/').pop()!;
        expect(templateImagePath(file), file).not.toBeNull();
        await expect(readTemplateImage(file)).resolves.toBeInstanceOf(Buffer);
      }
    },
  );

  it('metadata counts match the configs', async () => {
    for (const t of IMAGE_MAP_TEMPLATES) {
      const config = (await readTemplateConfig(t.id))!;
      const artboards = config.artboards as Array<Record<string, unknown>>;
      const count = (objs: unknown): number =>
        Array.isArray(objs)
          ? (objs as Array<Record<string, unknown>>).reduce((n, o) => n + 1 + count(o.children), 0)
          : 0;
      expect(artboards.length, `${t.id} artboards`).toBe(t.artboards);
      expect(
        artboards.reduce((n, a) => n + count(a.children), 0),
        `${t.id} hotspots`,
      ).toBe(t.hotspots);
    }
  });

  it('refuses an unknown template id and a traversal attempt', async () => {
    expect(templateConfigPath('nope')).toBeNull();
    expect(templateConfigPath('../../../etc/passwd')).toBeNull();
    expect(templateImagePath('../../../etc/passwd')).toBeNull();
    await expect(readTemplateConfig('../../package.json')).resolves.toBeNull();
    await expect(readTemplateImage('../../package.json')).resolves.toBeNull();
  });
});
