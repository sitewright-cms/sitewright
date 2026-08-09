import { readFile } from 'node:fs/promises';
import { collectSiteFiles } from './adapters.js';
import { PublishError } from './build.js';

/**
 * A platform-routed form (Email/SMTP delivery — `globalSmtp`/`userSmtp`) posts to
 * `/f/<projectId>/<formId>`, built ABSOLUTE when a `publicBaseUrl` is configured and root-relative
 * otherwise. Relative is fine for LOCAL hosting — it shares the platform origin, or is reached via the
 * subdomain carve-out — but on a REMOTE host it resolves to the deployed site itself, where no such route
 * exists, so the form silently 404s. (`contactPhp`/`contactPhpSmtp` post to a co-located `../contact.php`
 * and `thirdParty` to an external URL — neither is platform-routed.)
 *
 * The endpoint is no longer a plain attribute: it must not sit in the markup as a ready-to-POST address,
 * so a routed form carries `data-sw-routed="<formId>"` and the URL is assembled at runtime from an
 * encoded payload. This guard therefore reads the PAYLOAD — an empty base is exactly the
 * "root-relative, unreachable from a remote host" case the check exists to catch. Keying it on the old
 * attribute would have left the guard matching nothing and silently passing every remote deploy.
 */
const ROUTED_FORM_MARKER = 'data-sw-routed';
/** The encoded resolver payload emitted by renderDocument (see formApiScript). */
const FORM_API_PAYLOAD_RE = /JSON\.parse\(atob\("([^"]+)"\)\)/;

/** The submission base the page will build its endpoint from, or null when the page carries no resolver. */
function endpointBaseOf(html: string): string | null {
  const m = FORM_API_PAYLOAD_RE.exec(html);
  if (!m?.[1]) return null;
  try {
    const parsed = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')) as { b?: unknown };
    return typeof parsed.b === 'string' ? parsed.b : null;
  } catch {
    return null; // unreadable payload → nothing to assert against; the deploy is not blocked on a guess
  }
}

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
    if (html.includes(ROUTED_FORM_MARKER) && endpointBaseOf(html) === '') {
      throw new PublishError(
        'This site embeds a platform-routed form (Email/SMTP delivery) but the server has no public URL ' +
          'configured (SW_PUBLIC_URL), so the form endpoint is root-relative and would not submit from a ' +
          'remote host. Set SW_PUBLIC_URL, or switch the form to “PHP” or “third-party” delivery.',
      );
    }
  }
}
