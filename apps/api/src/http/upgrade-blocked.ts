import Fastify, { type FastifyInstance } from 'fastify';

/** HTML-escape for safe interpolation into the maintenance page (the message is a constant, but be safe). */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** A self-contained, theme-aware maintenance page shown when an upgrade is blocked (no external assets). */
function blockedPageHtml(message: string, version: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Upgrade blocked · Sitewright</title>
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
  font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  background:#f8fafc;color:#0f172a}
@media (prefers-color-scheme:dark){body{background:#0b1120;color:#e2e8f0}}
.card{max-width:640px;width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:16px;
  padding:32px;box-shadow:0 10px 40px rgba(2,6,23,.08)}
@media (prefers-color-scheme:dark){.card{background:#111a2e;border-color:#1e293b;box-shadow:none}}
.badge{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;
  color:#b45309;background:#fef3c7;border:1px solid #fde68a;border-radius:999px;padding:4px 12px}
@media (prefers-color-scheme:dark){.badge{color:#fcd34d;background:#422006;border-color:#78350f}}
h1{font-size:22px;margin:16px 0 8px}
p{margin:0 0 12px;color:#334155}
@media (prefers-color-scheme:dark){p{color:#94a3b8}}
.msg{margin-top:8px;padding:14px 16px;background:#f1f5f9;border-radius:10px;font-size:14.5px;color:#0f172a}
@media (prefers-color-scheme:dark){.msg{background:#0b1220;color:#e2e8f0}}
.foot{margin-top:20px;font-size:12.5px;color:#94a3b8}
</style></head><body><div class="card">
<span class="badge">⚠ Upgrade blocked</span>
<h1>This Sitewright instance can’t upgrade directly to this version</h1>
<p>To protect your data, the server is refusing to run and has changed nothing. An operator needs to
take a stepped-upgrade path:</p>
<div class="msg">${esc(message)}</div>
<p class="foot">Sitewright ${esc(version)} · the same message is printed to the container logs
(<code>[sitewright/upgrade]</code>).</p>
</div></body></html>`;
}

/**
 * A MINIMAL server that serves ONLY the upgrade-blocked error — used instead of the real app when the
 * DB is too old for this build to migrate safely (see `checkUpgradePath`). It never touches the DB or
 * runs migrations. `/ready` is 503 (so a load balancer won't route to it); a browser navigation gets the
 * HTML maintenance page; any API/JSON client gets `{ status: 'upgrade-blocked', error }` at 503.
 */
export function buildUpgradeBlockedApp(message: string, version: string): FastifyInstance {
  const app = Fastify({ logger: false });
  const html = blockedPageHtml(message, version);

  // Baseline security headers on every response (the real app sets these via its own onSend hook; the
  // maintenance page is scriptless + resource-free, so a tight policy fits — and it can't be framed).
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    return payload;
  });

  // Liveness stays GREEN (mirrors the real app's /health) — the process IS up; blocking is a readiness
  // state, not a crash. A k8s livenessProbe on /health must not restart-loop a deliberately-blocked pod.
  app.get('/health', async (_req, reply) => reply.code(200).send({ ok: true }));
  // Readiness is 503 so a load balancer / orchestrator drains traffic away from the blocked instance.
  app.get('/ready', async (_req, reply) => reply.code(503).send({ status: 'upgrade-blocked', error: message }));
  app.get('/version', async (_req, reply) => reply.code(200).send({ current: version, status: 'upgrade-blocked' }));
  app.setNotFoundHandler(async (req, reply) => {
    const accept = String(req.headers['accept'] ?? '');
    if (accept.includes('text/html')) {
      return reply.code(503).type('text/html; charset=utf-8').header('cache-control', 'no-store').send(html);
    }
    return reply.code(503).send({ status: 'upgrade-blocked', error: message });
  });
  return app;
}
