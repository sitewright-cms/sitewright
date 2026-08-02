/**
 * Partial updates for `website.criticalCss`.
 *
 * The whole field is ONE string, and `?merge=1` deep-merges OBJECTS but replaces strings wholesale —
 * so changing a single rule meant re-transmitting the entire stylesheet inline in a tool call. Four
 * independent clone agents reported this as the most tedious mechanic of the job, one of them eleven
 * times against a ~19KB sheet:
 *
 *   "Every single CSS tweak — adding one class, changing one value — required re-sending the entire
 *    ~19KB stylesheet. An append mode, or splitting chrome CSS into a separately-addressable field,
 *    would have saved an enormous amount of tokens and turns."
 *
 * Plain appending is not enough on its own: an author who tweaks the same rule five times would leave
 * five copies behind (the last one wins in CSS, so it *works*, but the sheet grows without bound and
 * becomes unreadable). So a write may be NAMED, and a named write is an UPSERT: it replaces the block
 * of that name if present, appends it if not. Unnamed writes are a plain append.
 *
 * Blocks are delimited with CSS comments, which are valid anywhere a rule is and survive round-tripping
 * through the field untouched.
 */

/** Block names stay boring on purpose — they end up inside a CSS comment delimiter. */
export const CSS_BLOCK_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,48}$/;

const open = (name: string): string => `/* sw:block ${name} */`;
const close = (name: string): string => `/* /sw:block ${name} */`;

/** Locate a named block's full extent (delimiters included), or null when absent. */
function findBlock(sheet: string, name: string): { start: number; end: number } | null {
  const o = sheet.indexOf(open(name));
  if (o === -1) return null;
  const c = sheet.indexOf(close(name), o);
  // An unterminated opener means the sheet was hand-edited into an inconsistent state. Treat the
  // block as absent rather than swallowing the rest of the stylesheet on the next upsert.
  if (c === -1) return null;
  return { start: o, end: c + close(name).length };
}

/**
 * Apply a partial write to a stylesheet.
 *
 * - `name` + css  → upsert that block (replace in place, else append).
 * - `name` + ''   → remove that block.
 * - no `name`     → append the css at the end.
 *
 * Returns the new sheet. Pure: no validation of the CSS itself, which the settings schema and the
 * existing sanitiser still do on the way through `contentRepo.put`.
 */
export function applyCriticalCssPatch(
  current: string | null | undefined,
  css: string,
  name?: string | null,
): string {
  const sheet = (current ?? '').trim();
  const body = css.trim();

  if (!name) {
    if (!body) return sheet;
    return sheet ? `${sheet}\n${body}` : body;
  }

  const found = findBlock(sheet, name);
  const wrapped = body ? `${open(name)}\n${body}\n${close(name)}` : '';

  if (!found) {
    if (!wrapped) return sheet; // removing a block that isn't there is a no-op, not an error
    return sheet ? `${sheet}\n${wrapped}` : wrapped;
  }

  const before = sheet.slice(0, found.start).replace(/\s+$/, '');
  const after = sheet.slice(found.end).replace(/^\s+/, '');
  // Rejoin with single newlines so repeated upserts can't accumulate blank lines.
  return [before, wrapped, after].filter(Boolean).join('\n');
}

/** The names of every delimited block in a sheet, in document order. */
export function listCriticalCssBlocks(current: string | null | undefined): string[] {
  const out: string[] = [];
  const re = /\/\* sw:block ([a-zA-Z][a-zA-Z0-9_-]{0,48}) \*\//g;
  for (const m of (current ?? '').matchAll(re)) {
    const name = m[1]!;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}
