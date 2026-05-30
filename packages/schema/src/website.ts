import { z } from 'zod';

// Generous caps: project-wide CSS / analytics blocks can be sizeable, but bound
// them (defense-in-depth alongside the request body limit).
const MAX = 50_000;

/**
 * Project-wide website settings — the `website.*` namespace (contentBase's
 * WEBSITE tab). The raw HTML/CSS fields are the tenant's own content for their
 * own exported site; they are injected UNESCAPED at render time (see
 * `renderDocument` @security — owner/admin-set, sandboxed/exported only). More
 * fields (canonical url, container width, partial-slot assignments) arrive with
 * Phase 3 (partials).
 */
export const WebsiteSettingsSchema = z.object({
  /** Project-wide CSS inlined in `<head>` after the brand styles (contentBase `critical_css`). */
  criticalCss: z.string().max(MAX).optional(),
  /** Raw HTML injected into `<head>` — analytics/meta (contentBase `global_head`). */
  customHead: z.string().max(MAX).optional(),
  /** Raw HTML injected before `</body>` (contentBase `global_bottom`). */
  customFooter: z.string().max(MAX).optional(),
});
export type WebsiteSettings = z.infer<typeof WebsiteSettingsSchema>;
