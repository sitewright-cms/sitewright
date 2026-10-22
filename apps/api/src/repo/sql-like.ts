/**
 * `%` and `_` are LIKE wildcards. A query containing them must match them LITERALLY, or searching for
 * "100%" silently matches every row (trailing wildcard) and "cotton_shirt" matches "cottonXshirt".
 * Backslash is escaped first so it cannot escape the escape character. Pair with `ESCAPE '\'`.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
