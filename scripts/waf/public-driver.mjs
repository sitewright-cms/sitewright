// Public and sign-in traffic through the WAF, shaped exactly like Sitewright's own runtimes and the
// MCP clients that log in to it: site pages + assets, the statistics beacon, form / booking / checkout
// posts, payment-provider webhooks, OAuth (DCR, authorize, consent, token, device), password login.
// The WAF's verdict is on the REQUEST, so an endpoint answering 4xx (no such form, no booking set up)
// still measures what a real visitor's request would meet.
// usage: node public-driver.mjs <direct base> <waf base> <sites domain> <projectId> <slug>
// Exits 1 when the site is not served (nothing below would measure anything).
import { createHash, randomBytes } from 'node:crypto';
// The first argument (the direct, WAF-less base) is part of the drivers' shared calling convention; this
// driver sends everything through the WAF.
const [, WAF, SITES, PROJECT, SLUG] = process.argv.slice(2);
const wafPort = new URL(WAF).port;
const SITE = `http://${SLUG}.${SITES}:${wafPort}`;
const results = [];
async function req(label, url, init = {}) {
  try {
    const res = await fetch(url, { redirect: 'manual', ...init });
    const body = await res.text();
    results.push(`${res.status}  ${label}`);
    return { status: res.status, body, headers: res.headers };
  } catch (e) {
    results.push(`ERR  ${label} ${e.message}`);
    return { status: 0, body: '' };
  }
}
const json = (b) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });

// ── 1. The published site: every page, typical campaign query strings, then the assets they load.
const home = await req('site /', `${SITE}/`);
if (home.status !== 200) {
  // Without a served site every page and asset below is silently skipped; say so and stop.
  console.error(`the site at ${SITE}/ answered ${home.status} — is the project published with Local Hosting?`);
  process.exit(1);
}
const links = [...home.body.matchAll(/href="(\/[^"#]*)"/g)].map((m) => m[1]).filter((h) => !/\.(css|ico|png|svg|webmanifest|xml)/.test(h));
const pages = [...new Set(links)].slice(0, 40);
for (const p of pages) await req(`site page ${p}`, `${SITE}${p}`);
for (const q of [
  '?utm_source=newsletter&utm_medium=email&utm_campaign=black-friday_2026&utm_content=hero-cta',
  '?gclid=Cj0KCQiA4NWrBhD-ARIsAFCKwWsZ1X-abc_DEF123&gad_source=1',
  '?fbclid=IwAR2F4-dbP0l7Mn1IA2Sb2VK0dcMbUu0pjlBXN5yDYVLG4G9IXQ',
  "?q=what's+new+in+2026%3F",
  '?ref=producthunt',
]) await req(`site / ${q.slice(0, 30)}`, `${SITE}/${q}`);
// eslint-disable-next-line security/detect-unsafe-regex -- test driver over the harness's own site; bounded classes, no nested quantifier on the same input
const assets = [...new Set([...home.body.matchAll(/(?:src|href)="(\/[^"]+\.(?:css|js|png|jpe?g|webp|avif|svg|woff2|ico|json|webmanifest)(?:\?[^"]*)?)"/g)].map((m) => m[1]))].slice(0, 60);
for (const a of assets) await req(`site asset ${a.split('?')[0].split('.').pop()}`, `${SITE}${a.replace(/&amp;/g, '&')}`);
for (const p of ['/robots.txt', '/sitemap.xml', '/search-index.json', '/favicon.ico', '/manifest.webmanifest', '/.well-known/security.txt']) await req(`site ${p}`, `${SITE}${p}`);

// ── 2. The statistics beacon, as stats.js sends it (sendBeacon of a string → text/plain).
const beacon = { r: '/', k: 'x'.repeat(43), h: `${SLUG}.${SITES}`, f: 'www.google.com', u: 'newsletter', m: 1, t: 1 };
await req('beacon text/plain (today)', `${SITE}/a/${PROJECT}`, { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(beacon) });
await req('beacon text/plain → platform', `${WAF}/a/${PROJECT}`, { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8', origin: SITE }, body: JSON.stringify(beacon) });
await req('beacon urlencoded (alternative)', `${WAF}/a/${PROJECT}`, form({ ...beacon, m: '1', t: '1' }));

// ── 3. Forms: what visitors actually type.
const visitorMessages = [
  { name: "Siobhán O'Brien", email: 'siobhan.obrien@example.ie', message: "Hi! I'd like a quote for 2 rooms — or is the 'Pro' package better? Please call me back after 5pm; thanks & regards" },
  { name: 'Jörg Müller-Lüdenscheidt', email: 'j.mueller@example.de', phone: '+49 (0) 30 1234-567', message: 'Guten Tag, bitte wählen Sie für uns das passende Paket aus und senden Sie mir ein Angebot (inkl. MwSt.) zu. Danke!' },
  { name: 'Sam', email: 'sam@example.com', message: 'Select the drop-down "Size" and choose 1 or 2? The order form says: size = "large" OR "x-large" -- which one fits?' },
  { name: 'Ana', email: 'ana@example.com', message: 'Our current site is https://www.old-agency.example.com/home and the shop is at http://shop.example.net:8080/ — can you migrate both?' },
  { name: 'Dev', email: 'dev@example.com', message: 'The <script> tag in your embed code breaks on WordPress; also `npm install` fails with "cat: /etc/os-release: No such file"' },
  { name: 'Emoji 🎉', email: 'party@example.com', message: 'Can we book the venue for 50 people on 12/24? 🎄🎅 Budget ~$2,000 (USD) & vegan food 🥗' },
];
for (const [i, m] of visitorMessages.entries()) {
  await req(`form challenge`, `${WAF}/f/${PROJECT}/contact/challenge`);
  await req(`form post #${i + 1}`, `${WAF}/f/${PROJECT}/contact`, json({ ...m, _hpt: '', _elapsed: '18342', _ix: `${'a'.repeat(16)}.${'b'.repeat(22)}.4`, _pow: `${randomBytes(8).toString('hex')}:${randomBytes(4).toString('hex')}` }));
}

// ── 4. Booking: availability, a booking with a note, pay and cancel.
await req('booking availability', `${WAF}/b/${PROJECT}/consult/availability?from=2026-11-20&to=2026-11-27&tz=Europe%2FBerlin&lang=de`);
await req('booking challenge', `${WAF}/b/${PROJECT}/consult/challenge`);
await req('booking post', `${WAF}/b/${PROJECT}/consult`, json({ start: '2026-11-23T09:30:00.000Z', end: '2026-11-23T10:00:00.000Z', tz: 'Europe/Berlin', fields: { name: "Siobhán O'Brien", email: 'siobhan@example.ie', notes: 'Please bring the 2nd draft; parking at the back (gate code 1234#)' }, _hpt: '', _elapsed: '42000' }));
await req('booking view', `${WAF}/b/${PROJECT}/_booking/BK-7Q2M-XYZ9?t=${randomBytes(16).toString('base64url')}`);
await req('booking pay', `${WAF}/b/${PROJECT}/_booking/BK-7Q2M-XYZ9/pay`, json({ lang: 'de' }));
await req('booking cancel', `${WAF}/b/${PROJECT}/_booking/BK-7Q2M-XYZ9/cancel`, json({}));
await req('booking feed .ics', `${WAF}/b/${PROJECT}/feed/${randomBytes(16).toString('hex')}.ics`);

// ── 5. Checkout from the cart, then the buyer's status poll.
await req('checkout post', `${WAF}/pay/${PROJECT}/shop`, json({
  items: [{ sku: 'TSHIRT-BLK-L', qty: 2 }, { sku: 'MUG-01', qty: 1 }],
  fields: { name: 'Jörg Müller', email: 'j.mueller@example.de', address: 'Hauptstr. 1; Hinterhaus, 2. OG', city: 'Berlin', zip: '10115', country: 'DE', notes: "Please leave at the door if I'm not home -- thanks!" },
  _hpt: '', _elapsed: '61000', _ix: 'abc.def.7', market: 'eu', shipTo: 'DE',
}));
await req('checkout status', `${WAF}/pay/${PROJECT}/txn/${randomBytes(18).toString('base64url')}`);

// ── 6. Payment-provider webhooks, in each provider's real shape.
const stripeEvent = {
  id: 'evt_1QxYz2LkdIwHu7ixAbCdEfGh', object: 'event', api_version: '2025-09-30.clover', created: 1794869000, type: 'checkout.session.completed', livemode: false,
  data: { object: { id: 'cs_test_a1B2c3D4e5F6g7H8i9J0', object: 'checkout.session', amount_total: 4990, currency: 'eur', client_reference_id: 'SW-2026-000123', customer_details: { name: "Siobhán O'Brien", email: 'siobhan@example.ie', address: { line1: 'Main St. 1', line2: 'Apt 2; rear', city: 'Dublin', postal_code: 'D02 X285', country: 'IE' } }, metadata: { txn: 'tx_9f8e7d6c' }, payment_status: 'paid', status: 'complete', success_url: 'https://acme.example/thank-you/?session_id={CHECKOUT_SESSION_ID}', url: null } },
};
await req('webhook stripe', `${WAF}/pay/${PROJECT}/webhook/stripe`, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', 'stripe-signature': `t=1794869000,v1=${randomBytes(32).toString('hex')}` }, body: JSON.stringify(stripeEvent) });
const paypalEvent = {
  id: 'WH-58D329510W468432D-8HN650336L201105X', event_version: '1.0', create_time: '2026-11-16T12:00:00.000Z', resource_type: 'checkout-order', event_type: 'CHECKOUT.ORDER.APPROVED', summary: 'An order has been approved by buyer',
  resource: { id: '5O190127TN364715T', status: 'APPROVED', intent: 'CAPTURE', payer: { name: { given_name: 'John', surname: "D'Angelo" }, email_address: 'buyer@example.com', payer_id: 'QYR5Z8XDVJNXQ' }, purchase_units: [{ reference_id: 'default', custom_id: 'tx_9f8e7d6c', invoice_id: 'SW-2026-000123', amount: { currency_code: 'EUR', value: '49.90' } }], links: [{ href: 'https://api.sandbox.paypal.com/v2/checkout/orders/5O190127TN364715T', rel: 'self', method: 'GET' }, { href: 'https://api.sandbox.paypal.com/v2/checkout/orders/5O190127TN364715T/capture', rel: 'capture', method: 'POST' }] },
  links: [{ href: 'https://api.sandbox.paypal.com/v1/notifications/webhooks-events/WH-58D329510W468432D-8HN650336L201105X', rel: 'self', method: 'GET' }],
};
await req('webhook paypal', `${WAF}/pay/${PROJECT}/webhook/paypal`, { method: 'POST', headers: { 'content-type': 'application/json', 'paypal-transmission-id': randomBytes(16).toString('hex'), 'paypal-transmission-sig': randomBytes(64).toString('base64'), 'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-1d93a270' }, body: JSON.stringify(paypalEvent) });
await req('webhook mollie (form)', `${WAF}/pay/${PROJECT}/webhook/mollie`, { ...form({ id: 'tr_WDqYK6vllg' }), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-mollie-signature': randomBytes(32).toString('hex') } });

// ── 7. OAuth, as MCP clients do it.
await req('well-known protected-resource', `${WAF}/.well-known/oauth-protected-resource`);
await req('well-known auth-server', `${WAF}/.well-known/oauth-authorization-server`);
await req('mcp without token (401 + challenge)', `${WAF}/mcp`, json({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.1.0' } } }));
const clients = {};
for (const [name, redirect] of [
  ['claude-code', 'http://localhost:53127/callback'],
  ['vscode', 'http://127.0.0.1:33418/'],
  ['claude.ai', 'https://claude.ai/api/mcp/auth_callback'],
]) {
  const r = await req(`oauth register (${name})`, `${WAF}/oauth/register`, json({ client_name: `${name} (sitewright)`, redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }));
  try { clients[name] = { id: JSON.parse(r.body).client_id, redirect }; } catch { clients[name] = { id: 'unknown', redirect }; }
}
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
for (const [name, c] of Object.entries(clients)) {
  const q = new URLSearchParams({ response_type: 'code', client_id: c.id, redirect_uri: c.redirect, code_challenge: challenge, code_challenge_method: 'S256', state: randomBytes(16).toString('base64url'), scope: 'content:read content:write', resource: `${WAF}/mcp` });
  await req(`oauth authorize GET (${name})`, `${WAF}/oauth/authorize?${q}`);
  await req(`oauth consent POST (${name})`, `${WAF}/oauth/authorize`, form({ client_id: c.id, redirect_uri: c.redirect, state: 'abc', code_challenge: challenge, code_challenge_method: 'S256', scope: 'content:read content:write', resource: `${WAF}/mcp`, project: PROJECT, decision: 'approve' }));
  await req(`oauth token (${name})`, `${WAF}/oauth/token`, form({ grant_type: 'authorization_code', code: randomBytes(24).toString('base64url'), redirect_uri: c.redirect, code_verifier: verifier, client_id: c.id, resource: `${WAF}/mcp` }));
  await req(`oauth refresh (${name})`, `${WAF}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: randomBytes(32).toString('base64url'), client_id: c.id, resource: `${WAF}/mcp` }));
}
await req('oauth device_authorization', `${WAF}/oauth/device_authorization`, form({ client_id: clients['claude-code'].id, scope: 'content:read content:write' }));
await req('oauth device page', `${WAF}/oauth/device?user_code=WDJB-MJHT`);

// ── 8. Password sign-in with password-manager style passwords.
// Wrong passwords for the seeded admin (the API answers 401; the WAF must not answer 403), then the
// right one.
const adminEmail = process.env.SW_WAF_ADMIN_EMAIL ?? 'admin@e2e.test';
const adminPassword = process.env.SW_WAF_ADMIN_PASSWORD ?? 'Pw-secret-1';
for (const pw of ["x7#K'q;--Lm2!vR", 'Tr0ub4dor&3<script>', 'p@ss w0rd OR 1=1', 'Zq9$`echo hi`|&;', adminPassword]) {
  await req(`login (generated-style password #${pw === adminPassword ? 'correct' : pw.length})`, `${WAF}/auth/login`, json({ email: adminEmail, password: pw }));
}

console.log(results.join('\n'));
