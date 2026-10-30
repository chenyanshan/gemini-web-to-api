import {readFileSync,writeFileSync} from 'node:fs';
if(!process.argv.includes('--confirm-live'))throw new Error('这个测试会发送两轮 3.1 pro UI 问答并消耗额度。显式传 --confirm-live 才执行。');
const c=JSON.parse(readFileSync(new URL('../.data/connection.json',import.meta.url),'utf8'));
const headers={Authorization:'Bearer '+c.token,'Content-Type':'application/json'};
async function api(path,method='GET',body){const r=await fetch(c.url+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000)});const d=await r.json();if(!r.ok)throw new Error(JSON.stringify(d));return d;}
const log=process.argv.includes('--resume')?JSON.parse(readFileSync(new URL('../.data/smoke-live.json',import.meta.url),'utf8')):{};const persist=()=>writeFileSync(new URL('../.data/smoke-live.json',import.meta.url),JSON.stringify(log,null,2),{mode:0o600});
const session=log.session || await api('/api/sessions','POST',{model:'3.1 pro',thinking_level:'medium',label:'Bridge 联调 · UI'});log.session=session;persist();console.log('session',session.id);
const prompts=['本次 UI 联调项目代号是 UI-BRIDGE-73K。请只用一句中文建议登录按钮的水平内边距，不要生成代码。','请先写出我们刚才确定的项目代号，再给出按钮 padding 的一行 CSS，放在 css 代码块里。不需要其他解释。'];
for(let i=0;i<prompts.length;i++){
 const input=log[`input${i}`] || {request_id:crypto.randomUUID(),expected_revision:i,prompt:prompts[i],timeout_ms:180000};log[`input${i}`]=input;persist();
 let job=log[`job${i}`]?await api(`/api/jobs/${log[`job${i}`].id}`):await api(`/api/sessions/${session.id}/jobs`,'POST',input);
 if(['unknown','blocked_login'].includes(job.state))job=await api(`/api/jobs/${job.id}/resume`,'POST',{});log[`job${i}`]=job;persist();console.log('job',job.id,job.state);
 while(['queued','preparing','dispatching','submitted','streaming','reconciling'].includes(job.state)){
  job=await api(`/api/jobs/${job.id}?wait_ms=10000`);log[`job${i}`]=job;persist();if(log.lastReportedState!==job.state){console.log('state',job.state,job.error?.code || '');log.lastReportedState=job.state;}
 }
 if(job.state!=='completed')throw new Error(JSON.stringify(job.error));
 console.log('result',job.result.text);
 const replay=await api(`/api/sessions/${session.id}/jobs`,'POST',input);if(replay.id!==job.id || replay.state!=='completed')throw new Error('幂等重放失败');
 if(i===1 && (!job.result.text.includes('UI-BRIDGE-73K') || !job.result.text.includes('```')))throw new Error('上下文或代码块校验失败');
}
console.log('PASS: 两轮续聊、代码块和幂等结果重放。');
