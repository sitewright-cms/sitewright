import { chromium } from '@playwright/test';
const SP='/tmp/claude-1000/-workspace-sitewright/0d7b4751-f6d5-4ce4-9a50-d85f3b151a6b/scratchpad'; const BASE='http://dind.local:2003'; const PB='/preview-site/SUJo41gvYxGb/u6w4fkCmeaLb477-eCzVe1uDR7i/';
const pages=[['home',''],['about-us','about-us'],['services','services'],['xero','xero'],['contact','contact']];
const cookie='__Host-sw_session';
const b=await chromium.launch({args:['--no-sandbox']});
// load auth cookie from jar
import {readFileSync} from 'node:fs';
const jar=readFileSync(SP+'/sw-cookies.txt','utf8').split(/\n/).filter(l=>l&&!l.startsWith('#'));
const cookies=jar.map(l=>l.split(/\t/)).filter(a=>a.length>=7).map(a=>({name:a[5],value:a[6],domain:a[0].replace(/^#HttpOnly_/,''),path:a[2],httpOnly:a[0].includes('HttpOnly'),secure:a[3]==='TRUE'}));
for(const [name,slug] of pages){
  for(const [w,tag] of [[1440,'d'],[390,'m']]){
    const ctx=await b.newContext({viewport:{width:w,height:1000},deviceScaleFactor:1});
    await ctx.addCookies(cookies.map(c=>({...c,domain:'dind.local'})));
    const pg=await ctx.newPage();
    try{
      await pg.goto(BASE+PB+slug,{waitUntil:'networkidle',timeout:45000});
      await pg.evaluate(async()=>{await new Promise(r=>{let y=0;const t=setInterval(()=>{scrollTo(0,y+=600);if(y>document.body.scrollHeight){clearInterval(t);r()}},30)})}).catch(()=>{});
      await pg.waitForTimeout(900); await pg.evaluate(()=>scrollTo(0,0)); await pg.waitForTimeout(200);
      await pg.screenshot({path:`${SP}/adv/REAL-${name}-${tag}.jpg`,quality:60,type:'jpeg',fullPage:true});
    }catch(e){console.log('ERR',name,tag,e.message.slice(0,50));}
    await ctx.close();
  }
  console.log('shot',name);
}
await b.close();
