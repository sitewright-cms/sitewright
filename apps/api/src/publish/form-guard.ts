import { readFile } from 'node:fs/promises';
import { collectSiteFiles } from './adapters.js';
import { PublishError } from './build.js';

/**
 * Marker for a ROOT-RELATIVE platform-routed form endpoint in built HTML. A platform-routed form
 * (Email/SMTP delivery — `globalSmtp`/`userSmtp`) posts to `/f/<projectId>/<formId>`. The build bakes
 * that endpoint ABSOLUTE when a `publicBaseUrl` is configured (`https://host/f/…`), and root-relative
 * (`/f/…`) otherwise. The relative form is fine for LOCAL hosting — it shares the platform origin (path
 * form) or is reached via the subdomain carve-out — but on a REMOTE host it resolves to the deployed
 * site itself, where no such route exists, so the form silently 404s. (`contactPhp` posts to a
 * co-located `../contact.php`, and `thirdParty` to an external URL — neither carries this marker.)
 *
 * Depends on the built attribute staying double-quoted: dom-serializer always double-quotes and
 * `minifyPageHtml` does NOT enable `removeAttributeQuotes`. Revisit this marker if that changes.
 */
const RELATIVE_SW_FORM_ENDPOINT = 'data-sw-endpoint="/f/';

/**
 * Guards a REMOTE deploy: throws {@link PublishError} if the built site embeds a platform-routed form
 * with a root-relative endpoint (i.e. it was built without a `publicBaseUrl`). Call this ONLY on the
 * remote-deploy build path and only when no public URL is configured — a local build legitimately
 * emits relative endpoints. Returns normally when no such form is present (e.g. PHP/third-party forms,
 * or a build that already baked absolute endpoints).
 */
export async function assertRemoteFormEndpointsReachable(siteDir: string): Promise<void> {
  for (const file of await collectSiteFiles(siteDir)) {
    if (!file.rel.endsWith('.html')) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- abs path is confined to siteDir by collectSiteFiles
    const html = await readFile(file.abs, 'utf8');
    if (html.includes(RELATIVE_SW_FORM_ENDPOINT)) {
      throw new PublishError(
        'This site embeds a platform-routed form (Email/SMTP delivery) but the server has no public URL ' +
          'configured (SW_PUBLIC_URL), so the form endpoint is root-relative and would not submit from a ' +
          'remote host. Set SW_PUBLIC_URL, or switch the form to “PHP” or “third-party” delivery.',
      );
    }
  }
}
