import { isSafeCssTokenValue } from '@sitewright/schema';

/** Resource/computing functions the schema refuses by name — for WORDING only; the gate is the schema's. */
const BLOCKED_FNS = ['url', 'src', 'image', 'image-set', 'element', 'expression'];

/**
 * Why a CSS token value would be REFUSED, in the author's words.
 *
 * `isSafeCssTokenValue` — the schema's own predicate — is the only thing that DECIDES; everything below
 * merely picks a message for a value already known to be invalid, and falls back to a generic one. So
 * this deliberately does NOT re-implement the guard's regex: a second copy would drift from the real
 * rule and start explaining a rejection that didn't happen (or staying silent on one that did).
 *
 * Shared by the token editor (the inline message) and the CSS tokens tile (its "needs attention" count),
 * so the tile can never disagree with the editor it opens.
 */
export function cssTokenError(value: string): string | null {
  if (isSafeCssTokenValue(value)) return value.length > 300 ? 'Too long (max 300 characters).' : null;
  const lower = value.toLowerCase();
  if (BLOCKED_FNS.some((fn) => lower.includes(`${fn}(`))) {
    return 'url() and other resource functions aren’t allowed — add images in the file manager instead.';
  }
  if (lower.includes('/*') || lower.includes('*/')) return 'CSS comments aren’t allowed in a token value.';
  if (lower.includes('@import')) return '@import isn’t allowed in a token value.';
  const depth = [...value].reduce((d, c) => d + (c === '(' ? 1 : c === ')' ? -1 : 0), 0);
  if (depth !== 0 || value.includes(')(')) return 'Unbalanced parentheses.';
  return 'Contains a character that isn’t allowed in a CSS value (; { } < > \\ or a line break).';
}
