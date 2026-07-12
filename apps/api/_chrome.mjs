import { readFileSync } from 'node:fs';
const SP = process.argv[2];
const BASE = 'http://dind.local:2003';
const BID = readFileSync(SP + '/bid.txt', 'utf8').match(/[A-Za-z0-9]+\s*$/)[0].trim();
const jar = readFileSync(SP + '/../sw-cookies.txt', 'utf8').split(/\n/).filter(l => l.trim() && (!l.startsWith('#') || l.startsWith('#HttpOnly_')));
const cookie = jar.map(l => l.replace(/^#HttpOnly_/, '').split(/\t/)).filter(a => a.length >= 7).map(a => `${a[5]}=${a[6]}`).join('; ');
const H = { 'content-type': 'application/json', cookie };
const settings = JSON.parse(readFileSync(SP + '/settings.json', 'utf8')).items[0];
// The "GET IN TOUCH" contact <dialog> in website.bottom renders inline in the page flow (empty bordered
// box on every page). Clear it for the clone (a triggered modal can be reintroduced cleanly later).
// The footer also carries a Google-Maps <iframe> the original footer doesn't have (renders as an empty
// white box on every page since it doesn't load headless) — strip it, keeping the dark office columns.
let footer = settings.website.footer || '';
footer = footer.replace(/<iframe\b[^>]*maps\/embed[^>]*>\s*<\/iframe>/gi, '');
settings.website = { ...settings.website, bottom: '', footer };
const r = await fetch(`${BASE}/projects/${BID}/content/settings/settings`, { method: 'PUT', headers: H, body: JSON.stringify(settings) });
console.log('settings PUT', r.status, r.ok ? 'OK (cleared website.bottom)' : (await r.text()).slice(0, 200));
