// Summarise ModSecurity JSON audit logs (+ nginx access logs) per Sitewright route.
// usage: node analyze.mjs <routes.tsv> <platformHost> <out.json> <audit.log>... -- <access.log>...
import fs from 'node:fs';

const [routesFile, platformHost, outFile, ...rest] = process.argv.slice(2);
const sep = rest.indexOf('--');
const auditFiles = sep < 0 ? rest : rest.slice(0, sep);
const accessFiles = sep < 0 ? [] : rest.slice(sep + 1);

const routes = fs
  .readFileSync(routesFile, 'utf8')
  .trim()
  .split('\n')
  .map((l) => l.split('\t'))
  .map(([method, path]) => {
    // eslint-disable-next-line security/detect-non-literal-regexp -- built from the repo's own route paths (routes.mjs), every metacharacter escaped
    const re = new RegExp(
      '^' +
        path
          .replace(/\$\{[^}]+\}/g, ':x')
          .replace(/[.+?^$()|[\]\\]/g, '\\$&')
          .replace(/:[A-Za-z]+/g, '[^/]+')
          .replace(/\*/g, '.*') +
        '$',
    );
    return { method, path, re, specificity: path.replace(/:[A-Za-z]+|\*/g, '').length };
  })
  .sort((a, b) => b.specificity - a.specificity);

function routeOf(method, uri, host) {
  const path = uri.split('?')[0];
  const h = (host || '').toLowerCase();
  if (h && h !== platformHost.toLowerCase()) {
    // A site host (<slug>.<sites domain> or a custom domain): rewriteUrl maps everything but the
    // runtime endpoints to /sites/<slug>/...
    for (const p of ['/a/', '/f/', '/b/', '/pay/']) if (path.startsWith(p)) return `SITE-HOST ${method} ${matchRoute(method, path) ?? path}`;
    return `SITE-HOST ${method} (site page or asset)`;
  }
  return `${method} ${matchRoute(method, path) ?? `UNMATCHED ${path}`}`;
}
function matchRoute(method, path) {
  const m = method === 'HEAD' ? 'GET' : method;
  const hit = routes.find((r) => r.method === m && r.re.test(path)) ?? routes.find((r) => r.re.test(path));
  return hit?.path;
}

const plOf = (tags) => {
  const t = (tags || []).find((x) => x.startsWith('paranoia-level/'));
  return t ? Number(t.split('/')[1]) : 0;
};

const byRoute = new Map();
const get = (k) => {
  if (!byRoute.has(k)) byRoute.set(k, { requests: 0, logged: 0, matched: 0, blockedPL1: 0, statuses: {}, rules: {}, samples: {} });
  return byRoute.get(k);
};

for (const f of accessFiles) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = /"([A-Z]+) (\S+) HTTP\/[\d.]+" (\d{3})/.exec(line);
    if (!m) continue;
    // The access log does not carry the Host header, so every request counts under the platform host's
    // route; a SITE-HOST row's request count is therefore 0 (its matches still show).
    get(routeOf(m[1], m[2], platformHost)).requests++;
  }
}

let txCount = 0;
let unparsable = 0;
for (const f of auditFiles) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let t;
    try {
      t = JSON.parse(line).transaction;
    } catch {
      unparsable++;
      continue;
    }
    if (!t?.request) {
      unparsable++;
      continue;
    }
    txCount++;
    const req = t.request;
    const host = (req.headers?.Host || req.headers?.host || '').replace(/:\d+$/, '');
    const key = routeOf(req.method, req.uri, host);
    const r = get(key);
    // RelevantOnly also logs every 4xx/5xx response, with or without a rule match.
    r.logged++;
    const code = t.response?.http_code;
    r.statuses[code] = (r.statuses[code] || 0) + 1;
    const msgs = (t.messages || []).filter((m) => m?.details?.ruleId);
    if (msgs.length) r.matched++;
    // 949110 / 949111 = the inbound anomaly threshold (phase 2 / early blocking), 959100 = the outbound
    // one; 2000xx = the engine's own body checks (oversize body, too many arguments, unparsable body,
    // multipart errors). Each denies outright in blocking mode.
    if (msgs.some((m) => ['949110', '949111', '959100', '200002', '200003', '200004', '200007'].includes(m.details.ruleId))) r.blockedPL1++;
    for (const m of msgs) {
      const id = m.details.ruleId;
      if (['949110', '949111', '959100', '980170', '980140'].includes(id)) continue;
      const k = `${id}|PL${plOf(m.details.tags)}|${m.message}`;
      r.rules[k] = (r.rules[k] || 0) + 1;
      r.samples[k] ??= [];
      if (r.samples[k].length < 3) r.samples[k].push(`${req.uri.slice(0, 120)} :: ${(m.details.data || '').slice(0, 160)}`);
    }
  }
}

const out = [...byRoute.entries()]
  .filter(([, v]) => v.matched > 0)
  .sort((a, b) => b[1].blockedPL1 - a[1].blockedPL1 || b[1].matched - a[1].matched)
  .map(([route, v]) => ({ route, ...v }));
fs.writeFileSync(outFile, JSON.stringify({ txCount, unparsable, routes: out, all: Object.fromEntries([...byRoute].map(([k, v]) => [k, v.requests])) }, null, 1));
console.log(`${txCount} audit-log transactions${unparsable ? `, ${unparsable} UNPARSABLE lines (counts below are incomplete)` : ''}`);
for (const r of out) {
  console.log(`\n${r.route}  requests≈${r.requests} matched=${r.matched} wouldBlock=${r.blockedPL1} statuses=${JSON.stringify(r.statuses)}`);
  for (const [k, n] of Object.entries(r.rules).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(4)}  ${k}`);
    console.log(`         e.g. ${r.samples[k][0]}`);
  }
}
if (unparsable) process.exitCode = 1;
