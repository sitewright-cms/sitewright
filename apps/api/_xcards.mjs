import { readFileSync, writeFileSync } from 'node:fs';
const SP = process.argv[2];
const pages = JSON.parse(readFileSync(SP + '/pages.json', 'utf8')).items || [];
const s = pages.find(p => !p.path || p.path === '').source || '';
const imgs = [...s.matchAll(/background-image:url\('([^']+)'\)/g)].map(x => x[1].replace(/^.*\/media/, '/media'));
const links = [...s.matchAll(/href="(\/services\/[a-z-]+)"/g)].map(x => x[1]).filter((v, i, a) => a.indexOf(v) === i);
const labels = ['Agri & Industrial Business', 'Logistics & Transportation Solutions', 'Hydro Business Solutions', 'Health & Pharmaceutical Solutions', 'Energy Solutions', 'Mining Infrastructure Solutions', 'Urban Development Solutions', 'Building Engineering Solutions', 'Fuel & Gas Solutions', 'Special Projects'];
console.log('bg images:', imgs.length, '| service links:', links.length);
const cards = labels.map((label, i) => ({ label, link: links[i] || '', img: imgs[i + 1] || '' })); // imgs[0] = hero
writeFileSync(SP + '/home-cards.json', JSON.stringify({ hero: imgs[0], cards }, null, 1));
cards.forEach(c => console.log('  ', c.label.padEnd(36), (c.link || '?').padEnd(34), c.img.slice(-32)));
console.log('hero:', imgs[0]);
