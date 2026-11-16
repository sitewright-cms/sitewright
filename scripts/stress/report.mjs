// Join a stress run: driver results (phases + request samples), the in-container sampler, and the
// --trace-gc log. Prints per-phase resource use, GC pressure, worst probe stalls, and a timeline.
// argv: runDir gcLog containerStartEpochSeconds
import { readFileSync, existsSync } from 'node:fs';

const [dir, gcPath, startedAt] = process.argv.slice(2);
const res = JSON.parse(readFileSync(`${dir}/results.json`, 'utf8'));
const smp = readFileSync(`${dir}/sampler.jsonl`, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const phaseOf = (t) => res.marks.find((m) => t >= m.start && t <= (m.end ?? Infinity))?.phase ?? '-';
const rel = (epoch) => epoch - res.t0;

// GC: "[1:0x...]   123456 ms: Mark-Compact 812.3 (850.1) -> 790.2 (851.0) MB, pooled: 0 MB, 412.33 / 0.00 ms ..."
const gcs = [];
if (gcPath && existsSync(gcPath)) {
  for (const line of readFileSync(gcPath, 'utf8').split('\n')) {
    const m = /^\[(\d+):0x[0-9a-f]+\]\s+(\d+) ms: (Mark-Compact|Mark-Sweep[^ ]*|Mark-Compact \(reduce\)) ([\d.]+) \(([\d.]+)\) -> ([\d.]+) \(([\d.]+)\) MB.*?, ([\d.]+) \/ ([\d.]+) ms/.exec(line);
    if (!m || m[1] !== '1') continue; // PID 1 = the API process (worker threads log their own pid too)
    gcs.push({ t: rel(Number(startedAt) + Number(m[2]) / 1000), before: +m[4], after: +m[6], pause: +m[8], reason: (/\(([^)]*)\)\s*$/.exec(line) ?? [])[1] ?? '' });
  }
}

const agg = {};
for (const s of smp) {
  const ph = phaseOf(rel(s.t));
  const a = (agg[ph] ??= { n: 0, cg: 0, cgMax: 0, main: 0, mainMax: 0, api: 0, memMax: 0, anonMax: 0, rssMax: 0, chromeMax: 0, workersMax: 0, thr: 0, memHigh0: s.memHigh, memMax0: s.memMax, oom: s.oom, last: s });
  if (s.cgCpu === undefined) continue;
  a.n++; a.cg += s.cgCpu; a.cgMax = Math.max(a.cgMax, s.cgCpu); a.main += s.mainCpu; a.mainMax = Math.max(a.mainMax, s.mainCpu);
  a.api += s.apiCpu; a.memMax = Math.max(a.memMax, s.memMb); a.anonMax = Math.max(a.anonMax, s.anonMb); a.rssMax = Math.max(a.rssMax, s.rss1Mb);
  a.chromeMax = Math.max(a.chromeMax, s.chrome); a.workersMax = Math.max(a.workersMax, s.workers); a.thr += s.thrS ?? 0; a.last = s;
}
console.log('phase        avgCPU maxCPU | main avg max | api avg | memMax anonMax rss1Max | chrome workers | throttled s | memory.events high/max/oom');
for (const m of res.marks) {
  const a = agg[m.phase]; if (!a || !a.n) continue;
  console.log(`${m.phase.padEnd(12)} ${(a.cg / a.n).toFixed(2).padStart(6)} ${a.cgMax.toFixed(2).padStart(6)} | ${(a.main / a.n).toFixed(2)} ${a.mainMax.toFixed(2)} | ${(a.api / a.n).toFixed(2).padStart(4)} | ${String(a.memMax).padStart(6)} ${String(a.anonMax).padStart(7)} ${String(a.rssMax).padStart(7)} | ${String(a.chromeMax).padStart(6)} ${String(a.workersMax).padStart(7)} | ${a.thr.toFixed(1).padStart(10)} | +${a.last.memHigh - a.memHigh0}/+${a.last.memMax - a.memMax0}/${a.last.oom}`);
}

console.log('\nGC (main isolate, full collections) per phase: count, total pause, max pause, heap after (max), freed/GC (median)');
for (const m of res.marks) {
  const g = gcs.filter((x) => x.t >= m.start && x.t <= m.end);
  if (!g.length) { console.log(`${m.phase.padEnd(12)} none`); continue; }
  const freed = g.map((x) => x.before - x.after).sort((a, b) => a - b);
  console.log(`${m.phase.padEnd(12)} n=${String(g.length).padStart(4)} pause=${g.reduce((s, x) => s + x.pause, 0).toFixed(0).padStart(6)}ms max=${Math.max(...g.map((x) => x.pause)).toFixed(0).padStart(5)}ms heapAfterMax=${Math.max(...g.map((x) => x.after)).toFixed(0)}MB freedMedian=${freed[Math.floor(freed.length / 2)].toFixed(0)}MB`);
}

console.log('\nWorst /health stalls:');
const health = res.samples.filter((s) => s.kind === 'health').sort((a, b) => b.ms - a.ms).slice(0, 8);
for (const h of health) console.log(`  t=${h.t}s ${h.phase} ${h.ms}ms status=${h.status}${h.note ? ' ' + h.note : ''}`);

console.log('\nTimeline (10 s buckets): t phase | cpu main | mem anon | chrome | health max ms | requests done');
const bucket = (t) => Math.floor(t / 10) * 10;
const hb = {}, rb = {};
for (const s of res.samples) { const b = bucket(s.t); if (s.kind === 'health') hb[b] = Math.max(hb[b] ?? 0, s.ms); else rb[b] = (rb[b] ?? 0) + 1; }
const sb = {};
for (const s of smp) { if (s.cgCpu === undefined) continue; const b = bucket(rel(s.t)); (sb[b] ??= []).push(s); }
for (const b of Object.keys(sb).map(Number).sort((x, y) => x - y)) {
  const xs = sb[b]; const av = (k) => xs.reduce((s, x) => s + x[k], 0) / xs.length;
  console.log(`${String(b).padStart(5)} ${phaseOf(b + 5).padEnd(10)} | ${av('cgCpu').toFixed(1).padStart(4)} ${av('mainCpu').toFixed(2)} | ${String(Math.max(...xs.map((x) => x.memMb))).padStart(5)} ${String(Math.max(...xs.map((x) => x.anonMb))).padStart(5)} | ${String(Math.max(...xs.map((x) => x.chrome))).padStart(3)} | ${String(hb[b] ?? '-').padStart(6)} | ${rb[b] ?? 0}`);
}
