// Runs INSIDE the container (a separate node process): one JSON line per second with cgroup memory/CPU,
// the API process's MAIN-THREAD CPU (task tid == pid 1), its total CPU, RSS and private anonymous memory,
// and the child processes (render workers, Chromium) by kind with their private anonymous memory.
// Reads only /proc and /sys.
import { readFileSync, readdirSync } from 'node:fs';

const TICK = 100; // USER_HZ
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const kv = (txt) => Object.fromEntries(txt.trim().split('\n').filter(Boolean).map((l) => { const [k, v] = l.split(/\s+/); return [k, Number(v)]; }));
const statCpu = (txt) => { if (!txt) return 0; const f = txt.slice(txt.lastIndexOf(')') + 2).split(' '); return (Number(f[11]) + Number(f[12])) / TICK; };
const rssMb = (pid) => { const m = /VmRSS:\s+(\d+)/.exec(read(`/proc/${pid}/status`)); return m ? Number(m[1]) / 1024 : 0; };
// PRIVATE anonymous memory (what the cgroup's anon counts), not RSS (which double-counts shared pages).
const anonOf = (pid) => { const m = /Anonymous:\s+(\d+)/.exec(read(`/proc/${pid}/smaps_rollup`)); return m ? Number(m[1]) / 1024 : 0; };

let prev = null;
function sample() {
  const now = Date.now() / 1000;
  const mem = kv(read('/sys/fs/cgroup/memory.stat'));
  const ev = kv(read('/sys/fs/cgroup/memory.events'));
  const cpu = kv(read('/sys/fs/cgroup/cpu.stat'));
  const main = statCpu(read('/proc/1/task/1/stat'));
  const proc1 = statCpu(read('/proc/1/stat'));
  const threads = readdirSync('/proc/1/task').length;
  const kinds = { chrome: [0, 0], worker: [0, 0], other: [0, 0] };
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d) || d === '1') continue;
    const cmd = read(`/proc/${d}/cmdline`).replace(/\0/g, ' ');
    if (!cmd || cmd.includes('sampler.mjs') || cmd.includes('cdp.mjs')) continue;
    const kind = /chrom|headless_shell/.test(cmd) ? 'chrome' : /render-worker|worker\.js/.test(cmd) ? 'worker' : 'other';
    kinds[kind][0]++;
    kinds[kind][1] += anonOf(d);
  }
  const cur = { now, main, proc1, usage: cpu.usage_usec / 1e6, thr: cpu.throttled_usec / 1e6 };
  const out = {
    t: Math.round(now),
    memMb: Math.round(Number(read('/sys/fs/cgroup/memory.current')) / 1048576),
    anonMb: Math.round(mem.anon / 1048576),
    fileMb: Math.round(mem.file / 1048576),
    rss1Mb: Math.round(rssMb(1)), anon1Mb: Math.round(anonOf(1)),
    threads,
    chrome: kinds.chrome[0], chromeMb: Math.round(kinds.chrome[1]),
    workers: kinds.worker[0], workerMb: Math.round(kinds.worker[1]),
    others: kinds.other[0],
    memHigh: ev.high ?? 0, memMax: ev.max ?? 0, oom: ev.oom_kill ?? 0,
  };
  if (prev) {
    const dt = now - prev.now;
    out.cgCpu = +((cur.usage - prev.usage) / dt).toFixed(2); // cores used by the whole container
    out.mainCpu = +((cur.main - prev.main) / dt).toFixed(2); // the API's event-loop thread (1.0 = pegged)
    out.apiCpu = +((cur.proc1 - prev.proc1) / dt).toFixed(2); // all API threads (libuv pool, V8 GC helpers)
    out.thrS = +(cur.thr - prev.thr).toFixed(2); // seconds of CFS throttling in this interval
  }
  prev = cur;
  process.stdout.write(JSON.stringify(out) + '\n');
}
sample();
setInterval(sample, 1000);
