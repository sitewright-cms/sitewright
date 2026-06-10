/** A 1-based source position (line/column) of a template-validation failure. */
export interface SourcePosition {
  line: number;
  column: number;
}

/**
 * Pull the `(line N, column N)` suffix the template validator appends to its error messages
 * (TemplateError) so the editor can place a gutter marker at the offending spot. Returns null
 * when the message carries no position (e.g. a non-template error).
 */
export function parseTemplateErrorPosition(message: string | null | undefined): SourcePosition | null {
  if (!message) return null;
  // Anchored to the end — TemplateError appends the position LAST (after any wrapper prefix), so this
  // can't be fooled by a `(line …)`-looking substring inside the message body.
  const m = /\(line (\d+), column (\d+)\)\s*$/.exec(message);
  return m ? { line: Number(m[1]), column: Number(m[2]) } : null;
}
