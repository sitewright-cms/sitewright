import type { ServerResponse } from 'node:http';

/**
 * An AbortController that fires when the client disconnects, so in-flight work — a browser render, a
 * crawl, a model call — is torn down instead of holding a slot for a request nobody is waiting for.
 *
 * ★ ONE place, on purpose. This used to be written inline in every route that needed it, and an inline
 * closure like that is untestable: nothing in a test closes the socket at the right moment, so each copy
 * was a function no test ever ran. Here the wiring has one closure and one (real-socket) test, and a
 * route that needs it calls this.
 *
 * ★ It watches the RESPONSE, never the request. On Node ≥16 an IncomingMessage (`req.raw`) emits
 * 'close' as soon as its BODY has been consumed — for a POST that is before or just as the handler runs,
 * long before the client goes anywhere. Listening there either aborted live work at once (attached
 * synchronously) or, attached after an `await` like every authenticated route, attached to a stream
 * that had already closed and never fired: a hang-up cancelled nothing. The ServerResponse closes when
 * the CONNECTION does — or once the response is out — and `writableFinished` tells those apart (the same
 * test the /mcp route makes). The listener is dropped when the response finishes.
 *
 * Pass `abort` to wire up a controller the route already owns (it may have other reasons to abort —
 * a deadline, an explicit cancel); omit it to get a fresh one.
 */
export function abortOnClose(
  reply: { raw: Pick<ServerResponse, 'on' | 'once' | 'off' | 'writableFinished' | 'destroyed'> },
  abort: AbortController = new AbortController(),
): AbortController {
  const res = reply.raw;
  // Already closed: the client left before the route got here (during auth, say), and the 'close' this
  // would wait for has been emitted already. Unless the response itself went out, that is a hang-up.
  if (res.destroyed) {
    if (!res.writableFinished) abort.abort();
    return abort;
  }
  const onFinish = (): void => {
    res.off('close', onClose);
  };
  const onClose = (): void => {
    res.off('finish', onFinish);
    // The bytes can be out a tick before 'finish' is delivered — a close then is not a hang-up.
    if (!res.writableFinished) abort.abort();
  };
  res.once('close', onClose);
  res.once('finish', onFinish);
  return abort;
}
