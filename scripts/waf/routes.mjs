// List the API's HTTP routes as `METHOD<TAB>path<TAB>file:line`, for attributing WAF log lines to
// routes.  usage: node routes.mjs <apps/api/src>
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) files.push(p);
  }
})(root);

// `app.get('/x', …)`, `app.post<{…}>(\n  '/x', …)` and template-literal paths.
// eslint-disable-next-line security/detect-unsafe-regex -- dev-time scan of the repo's own sources; the optional generic is a lazy, paren-free class
const re = /\b[A-Za-z]+\.(get|post|put|patch|delete|options|all)(?:<[^()]*?>)?\(\s*(['`])([^'`]+)\2/g;
for (const f of files.sort()) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(re)) {
    if (!m[3].startsWith('/')) continue;
    const line = src.slice(0, m.index).split('\n').length;
    console.log(`${m[1].toUpperCase()}\t${m[3]}\t${path.relative(path.dirname(root), f)}:${line}`);
  }
}
