/* global process */
// Test fixture worker speaking the RenderPool protocol. Special `source` values trigger
// reliability scenarios without depending on a real (bounded) Handlebars render.
process.on('message', (msg) => {
  const { id, source } = msg;
  if (source === '__CRASH__') process.exit(1); // simulate a crash/OOM exit
  if (source === '__SLEEP__') return; // never reply → exercises the pool's timeout
  process.send({ id, html: `R:${source}` });
});
process.on('disconnect', () => process.exit(0));
