import { readFileSync } from 'node:fs';
const BASE='http://dind.local:2003';
const JAR='/tmp/claude-1000/-workspace-sitewright/95586b29-cd27-4db9-b2ca-6744e95259c0/scratchpad/db2.cookies';
const cookie=readFileSync(JAR,'utf8').split('\n').filter(l=>l.includes('sw_session')).map(l=>l.split('\t')).filter(c=>c.length>=7).map(c=>`${c[5]}=${c[6]}`).join('; ');
const H={cookie,'content-type':'application/json'};
const cr=await (await fetch(`${BASE}/projects`,{method:'POST',headers:H,body:JSON.stringify({name:'droombos-decor',slug:'droombos-decor'})})).json();
const pid=cr.id||cr.project?.id; console.log('project',pid);
const imp=await fetch(`${BASE}/projects/${pid}/import/website/stream?foundation=1`,{method:'POST',headers:H,body:JSON.stringify({url:'https://contentbase.phoenix-tech.net/sites/droombos/'})});
const reader=imp.body.getReader(); const dec=new TextDecoder(); let buf='';
while(true){const{value,done}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});const evs=buf.split('\n\n');buf=evs.pop()||'';for(const ev of evs){if(/event:\s*done/.test(ev))console.log('import done');if(/event:\s*error/.test(ev))console.log('ERR',ev.slice(0,150));}}
const s=await (await fetch(`${BASE}/projects/${pid}/content/settings/settings`,{headers:{cookie}})).json();
const nav=s.item?.website?.mainNav||'';
const diags=cr.diagnostics; // n/a
console.log('mainNav has header-left img:', /header-left/.test(nav));
console.log('mainNav has header-right img:', /header-right/.test(nav));
console.log('mainNav has aria-hidden decoration:', /aria-hidden/.test(nav));
console.log('mainNav has navbar relative:', /navbar relative/.test(nav));
const imgs=[...nav.matchAll(/<img[^>]*aria-hidden[^>]*>/g)].map(m=>m[0].slice(0,120));
imgs.forEach(i=>console.log('  DECOR:',i));
console.log('pid',pid);
