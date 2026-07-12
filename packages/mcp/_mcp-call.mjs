import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync } from 'node:fs';
const tool=process.argv[2]; let args={};
if(process.argv[3]) args=process.argv[3].startsWith('@')?JSON.parse(readFileSync(process.argv[3].slice(1),'utf8')):JSON.parse(process.argv[3]);
const t=new StdioClientTransport({command:'node',args:['/workspace/sitewright/packages/mcp/dist/bin.js'],env:{...process.env,SITEWRIGHT_URL:'http://dind.local:2003',SITEWRIGHT_TOKEN:process.env.SW_TOKEN}});
const c=new Client({name:'x',version:'1'},{capabilities:{}}); await c.connect(t);
if(tool==='__list__'){const r=await c.listTools();console.log(r.tools.map(x=>x.name).join(' '));}
else{const r=await c.callTool({name:tool,arguments:args});const tx=(r.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');process.stdout.write(tx||JSON.stringify(r));if(r.isError)process.stderr.write('\n[isError]\n');}
await c.close();
