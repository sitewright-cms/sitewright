// Hoist GLOBAL modals into the site-wide `website.bottom` slot. The nativizer emits a modal container as
// `<dialog data-sw-component="modal" id="…">…</dialog>` inside each page. A modal that appears (same id) on
// MOST pages is site-wide chrome — it belongs once in `website.bottom`, not duplicated in every page, with
// the per-page triggers (`<a href="#id">` / `[data-sw-modal-open]`) opening it via the platform runtime.
// A modal on a single page is page-LOCAL and stays put. Pure string transform → unit-tested, no DOM.

interface ModalSpan {
  start: number;
  end: number;
  id: string;
  html: string;
}

function listModals(html: string): ModalSpan[] {
  // Local regex instances (the `/g` lastIndex is mutable — module-level globals would clash if two
  // projects nativize concurrently). `data-sw-component="modal"` is emitted only on the modal CONTAINER
  // (never the inner parts), so it's the reliable anchor; depth-count <dialog> open/close to find the end.
  const OPEN_RE = /<dialog\b[^>]*\bdata-sw-component="modal"[^>]*>/gi;
  const DIALOG_TAG_RE = /<\/?dialog\b[^>]*>/gi;
  const spans: ModalSpan[] = [];
  let m: RegExpExecArray | null;
  while ((m = OPEN_RE.exec(html))) {
    const idM = m[0].match(/\bid="([^"]+)"/i);
    if (!idM) continue;
    let depth = 1;
    DIALOG_TAG_RE.lastIndex = OPEN_RE.lastIndex;
    let t: RegExpExecArray | null;
    while ((t = DIALOG_TAG_RE.exec(html))) {
      if (t[0][1] === '/') {
        depth -= 1;
        if (depth === 0) {
          const end = DIALOG_TAG_RE.lastIndex;
          spans.push({ start: m.index, end, id: idM[1]!, html: html.slice(m.index, end) });
          OPEN_RE.lastIndex = end; // resume past this modal so a nested modal-dialog isn't re-opened
          break;
        }
      } else depth += 1;
    }
  }
  return spans;
}

export interface HoistedModals {
  /** One copy of each global modal (dedup by id), for appending to `website.bottom`. Empty if none. */
  bottom: string;
  /** pageId → page html with its GLOBAL modals removed (page-local modals are left in place). */
  stripped: Map<string, string>;
}

/** Detect global modals (same id on ≥60% of pages, min 2) and hoist them out of the pages into `bottom`. */
export function hoistGlobalModals(pages: ReadonlyArray<{ id: string; html: string }>): HoistedModals {
  if (pages.length === 0) return { bottom: '', stripped: new Map() };
  const byId = new Map<string, { html: string; pageIds: Set<string> }>();
  const perPage = new Map<string, ModalSpan[]>();
  for (const p of pages) {
    const spans = listModals(p.html);
    perPage.set(p.id, spans);
    for (const s of spans) {
      const e = byId.get(s.id) ?? { html: s.html, pageIds: new Set<string>() };
      e.pageIds.add(p.id);
      byId.set(s.id, e);
    }
  }
  const threshold = Math.max(2, Math.ceil(pages.length * 0.6));
  const globalIds = [...byId.entries()].filter(([, v]) => v.pageIds.size >= threshold).map(([k]) => k);
  if (globalIds.length === 0) return { bottom: '', stripped: new Map() };
  const bottom = globalIds.map((id) => byId.get(id)!.html).join('\n');
  const globalSet = new Set(globalIds);
  const stripped = new Map<string, string>();
  for (const p of pages) {
    const toRemove = perPage.get(p.id)!.filter((s) => globalSet.has(s.id)).sort((a, b) => b.start - a.start); // last→first so offsets stay valid
    if (toRemove.length === 0) continue;
    let h = p.html;
    for (const s of toRemove) h = h.slice(0, s.start) + h.slice(s.end);
    stripped.set(p.id, h);
  }
  return { bottom, stripped };
}
