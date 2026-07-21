import { newAssetId } from '../id.js';
import type { ContentRepository } from '../repo/content.js';
import { NotFoundError, type ProjectContext } from '../repo/context.js';

/**
 * Mints a fresh SHORT (6-char base62) media asset id that is unique WITHIN the project. A media id is
 * a per-project content key and the slug namespaces the public `/media/<slug>/<id>-<name>` URL, so a
 * collision only has to be avoided within one project's media — retry on the astronomically-rare
 * clash (`contentRepo.get` rejects when the id is free). The flat `<id>-<name>` storage/URL layout
 * keys off this short id (`isShortAssetId`).
 */
export async function mintAssetId(contentRepo: ContentRepository, ctx: ProjectContext): Promise<string> {
  for (let i = 0; i < 8; i += 1) {
    const id = newAssetId();
    const taken = await contentRepo
      .get(ctx, 'media', id)
      .then(() => true)
      // ONLY a genuine not-found means the id is free — rethrow a transient error (DB hiccup, etc.)
      // rather than treating it as available, which could clobber an existing asset (put is a blind upsert).
      .catch((err: unknown) => {
        if (err instanceof NotFoundError) return false;
        throw err;
      });
    if (!taken) return id;
  }
  throw new Error('could not mint a unique media asset id');
}
