// Usage: node icons.mjs name1 name2 ...  → prints OK/MISSING for each icon name via the real renderer.
import { renderIconSvg } from '/workspace/sitewright/packages/blocks/dist/icon-render.js';
for (const n of process.argv.slice(2)) {
  let out = '';
  try { out = renderIconSvg(n, ''); } catch (e) { out = 'ERR ' + e.message; }
  console.log((out && out.includes('<svg') ? 'OK     ' : 'MISSING') + ' ' + n);
}
