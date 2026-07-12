import { readFileSync, writeFileSync } from 'node:fs';
const SP = process.argv[2];
const BASE = 'http://dind.local:2003';
const NID = readFileSync(SP + '/nid.txt', 'utf8').trim();
const jar = readFileSync(SP + '/sw-cookies.txt', 'utf8').split(/\n/).filter(l => l.trim() && (!l.startsWith('#') || l.startsWith('#HttpOnly_')));
const cookie = jar.map(l => l.replace(/^#HttpOnly_/, '').split(/\t/)).filter(a => a.length >= 7).map(a => `${a[5]}=${a[6]}`).join('; ');
const res = await fetch(`${BASE}/projects/${NID}/import/website/stream?foundation=1`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie, accept: 'text/event-stream' },
  body: JSON.stringify({ url: 'https://www.rbs.com.na/', maxPages: 15, maxDepth: 3 }),
});
console.log('HTTP', res.status);
if (!res.ok) { console.log((await res.text()).slice(0, 500)); process.exit(1); }
const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '', last = '';
while (true) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
  const parts = buf.split('\n\n'); buf = parts.pop();
  for (const p of parts) { const line = p.split('\n').find(l => l.startsWith('data:')); if (!line) continue;
    try { const ev = JSON.parse(line.slice(5).trim()); const tag = ev.phase||ev.type||ev.event||''; const detail = ev.detail||ev.message||(ev.url?ev.url.slice(-55):'')||''; const msg = `${tag} ${detail}`.trim();
      if (msg && msg !== last) { console.log('  •', msg); last = msg; }
      if (ev.report||ev.result||tag==='done'||tag==='complete') { writeFileSync(SP+'/import-report.json', JSON.stringify(ev,null,2)); console.log('REPORT SAVED'); }
      if (ev.error||tag==='error') console.log('  !! ERROR', JSON.stringify(ev).slice(0,400));
    } catch {} } }
console.log('IMPORT STREAM CLOSED');
