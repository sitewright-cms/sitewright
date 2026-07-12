import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const SP=process.argv[2];
const list=JSON.parse(readFileSync(SP+'/adv-list.json','utf8'));
const b=await chromium.launch({args:['--no-sandbox']});
async function shoot(page,html,url,outBase,w){
  const ctx=await b.newContext({viewport:{width:w,height:1000},deviceScaleFactor:1});
  const pg=await ctx.newPage();
  try{
    if(html){
      let h=readFileSync(html,'utf8');
      if(!/<base /i.test(h)) h=h.replace(/<head([^>]*)>/i,'<head$1><base href="http://dind.local:2003/">');
      await pg.setContent(h,{waitUntil:'networkidle',timeout:35000});
    } else {
      await pg.goto(url,{waitUntil:'networkidle',timeout:45000});
    }
    await pg.evaluate(async()=>{await new Promise(r=>{let y=0;const t=setInterval(()=>{scrollTo(0,y+=700);if(y>document.body.scrollHeight){clearInterval(t);r()}},30)})}).catch(()=>{});
    await pg.waitForTimeout(700); await pg.evaluate(()=>scrollTo(0,0)); await pg.waitForTimeout(200);
    await pg.screenshot({path:outBase,quality:60,type:'jpeg',fullPage:true});
  }catch(e){console.log('ERR',outBase,e.message.slice(0,60));}
  await ctx.close();
}
for(const it of list){
  const html=SP+'/adv/page-'+it.path.replace(/\//g,'_')+'.html';
  await shoot(null,html,null,`${SP}/adv/CLONE-${it.path.replace(/\//g,'_')}-d.jpg`,1440);
  if(it.url) await shoot(null,null,it.url,`${SP}/adv/ORIG-${it.path.replace(/\//g,'_')}-d.jpg`,1440);
  console.log('done',it.path);
}
await b.close();
