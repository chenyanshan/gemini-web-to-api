// Real browser regression. Only synthetic UI fixtures leave this machine.
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import assert from 'node:assert/strict';
if(!process.argv.includes('--confirm-live'))throw new Error('Pass --confirm-live: five UI generations, including one Argon turn.');
const config=JSON.parse(readFileSync(new URL('../.data/connection.json',import.meta.url),'utf8'));
const headers={Authorization:'Bearer '+config.token};
const path=new URL('../.data/smoke-reliability.json',import.meta.url);
async function api(path,body,method=body?'POST':'GET'){
 const response=await fetch(config.url+path,{method,headers:{...headers,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});
 const data=await response.json();if(!response.ok)throw new Error(JSON.stringify(data));return data;
}
function crc32(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([size,t,data,crc]);}
function png(variant){
 const header=Buffer.alloc(13);header.writeUInt32BE(80);header.writeUInt32BE(60,4);header[8]=8;header[9]=2;
 const rows=[];for(let y=0;y<60;y++){const row=Buffer.alloc(241);for(let x=0;x<80;x++){const rgb=x<40?(variant?[20,180,70]:[255,127,80]):[30,90,220];for(let k=0;k<3;k++)row[1+x*3+k]=rgb[k];}rows.push(row);}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
}
let state;
function save(){writeFileSync(path,JSON.stringify(state,null,2),{mode:0o600});}
if(process.argv.includes('--resume'))state=JSON.parse(readFileSync(path,'utf8'));
else{
 const health=await api('/api/health');assert(health.browserConnected && !health.activeJobId && !health.blockedJobs.length,'Bridge must be idle');
 state={context:'CONTEXT-'+randomUUID().slice(0,8),turns:[],createdAt:new Date().toISOString()};save();
}
const configurations=[['3.1 pro','low'],['4 argon','low'],['3.1 pro','medium'],['3.1 pro','high'],['3.1 pro','medium']];
for(let index=0;index<configurations.length;index++){
 const [model,thinking_level]=configurations[index];
 if(!state.sessionId){const session=await api('/api/sessions',{label:'UI reliability regression',model,thinking_level});state.sessionId=session.id;save();}
 if(!state.turns[index]){state.turns[index]={requestId:randomUUID(),marker:'SOURCE-'+randomUUID().slice(0,8),radius:14+index*4};save();}
 const turn=state.turns[index];
 if(!turn.payload){
  const session=await api('/api/sessions/'+state.sessionId);
  const updated=await api('/api/sessions/'+session.id,{expected_revision:session.revision,model,thinking_level},'PATCH');
  const ids=[];
  const fixtures=[['ui-screenshot.png','image/png',png(index>1)],['component.html','text/html',Buffer.from(`<!doctype html><style>.primary { border-radius: ${turn.radius}px; padding: 12px 20px; }</style><button class="primary">Save ${turn.marker}</button>`)]];
  if(index===4)fixtures.push(['component.css','text/css',Buffer.from(`/* CSSCHECK-${turn.marker} */ .primary { border-radius: ${turn.radius}px; }`)]);
  for(const [name,mime,bytes] of fixtures){
   const response=await fetch(config.url+'/api/files',{method:'POST',headers:{...headers,'X-File-Name':name,'Content-Type':mime},body:bytes,signal:AbortSignal.timeout(25000)});assert(response.ok);ids.push((await response.json()).id);
  }
  turn.payload={request_id:turn.requestId,expected_revision:updated.revision,attachment_ids:ids,timeout_ms:240000,prompt:`Help refine this frontend button design using BOTH attached screenshot and HTML source. ${index===0?`Remember the session context token ${state.context}.`:'Recall the session context token from our FIRST user turn.'} Reply with that context token, the exact SOURCE marker from the CURRENT attached HTML, the CSSCHECK marker from the CSS file if attached, and the left and right image colors in English (coral/blue or green/blue). Then give a compact HTML/CSS example (under 12 lines) preserving the button label and border radius from the current file, improving spacing and using the image colors. Do not guess unread attachments.`};save();
 }
 // Always replay the identical payload, including after a lost submit response.
 const submitted=await api('/api/sessions/'+state.sessionId+'/jobs',turn.payload);turn.jobId=submitted.id;if(turn.retryId)turn.jobId=(await api('/api/jobs/'+submitted.id+'/retry-missing',{request_id:turn.retryId,acknowledge_duplicate_risk:true})).id;save();
 let job;
 for(let poll=0;poll<40;poll++){
  job=await api('/api/jobs/'+turn.jobId+'?wait_ms=20000');
  console.log(JSON.stringify({turn:index+1,model,thinking_level,jobId:job.id,state:job.state,error:job.error,recovery:job.checkpoint?.recovery}));
  if(job.state==='completed')break;
  if(job.state==='unknown' && job.recovery?.action==='resume_with_refresh' && !turn.resumed){turn.resumed=true;save();await api('/api/jobs/'+job.id+'/resume',{refresh:true});continue;}
  if(job.state==='unknown' && job.error?.code==='turn_missing' && process.argv.includes('--retry-missing') && !turn.retryId){
   turn.retryId=randomUUID();save();const retry=await api('/api/jobs/'+job.id+'/retry-missing',{request_id:turn.retryId,acknowledge_duplicate_risk:true});turn.jobId=retry.id;save();continue;
  }
  if(['failed','unknown','blocked_login'].includes(job.state))throw new Error(JSON.stringify({jobId:job.id,error:job.error,recovery:job.recovery}));
 }
 assert.equal(job?.state,'completed','Generation must complete, not just appear in the page');
 const result=job.result;
 assert(result.text.includes(state.context),'Conversation context lost');assert(result.text.includes(turn.marker),'Current source file not read');
 if(index===4)assert(result.text.includes('CSSCHECK-'+turn.marker),'Same-stem CSS source not read');
 assert(new RegExp(`border-radius\\s*:\\s*${turn.radius}px`,'i').test(result.text),'Current radius not preserved');
 assert(new RegExp(index>1?'green':'coral','i').test(result.text) && /blue/i.test(result.text),'Screenshot colors not read');
 assert(result.modelVerified && result.thinkingVerified);assert.equal(result.requestedModel,model);assert.equal(result.requestedThinkingLevel,thinking_level);
 assert(result.text.includes('```'),'Code example missing');
 state.url ||= result.conversationUrl;assert.equal(result.conversationUrl,state.url,'Conversation changed');
 const replay=await api('/api/sessions/'+state.sessionId+'/jobs',turn.payload);assert.equal(replay.id,submitted.id,'Idempotent replay duplicated a job');
 turn.result=result;turn.passed=true;save();
 console.log(JSON.stringify({turn:index+1,passed:true,text:result.text}));
}
state.completedAt=new Date().toISOString();save();console.log('PASS: five turns (including same-stem HTML/CSS), same conversation, mixed screenshot/code attachments, model/thinking changes, code output, context recall and idempotent replay.');
