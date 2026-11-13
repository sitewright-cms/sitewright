import type { SizeToken, ThumbFormat } from '@sitewright/image-pipeline';
import type { MediaAsset } from '@sitewright/schema';
import { encodeEstimateBytes, type ThumbRefs } from '../publish/media-thumbs.js';

interface LaneEntry {
  expires: number;
  /** `<assetId>/<size>:<format>` → the encode's memory estimate. */
  variants: Map<string, number>;
}

/**
 * The image variants a single-page preview just rendered, so their on-demand encodes may also use the
 * BUILD encode gate's free room (free memory, a CPU ceiling), and wait for a slot rather than be refused
 * when the public gate's three are taken.
 *
 * The thumbnail route is public, and its gate is what keeps anonymous traffic from taking the CPU and
 * memory builds run on. So the extra room is not open to a URL; it is open to exactly the variants a
 * member's preview of their own project references, for a few minutes — the work that project's
 * whole-site build would do for the same page anyway, and each variant is encoded once and then cached.
 *
 * Bounded: per project (newest variants kept), and across projects (the least recently previewed go).
 */
export class PreviewEncodeLane {
  private readonly projects = new Map<string, LaneEntry>();
  private total = 0;

  constructor(
    private readonly ttlMs = 10 * 60_000,
    private readonly maxPerProject = 4096,
    private readonly maxTotal = 32_768,
    private readonly now: () => number = Date.now,
  ) {}

  /** Opens the lane for the image variants in `refs` (as collected from the rendered page). */
  allow(slug: string, refs: ThumbRefs, media: readonly MediaAsset[]): void {
    this.sweep();
    const byId = new Map(media.map((a) => [a.id, a]));
    const prior = this.projects.get(slug);
    const variants = prior?.variants ?? new Map<string, number>();
    if (prior) this.projects.delete(slug); // re-inserted below: most recently previewed last
    this.total -= variants.size;
    for (const [assetId, want] of refs) {
      const asset = byId.get(assetId);
      if (!asset || asset.kind !== 'image') continue;
      const estimate = encodeEstimateBytes(asset.width, asset.height);
      for (const key of want.thumbs) {
        const k = `${assetId}/${key}`;
        variants.delete(k); // refreshed: the newest are kept when the project is over its bound
        variants.set(k, estimate);
      }
    }
    for (const k of variants.keys()) {
      if (variants.size <= this.maxPerProject) break;
      variants.delete(k);
    }
    if (variants.size === 0) return;
    this.projects.set(slug, { expires: this.now() + this.ttlMs, variants });
    this.total += variants.size;
    for (const [other, entry] of this.projects) {
      if (this.total <= this.maxTotal || other === slug) break;
      this.projects.delete(other);
      this.total -= entry.variants.size;
    }
  }

  /** The encode's memory estimate when this variant is open, else undefined. */
  estimate(slug: string, assetId: string, size: SizeToken, format: ThumbFormat): number | undefined {
    const entry = this.projects.get(slug);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.projects.delete(slug);
      this.total -= entry.variants.size;
      return undefined;
    }
    return entry.variants.get(`${assetId}/${size}:${format}`);
  }

  private sweep(): void {
    const now = this.now();
    for (const [slug, entry] of this.projects) {
      if (entry.expires > now) continue;
      this.projects.delete(slug);
      this.total -= entry.variants.size;
    }
  }
}
