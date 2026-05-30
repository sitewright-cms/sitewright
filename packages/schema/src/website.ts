import { z } from 'zod';

// Bounded to limit build-output amplification (these fields are injected into
// every page of a publish, up to MAX_BUNDLE.pages). CSS is smaller than the
// HTML head/footer blocks in practice.
const CSS_MAX = 10_000;
const HTML_MAX = 20_000;

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
  criticalCss: z
    .string()
    .max(CSS_MAX)
    // Inlined inside `<style>` — reject a `</style>` breakout. (customHead/
    // customFooter are intentionally raw HTML and carry no such restriction.)
    .refine((v) => !/<\/style/i.test(v), 'criticalCss must not contain "</style"')
    .optional(),
  /** Raw HTML injected into `<head>` — analytics/meta (contentBase `global_head`). */
  customHead: z.string().max(HTML_MAX).optional(),
  /** Raw HTML injected before `</body>` (contentBase `global_bottom`). */
  customFooter: z.string().max(HTML_MAX).optional(),
});
export type WebsiteSettings = z.infer<typeof WebsiteSettingsSchema>;
