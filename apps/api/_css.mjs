import { readFileSync } from 'node:fs';
const SP = process.argv[2];
const BASE = 'http://dind.local:2003';
const NID = readFileSync(SP + '/nid.txt', 'utf8').trim();
const jar = readFileSync(SP + '/../sw-cookies.txt', 'utf8').split(/\n/).filter((l) => l.trim() && (!l.startsWith('#') || l.startsWith('#HttpOnly_')));
const cookie = jar.map((l) => l.replace(/^#HttpOnly_/, '').split(/\t/)).filter((a) => a.length >= 7).map((a) => `${a[5]}=${a[6]}`).join('; ');
const H = { 'content-type': 'application/json', cookie };
const settings = (await (await fetch(`${BASE}/projects/${NID}/content/settings/settings`, { headers: H })).json()).item;

const PRIMARY_WOFF = '/media/burmeister-native/4ce37cdf-bc86-444d-bd80-d3e26bd8c8e5/primary-font-400.woff';
const SECONDARY_WOFF = '/media/burmeister-native/487df7ea-3b0c-4956-bfd2-65bda9f3412a/secondary-font-400.woff';
const NOISE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='0.07'/%3E%3C/svg%3E\")";
const SQUARES = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='280'%3E%3Cg fill='none' stroke='%23ffffff' stroke-width='2' opacity='0.16'%3E%3Crect x='24' y='34' width='74' height='74' rx='13'/%3E%3Crect x='312' y='18' width='92' height='92' rx='15'/%3E%3Crect x='168' y='168' width='62' height='62' rx='11'/%3E%3Crect x='372' y='150' width='54' height='54' rx='10'/%3E%3C/g%3E%3Cg fill='%23ffffff' opacity='0.09'%3E%3Crect x='118' y='66' width='54' height='54' rx='11'/%3E%3Crect x='250' y='138' width='86' height='86' rx='15'/%3E%3Crect x='44' y='168' width='44' height='44' rx='9'/%3E%3Crect x='210' y='20' width='40' height='40' rx='8'/%3E%3C/g%3E%3C/svg%3E\")";

// Site-wide CSS in the criticalCss slot (the proper place — applied before the platform utility sheet):
// real captured brand fonts (heading=primary-font, body=secondary-font woff) via !important so they
// beat the platform's default typography vars; body grey texture; .bp-hero red-band geometric pattern;
// .bp-card elevation.
const criticalCss = `@font-face{font-family:"bp-heading";src:url('${PRIMARY_WOFF}') format('woff');font-display:swap;}
@font-face{font-family:"bp-body";src:url('${SECONDARY_WOFF}') format('woff');font-display:swap;}
body,p,li,td,th,a,span,div,input,textarea,button,select{font-family:"bp-body","Verdana",Arial,sans-serif !important;}
h1,h2,h3,h4,h5,h6,.bp-heading{font-family:"bp-heading","Georgia","Times New Roman",serif !important;}
body{background-color:#e6e6e9;background-image:${NOISE};}
.bp-hero{position:relative;overflow:hidden;}
.bp-hero::before{content:"";position:absolute;inset:0;background-image:${SQUARES};background-size:420px 280px;background-position:center;pointer-events:none;}
.bp-hero>*{position:relative;}
.bp-card{box-shadow:0 8px 17px rgba(0,0,0,.16),0 6px 20px rgba(0,0,0,.10);}`;

settings.identity = {
  ...settings.identity,
  colors: { ...settings.identity.colors, primary: '#B42A33', secondary: '#565656' },
};
settings.website = { ...settings.website, head: '', criticalCss };
const r = await fetch(`${BASE}/projects/${NID}/content/settings/settings`, { method: 'PUT', headers: H, body: JSON.stringify(settings) });
console.log('css/colors PUT', r.status, r.ok ? 'OK (fonts captured + secondary #565656 + criticalCss texture/hero/card)' : (await r.text()).slice(0, 300));
