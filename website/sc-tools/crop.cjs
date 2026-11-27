// node crop.cjs <in.jpg> <outprefix> [segmentHeight=1800] [width=900] → splits a tall shot into readable crops
const sharp = require('/workspace/sitewright/packages/image-pipeline/node_modules/sharp');
(async () => {
  const [inp, prefix, segH = '1800', w = '900'] = process.argv.slice(2);
  const meta = await sharp(inp).metadata();
  const H = Number(segH);
  let n = 0;
  for (let top = 0; top < meta.height; top += H) {
    const h = Math.min(H, meta.height - top);
    const out = `${prefix}-${String(n).padStart(2, '0')}.jpg`;
    await sharp(inp).extract({ left: 0, top, width: meta.width, height: h }).resize(Number(w)).jpeg({ quality: 75 }).toFile(out);
    console.log(out, top, h);
    n += 1;
  }
})();
