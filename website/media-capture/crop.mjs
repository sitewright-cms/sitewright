// Development aid: crops a tall screenshot into a window, by rendering it in a page.   node crop.mjs <in> <out> <top> <height>
import { readFileSync } from 'node:fs';
import { launch } from './lib.mjs';
const [input, out, top = '0', height = '2400'] = process.argv.slice(2);
const b = await launch();
const page = await b.newPage({ viewport: { width: 1440, height: Number(height) } });
await page.setContent(`<body style="margin:0;overflow:hidden"><img style="display:block;margin-top:-${top}px" src="data:image/jpeg;base64,${readFileSync(input).toString('base64')}"></body>`);
await page.waitForTimeout(300);
await page.screenshot({ path: out });
await b.close();
