/**
 * An AbortController that fires when the client disconnects, so in-flight work — a browser render, a
 * crawl, a model call — is torn down instead of holding a slot for a request nobody is waiting for.
 *
 * ★ ONE place, on purpose. This used to be written inline in every route that needed it
 * (`req.raw.on('close', () => abort.abort())`), and an inline closure like that is untestable: nothing
 * in a test closes the socket at the right moment, so each copy was a function no test ever ran. There
 * were eleven of them, which is most of why the function-coverage gate sat three functions above its
 * threshold and went red whenever an unrelated, timing-dependent handful failed to run. Here the wiring
 * has one closure and one test, and a route that needs it calls this.
 *
 * Pass `abort` to wire up a controller the route already owns (it may have other reasons to abort —
 * a deadline, an explicit cancel); omit it to get a fresh one.
 */
export function abortOnClose(
  req: { raw: { on: (event: 'close', cb: () => void) => unknown } },
  abort: AbortController = new AbortController(),
): AbortController {
  req.raw.on('close', () => abort.abort());
  return abort;
}
