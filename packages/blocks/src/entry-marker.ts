// PREVIEW-ONLY entry marking: stamp `data-sw-entry` / `data-sw-dataset` onto the row's OWN root
// element(s) instead of wrapping the row in an injected `<div>`.
//
// Why this file exists at all. The dataset-aware `{{#each}}` (and the `{{#sw-pick-entry}}` block) has
// already flattened an iteration to a STRING by the time it wants to mark it — `options.fn(...)`
// returns HTML text, and you cannot set an attribute on text. So it used to wrap:
//
//     <div data-sw-entry="…" data-sw-dataset="…">…the authored row…</div>
//
// That wrapper exists ONLY in preview (`markEntries`); publish emits the bare row. So it is a
// preview-vs-published DOM divergence, which is the worst shape a styling bug can take: the editor
// shows a layout the live site will not have. Concretely, one extra level between a container and its
// rows breaks `gap` / `grid-template-columns` (they now space wrappers), Tailwind `space-x-*` and
// `divide-*` (they compile to `> * + *`), every `:nth-child` / `:first-child` rule, and Embla's slide
// selection (it takes `container.children`). A loop emitting `<tr>` is worse than mis-styled — a `<div>`
// is not allowed in a `<table>`, so the HTML parser HOISTS it out and the table falls apart.
//
// The fix is to put the attributes where they belong: on the element the author actually wrote. That
// makes the preview DOM identical to the published DOM plus two attributes, and as a bonus gives
// click-to-code a real element to resolve (see the preview bridge, which no longer has to step into
// `firstElementChild` to escape a wrapper that has no counterpart in the source).
//
// ★ POSITIONS, NOT A ROUND-TRIP. This deliberately does NOT parse → mutate → re-serialize. Handing the
// row to `dom-serializer` would renormalize attribute quoting, boolean attributes, entities and
// self-closing SVG tags — reintroducing exactly the preview/publish divergence we are removing here.
// htmlparser2 is used purely to LOCATE the top-level open tags; the attributes are then spliced into
// the original string, so the output is byte-identical apart from the insertions.
import { Parser } from 'htmlparser2';
import { escapeAttr } from './escape.js';

const ENTRY_ATTR = 'data-sw-entry';
const DATASET_ATTR = 'data-sw-dataset';

/** The top-level shape of a rendered row — everything the marking policy needs to decide. */
interface RowShape {
  /**
   * Insertion offsets for the row's top-level elements, in document order. Each is the offset just past
   * an open tag's NAME (`<div| class="card">`) — a legal place to add an attribute on any element, with
   * or without existing attributes and however the tag is closed (`>` or `/>`).
   */
  readonly sites: readonly number[];
  /** True when the row cannot be marked in place and must keep the wrapper. */
  readonly mustWrap: boolean;
}

/**
 * Scan a rendered row for its TOP-LEVEL element open tags.
 *
 * Depth is counted from htmlparser2's own open/close events, so void elements (`<br>`), implied closes
 * (`<li>` with no `</li>`), raw-text elements (`<script>`, `<style>`, `<textarea>`) and self-closing
 * foreign content (`<path/>` inside `<svg>`) are all handled by the parser rather than by a tag table
 * here — the class of bug a hand-rolled scanner exists to produce.
 *
 * `mustWrap` is set — meaning the caller keeps the injected wrapper — when in-place marking would be
 * wrong or would lose the affordance:
 *   • non-whitespace TEXT at the top level (`Hi {{name}} <b>x</b>`): marking only the elements would
 *     leave part of the row unclickable, and there is no element to carry the attributes for the text;
 *   • a top-level element that ALREADY carries `data-sw-entry` (a nested `{{#sw-pick-entry}}` whose
 *     output IS the whole row): stamping again would duplicate the attribute and silently retarget the
 *     inner marking, so the outer one takes the wrapper exactly as before.
 *
 * There is deliberately NO guard for an unbalanced row (`</div><span>…`): htmlparser2 DROPS an orphan
 * close tag rather than reporting it (measured), which is exactly what a browser does with the same
 * fragment — so the parser's idea of "top level" already agrees with the rendered DOM's, and a depth
 * counter can never go negative here.
 */
function scanRow(html: string): RowShape {
  const sites: number[] = [];
  let depth = 0;
  let mustWrap = false;
  const parser: Parser = new Parser(
    {
      onopentagname(name) {
        // The name event is where `startIndex` points at the `<`, so the insertion offset is simply
        // `< + name`. Taken here rather than at `onopentag` because by then the parser has consumed the
        // attributes and moved on.
        if (depth === 0) sites.push(parser.startIndex + 1 + name.length);
        depth += 1;
      },
      onopentag(_name, attribs) {
        // Depth was already incremented above, so a TOP-LEVEL element sees depth 1 here.
        if (depth === 1 && Object.prototype.hasOwnProperty.call(attribs, ENTRY_ATTR)) mustWrap = true;
      },
      onclosetag() {
        depth -= 1;
      },
      ontext(text) {
        if (depth === 0 && text.trim() !== '') mustWrap = true;
      },
    },
    { decodeEntities: false },
  );
  parser.write(html);
  parser.end();
  return { sites, mustWrap };
}

/**
 * Stamp the entry markers onto a rendered row IN PLACE, or return null when the row has to keep the
 * injected wrapper (see `scanRow` for the three cases, plus a row with no element at all — bare text
 * or an empty body — which has nothing to stamp).
 *
 * Every top-level element is marked, not just the first: a row rendering siblings (`<dt>…</dt><dd>…</dd>`)
 * must open the entry editor from either half, and `closest('[data-sw-entry]')` has to resolve from
 * anywhere inside it.
 */
export function markEntryInPlace(html: string, id: string, dataset: string): string | null {
  if (!html.includes('<')) return null; // no element to carry the attributes
  const { sites, mustWrap } = scanRow(html);
  if (mustWrap || sites.length === 0) return null;
  const attrs = ` ${ENTRY_ATTR}="${escapeAttr(id)}" ${DATASET_ATTR}="${escapeAttr(dataset)}"`;
  // Splice from the END so each insertion cannot shift the offsets still to be used.
  let out = html;
  for (let i = sites.length - 1; i >= 0; i -= 1) {
    // eslint-disable-next-line security/detect-object-injection -- i is a bounded loop index
    const at = sites[i] as number;
    out = `${out.slice(0, at)}${attrs}${out.slice(at)}`;
  }
  return out;
}

/** The injected wrapper — the fallback for a row that cannot carry the markers itself. */
export function wrapEntry(html: string, id: string, dataset: string): string {
  return `<div ${ENTRY_ATTR}="${escapeAttr(id)}" ${DATASET_ATTR}="${escapeAttr(dataset)}">${html}</div>`;
}

/**
 * Mark one rendered dataset row for the preview: attributes on its own root element(s) when that is
 * possible, else the injected wrapper. The ONE entry point both the dataset `{{#each}}` and
 * `{{#sw-pick-entry}}` use, so the two can never drift apart.
 */
export function markEntry(html: string, id: string, dataset: string): string {
  return markEntryInPlace(html, id, dataset) ?? wrapEntry(html, id, dataset);
}
