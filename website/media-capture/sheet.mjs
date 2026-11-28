// Development aid: lays images out on one contact sheet, captioned, for reviewing many captures at once.
//   node sheet.mjs <out.png> <image>…   (2 columns)
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { launch } from './lib.mjs';
const [out, ...files] = process.argv.slice(2);
const cells = files.map((f) => `<figure><img src="data:image/png;base64,${readFileSync(f).toString('base64')}"><figcaption>${basename(f)}</figcaption></figure>`).join('');
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1800, height: 600 } });
await page.setContent(`<style>body{margin:0;padding:12px;font:14px sans-serif;display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#ddd}figure{margin:0;background:#fff;padding:6px}img{width:100%;display:block}figcaption{padding-top:4px}</style>${cells}`);
await page.waitForTimeout(500);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
