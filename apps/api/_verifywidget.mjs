import { readFileSync } from 'node:fs';
const BASE='http://dind.local:2003';
const JAR='/tmp/claude-1000/-workspace-sitewright/95586b29-cd27-4db9-b2ca-6744e95259c0/scratchpad/db2.cookies';
const cookie=readFileSync(JAR,'utf8').split('\n').filter(l=>l.includes('sw_session')).map(l=>l.split('\t')).filter(c=>c.length>=7).map(c=>`${c[5]}=${c[6]}`).join('; ');
const H={cookie,'content-type':'application/json'};
const cr=await (await fetch(`${BASE}/projects`,{method:'POST',headers:H,body:JSON.stringify({name:'droombos-widget',slug:'droombos-widget'})})).json();
const pid=cr.id||cr.project?.id;
const imp=await fetch(`${BASE}/projects/${pid}/import/website/stream?foundation=1`,{method:'POST',headers:H,body:JSON.stringify({url:'https://contentbase.phoenix-tech.net/sites/droombos/'})});
const reader=imp.body.getReader();const dec=new TextDecoder();let buf='';
while(true){const{value,done}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});const evs=buf.split('\n\n');buf=evs.pop()||'';for(const ev of evs){if(/event:\s*done/.test(ev))console.log('import done');}}
const s=await (await fetch(`${BASE}/projects/${pid}/content/settings/settings`,{headers:{cookie}})).json();
const consent=s.item?.website?.consent||{};
console.log('project',pid);
console.log('consent.enabled:', consent.enabled);
console.log('integrations:', JSON.stringify((consent.integrations||[]).map(i=>({name:i.name,cat:i.category,src:i.src,origins:i.origins}))));
