/**
 * Strip a (possibly rich) label down to plain text: drops Handlebars helpers (`{{…}}` / `{{{…}}}`),
 * HTML tags, and entities, then collapses whitespace. Used for the plain-text fallback of a rich nav
 * label and for search/dropdown display where markup can't be rendered. Editor-side + short strings.
 */
export function plainText(name: string): string {
  return name
    .replace(/\{\{\{?[^}]*\}\}\}?/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:[a-z]+|#\d+);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
