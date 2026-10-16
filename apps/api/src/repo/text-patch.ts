/**
 * Find-and-replace edits for one TEXT field of a stored entity — a page/template/snippet `source`, a
 * chrome slot, the site stylesheet.
 *
 * Every one of those is a single string, and `?merge=1` replaces strings wholesale, so fixing two lines
 * of a 20 KB page meant re-sending all 20 KB. An agent that built one bilingual site re-sent 12–26 KB
 * page sources about ten times over (adding `srcset` to 39 images, swapping a hero, two lines on a
 * contact page), and one of those calls arrived truncated. An edit names the exact text it replaces, so
 * it carries only what changes.
 *
 * THE ANCHOR MUST BE UNAMBIGUOUS. An `old` that occurs twice would edit whichever came first, which is
 * a guess; it is refused instead, with the count, so the caller widens the anchor. `all: true` is the
 * explicit opt-in to replace every occurrence. Edits apply IN ORDER, each to the result of the one
 * before, and the batch is all-or-nothing: one edit that doesn't match leaves the field untouched.
 */

export interface TextEdit {
  /** The exact text to replace. Must occur once (or at least once with `all`). */
  old: string;
  /** Its replacement. Empty deletes the matched text. */
  new: string;
  /** Replace EVERY occurrence instead of requiring exactly one. */
  all?: boolean;
}

/**
 * The authoring ceiling every patchable field shares (page `source`, the chrome slots and the stylesheet
 * are all capped at 256 KB by their schemas). Checked BEFORE each edit builds its string: `all:true`
 * multiplies, and chained edits compound, so a few hundred bytes of request could otherwise grow a
 * multi-hundred-megabyte string synchronously before the schema ever saw it.
 */
export const TEXT_PATCH_MAX = 256 * 1024;

export type TextPatchResult =
  | { ok: true; text: string; replacements: number }
  | { ok: false; edit: number; found: number; error: string };

/** How many times `needle` occurs in `hay`, counting non-overlapping matches left to right. */
function countOccurrences(hay: string, needle: string): number {
  let n = 0;
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) n += 1;
  return n;
}

/** The refusal for an edit whose result would exceed {@link TEXT_PATCH_MAX}, or null when it fits. */
function tooLarge(projected: number, edit: number): TextPatchResult | null {
  if (projected <= TEXT_PATCH_MAX) return null;
  return {
    ok: false,
    edit,
    found: 0,
    error: `edit ${edit + 1}: the result would be ${Math.ceil(projected / 1024)} KB — over the ${TEXT_PATCH_MAX / 1024} KB limit for this field`,
  };
}

/** Apply `edits` to `text` in order. Pure; literal matching (no regex, no `$&` replacement patterns). */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): TextPatchResult {
  let out = text;
  let replacements = 0;
  for (const [i, edit] of edits.entries()) {
    if (edit.old === '') {
      return { ok: false, edit: i, found: 0, error: `edit ${i + 1}: \`old\` is empty — name the exact text to replace` };
    }
    const first = out.indexOf(edit.old);
    if (first === -1) {
      return {
        ok: false,
        edit: i,
        found: 0,
        error: `edit ${i + 1}: \`old\` was not found${i > 0 ? ' (after the edits before it were applied)' : ''} — copy it exactly from the current text, whitespace included`,
      };
    }
    if (edit.all) {
      const count = countOccurrences(out, edit.old);
      const tooBig = tooLarge(out.length + count * (edit.new.length - edit.old.length), i);
      if (tooBig) return tooBig;
      replacements += count;
      out = out.split(edit.old).join(edit.new);
      continue;
    }
    // A second START anywhere after the first — overlapping included — makes the anchor ambiguous.
    if (out.indexOf(edit.old, first + 1) !== -1) {
      const found = countOccurrences(out, edit.old);
      return {
        ok: false,
        edit: i,
        found,
        error: `edit ${i + 1}: \`old\` matches ${found > 1 ? `${found} times` : 'more than once (overlapping)'} — include more surrounding text so it matches exactly once, or pass all:true to replace every occurrence`,
      };
    }
    const tooBig = tooLarge(out.length + edit.new.length - edit.old.length, i);
    if (tooBig) return tooBig;
    out = out.slice(0, first) + edit.new + out.slice(first + edit.old.length);
    replacements += 1;
  }
  return { ok: true, text: out, replacements };
}

/**
 * The text fields an edit may address, per content kind, as a path into the stored entity. Deliberately
 * an allowlist: these are the long strings people actually re-send, and every one of them already goes
 * through a save-time validator (template safety for sources and chrome slots, the settings schema for
 * the stylesheet). Operator-only raw fields (`website.head`, `website.scripts`) are not on it.
 */
export const TEXT_PATCH_FIELDS: Readonly<Record<string, readonly string[]>> = {
  page: ['source'],
  template: ['source'],
  snippet: ['source'],
  settings: ['website.mainNav', 'website.footer', 'website.sidebarLeft', 'website.sidebarRight', 'website.bottom', 'website.criticalCss'],
};

/** Read a dotted text field (absent / non-string → ''). */
export function readTextField(entity: unknown, field: string): string {
  let at: unknown = entity;
  for (const key of field.split('.')) {
    if (!at || typeof at !== 'object') return '';
    at = (at as Record<string, unknown>)[key];
  }
  return typeof at === 'string' ? at : '';
}

/** A copy of `entity` with the dotted text field set to `value` (intermediate objects copied, never mutated). */
export function writeTextField(entity: Record<string, unknown>, field: string, value: string): Record<string, unknown> {
  const [head, ...rest] = field.split('.');
  if (rest.length === 0) return { ...entity, [head!]: value };
  const child = entity[head!];
  const base = child && typeof child === 'object' && !Array.isArray(child) ? (child as Record<string, unknown>) : {};
  return { ...entity, [head!]: writeTextField(base, rest.join('.'), value) };
}
