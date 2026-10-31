import {readFileSync,writeFileSync} from 'node:fs';
const c=JSON.parse(readFileSync(new URL('../.data/connection.json',import.meta.url),'utf8'));
const headers={Authorization:'Bearer '+c.token};
if(process.argv.includes('--reload')){
  const r=await fetch(c.url+'/api/dev/reload-extension',{method:'POST',headers});if(!r.ok)throw new Error(await r.text());
  await new Promise(r=>setTimeout(r,1500));
  for(let i=0;i<30;i++){const h=await(await fetch(c.url+'/api/health',{headers})).json();if(h.browserConnected)break;await new Promise(r=>setTimeout(r,500));}
}
const r=await fetch(c.url+'/api/browser/inspect',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({selections:process.argv.includes('--exercise')?['low','medium','high'].flatMap(thinkingLevel=>['4 argon','3.1 pro'].map(model=>({model,thinkingLevel}))):[]}),signal:AbortSignal.timeout(95000)});const data=await r.json();
writeFileSync(new URL('../.data/controls.json',import.meta.url),JSON.stringify(data,null,2),{mode:0o600});
console.log(JSON.stringify({...data,modelHtml:undefined,thinkingHtml:undefined,composerHtml:undefined,attachmentHtml:undefined,uploadHtml:undefined,thinking:data.thinking?.map(({html,...rest})=>rest)},null,2));

if(!r.ok || !data.ok || data.checks?.some(c=>!c.ok))process.exitCode=1;
