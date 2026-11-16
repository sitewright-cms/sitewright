// Runs INSIDE the container: CPU-profiles the API (PID 1) through its inspector on 127.0.0.1:9229, which
// `kill -USR1 1` opens. argv: durationMs outFile [samplingIntervalUs=1000]. Open the file in DevTools.
const ms = Number(process.argv[2] ?? 10000);
const out = process.argv[3] ?? '/tmp/prof.cpuprofile';
const list = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: Number(process.argv[4] ?? 1000) });
await send('Profiler.start'); console.log('profiling');
await new Promise((r) => setTimeout(r, ms));
const { profile } = await send('Profiler.stop');
(await import('node:fs')).writeFileSync(out, JSON.stringify(profile)); console.log('wrote', out); ws.close();
