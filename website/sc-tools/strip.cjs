// node strip.cjs out.jpg in1.jpg in2.jpg ... → places tall mobile shots side by side, each split into columns of 2400px
const sharp = require('/workspace/sitewright/packages/image-pipeline/node_modules/sharp');
(async () => {
  const [out, ...ins] = process.argv.slice(2);
  const colH = 2600, colW = 390, gap = 10;
  const cols = [];
  for (const f of ins) {
    const m = await sharp(f).metadata();
    for (let top = 0; top < m.height; top += colH) {
      const h = Math.min(colH, m.height - top);
      cols.push(await sharp(f).extract({ left: 0, top, width: colW, height: h }).toBuffer());
    }
  }
  const W = cols.length * (colW + gap);
  await sharp({ create: { width: W, height: colH, channels: 3, background: '#888' } })
    .composite(cols.map((b, i) => ({ input: b, left: i * (colW + gap), top: 0 })))
    .png().toBuffer().then((b) => sharp(b).resize(Math.min(W, 2000)).jpeg({ quality: 70 }).toFile(out));
  console.log(out, cols.length, 'columns');
})();
