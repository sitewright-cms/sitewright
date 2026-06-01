// Child-process render worker. Forked by RenderPool with a hard V8 heap ceiling
// (`--max-old-space-size`), so a pathological template OOMs THIS process (which the
// pool then respawns) rather than the API. One request in flight at a time — the pool
// guarantees that. renderTemplate is synchronous, validated, and prototype-locked.
import { renderTemplate, type TemplateContext, type RenderOptions } from '@sitewright/blocks';

interface RenderRequest {
  id: number;
  source: string;
  context: TemplateContext;
  opts?: RenderOptions;
}
interface RenderReply {
  id: number;
  html?: string;
  error?: string;
}

process.on('message', (msg: RenderRequest) => {
  let reply: RenderReply;
  try {
    reply = { id: msg.id, html: renderTemplate(msg.source, msg.context ?? {}, msg.opts ?? {}) };
  } catch (err) {
    reply = { id: msg.id, error: err instanceof Error ? err.message : 'render failed' };
  }
  process.send?.(reply);
});

// A disconnected IPC channel (parent gone) means we should exit, not linger.
process.on('disconnect', () => process.exit(0));
