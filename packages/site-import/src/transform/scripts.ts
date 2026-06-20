// Collect the imported site's <script>s (inline bodies + external src) ACROSS pages in first-seen
// document order, dedupe (external by absolute URL, inline by exact body), host each via the MediaPort
// as a served `.js`, and return `<script src="/media/…js" defer>` link tags for the `website.scripts`
// slot — so the cloned site stays interactive. The transform separately strips <script> from each page
// `source` (it can't hold scripts), so this is the ONLY place imported JS survives.
//
// @security Foreign-script execution is an explicit, OWNER-ONLY import choice (the cornerstone
// no-foreign-scripts rule is relaxed for these self-hosted refs only). The MediaPort adapter SSRF-guards
// every external fetch; emitted tags carry only `defer` (no inline body, no `on*`), and `website.scripts`
// renders after the page body. When the port has no `hostScript`, scripts are dropped (the safe default).
import { textContent } from 'domutils';
import { elements, type Document } from '../dom.js';
import type { MediaPort } from '../types.js';

const MAX_SCRIPTS = 60; // bound the number of hosted scripts per import
const MAX_INLINE_SCRIPT_BYTES = 512 * 1024; // bound each inline <script> body (defense-in-depth vs. the crawl budget)

/** Script `type` values that are executable JS (so we host them); others (ld+json, templates) are skipped. */
const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module']);

type ScriptRef = { kind: 'external'; url: string } | { kind: 'inline'; code: string };

function absUrl(src: string, base: string): string | null {
  try {
    const u = new URL(src, base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href.replace(/^http:/, 'https:') : null;
  } catch {
    return null;
  }
}

/** Gather the ordered, deduped script refs from every parsed page (reads the DOM; does not mutate). */
function collectRefs(parsed: ReadonlyArray<{ url: string; doc: Document }>): ScriptRef[] {
  const seen = new Set<string>();
  const refs: ScriptRef[] = [];
  for (const { url: pageUrl, doc } of parsed) {
    if (refs.length >= MAX_SCRIPTS) break; // cap reached → stop walking further pages
    for (const el of elements(doc.children)) {
      if (refs.length >= MAX_SCRIPTS) break; // cap reached → stop walking this page's remaining nodes
      if (el.name !== 'script') continue;
      if (!JS_TYPES.has((el.attribs.type ?? '').toLowerCase())) continue;
      const src = el.attribs.src;
      if (src !== undefined) {
        const abs = absUrl(src, pageUrl);
        if (!abs || seen.has(`e:${abs}`)) continue;
        seen.add(`e:${abs}`);
        refs.push({ kind: 'external', url: abs });
      } else {
        const code = textContent([el]).trim();
        if (!code || code.length > MAX_INLINE_SCRIPT_BYTES || seen.has(`i:${code}`)) continue;
        seen.add(`i:${code}`);
        refs.push({ kind: 'inline', code });
      }
    }
  }
  return refs;
}

/** Host every collected script in order; returns the `<script src>` link block for `website.scripts`. */
export async function collectAndHostScripts(parsed: ReadonlyArray<{ url: string; doc: Document }>, media: MediaPort): Promise<string> {
  if (!media.hostScript) return ''; // no host port → scripts are dropped (safe default)
  const refs = collectRefs(parsed);
  const links: string[] = [];
  for (const ref of refs) {
    const url = await media.hostScript(ref.kind === 'external' ? { url: ref.url } : { code: ref.code });
    if (url) links.push(`<script src="${url}" defer></script>`);
  }
  return links.join('\n');
}
