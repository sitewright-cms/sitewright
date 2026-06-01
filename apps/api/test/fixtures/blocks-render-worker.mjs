/* global process */
// Test fixture worker that renders for real via the built @sitewright/blocks engine —
// mirrors src/render/render-worker.ts, but as a .mjs so the test env can fork it.
import { renderTemplate } from '@sitewright/blocks';

process.on('message', (msg) => {
  try {
    process.send({ id: msg.id, html: renderTemplate(msg.source, msg.context ?? {}, msg.opts ?? {}) });
  } catch (e) {
    process.send({ id: msg.id, error: e instanceof Error ? e.message : 'render failed' });
  }
});
process.on('disconnect', () => process.exit(0));
