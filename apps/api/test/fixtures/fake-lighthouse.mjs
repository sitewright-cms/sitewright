// A stand-in for the `lighthouse` module, imported by the Lighthouse worker thread in tests
// (runLighthouseIsolated's `moduleUrl`). `flags.mode` picks the behaviour.
export default async function fakeLighthouse(url, flags) {
  switch (flags.mode) {
    case 'result':
      return { lhr: { requestedUrl: url, formFactor: flags.formFactor, categories: { seo: { score: 1 } } } };
    case 'empty':
      return undefined;
    case 'chatty':
      // Lighthouse's own console output: must not reach the server's stdout, nor sit buffered unread.
      for (let i = 0; i < 2_000; i += 1) globalThis.console.log(`lighthouse chatter ${i} ${'x'.repeat(200)}`);
      return { lhr: { requestedUrl: url, chatty: true } };
    case 'lighthouse-error':
      throw Object.assign(new Error('NO_FCP'), { code: 'NO_FCP', friendlyMessage: { formattedDefault: 'The page did not paint any content.' } });
    case 'crash':
      throw new Error('connect ECONNREFUSED 127.0.0.1:9222');
    case 'heap': {
      // What a huge trace does to the in-process run: allocate until the heap ceiling.
      const hoard = [];
      for (;;) hoard.push(new Array(1_000_000).fill(hoard.length));
    }
    case 'hang':
      // Held open like a stalled DevTools socket would hold it — an empty promise lets the worker exit.
      return new Promise(() => globalThis.setInterval(() => {}, 1_000));
    default:
      throw new Error(`unknown mode ${flags.mode}`);
  }
}
