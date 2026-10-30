import {readFileSync,writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';
if(!process.argv.includes('--confirm-live'))throw new Error('This sends synthetic UI attachments to Gemini. Pass --confirm-live.');
const c=JSON.parse(readFileSync(new URL('../.data/connection.json',import.meta.url),'utf8'));
const headers={Authorization:'Bearer '+c.token};
const statePath=new URL('../.data/smoke-attachments.json',import.meta.url);
async function api(path,body){const r=await fetch(c.url+path,{method:body?'POST':'GET',headers:{...headers,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(JSON.stringify(data));return data;}
function crc32(b){let c=0xffffffff;for(const x of b){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc]);}
function png(){
 const header=Buffer.alloc(13);header.writeUInt32BE(80);header.writeUInt32BE(60,4);header[8]=8;header[9]=2;
 const rows=[];for(let y=0;y<60;y++){const row=Buffer.alloc(241);for(let x=0;x<80;x++){const rgb=x<40?[255,127,80]:[30,90,220];for(let k=0;k<3;k++)row[1+x*3+k]=rgb[k];}rows.push(row);}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
}
let state;
if(process.argv.includes('--resume'))state=JSON.parse(readFileSync(statePath,'utf8'));
else {
 const health=await api('/api/health');if(!health.browserConnected || health.activeJobId || health.blockedJobs.length)throw new Error('Bridge is not idle');
 const files=[];
 for(const [name,type,bytes] of [['bridge-layout.png','image/png',png()],['bridge-design-brief.txt','text/plain',Buffer.from('UI design reference. Verification code: CORAL-UI-582. The primary button must have border-radius: 14px. Keep the response brief.')]]){
  const r=await fetch(c.url+'/api/files',{method:'POST',headers:{...headers,'X-File-Name':encodeURIComponent(name),'Content-Type':type},body:bytes});if(!r.ok)throw new Error(await r.text());files.push(await r.json());
 }
 const session=await api('/api/sessions',{label:'Attachment integration smoke',model:'3.1 pro',thinking_level:'medium'});
 state={sessionId:session.id,attachmentIds:files.map(f=>f.id),requestId:randomUUID(),jobs:[]};writeFileSync(statePath,JSON.stringify(state,null,2),{mode:0o600});
}
if(!state.jobs.length){
 const job=await api('/api/sessions/'+state.sessionId+'/jobs',{request_id:state.requestId,prompt:'This is a UI reference attachment test. Read both attached files. Reply in one short line with: the verification code in the design brief; the primary button border radius; and the left and right colors in the image. Do not guess missing attachment content.',expected_revision:0,attachment_ids:state.attachmentIds});
 state.jobs.push(job.id);writeFileSync(statePath,JSON.stringify(state,null,2),{mode:0o600});
}
let job;
for(let n=0;n<30;n++){
 job=await api('/api/jobs/'+state.jobs[0]+'?wait_ms=20000');console.log(JSON.stringify({jobId:job.id,state:job.state,upload:job.checkpoint?.upload,error:job.error,result:job.result?.text}));
 if(['completed','failed','unknown','blocked_login'].includes(job.state))break;
}
if(job.state!=='completed')process.exitCode=1;
if(job.state==='completed' && process.argv.includes('--followup')){
 if(!state.followup){
  const session=await api('/api/sessions/'+state.sessionId);
  state.followup={requestId:randomUUID(),revision:session.revision};writeFileSync(statePath,JSON.stringify(state,null,2),{mode:0o600});
 }
 if(!state.followup.jobId){
  const next=await api('/api/sessions/'+state.sessionId+'/jobs',{request_id:state.followup.requestId,expected_revision:state.followup.revision,attachment_ids:state.attachmentIds,prompt:'Continue this UI design session. The same reference files are attached again to test a new upload round. Return only the prior verification code, the button border-radius CSS declaration, and the left/right image colors.'});
  state.followup.jobId=next.id;writeFileSync(statePath,JSON.stringify(state,null,2),{mode:0o600});
 }
 for(let n=0;n<30;n++){
  const next=await api('/api/jobs/'+state.followup.jobId+'?wait_ms=20000');console.log(JSON.stringify({jobId:next.id,state:next.state,error:next.error,result:next.result?.text}));
  if(next.state==='completed'){if(!/CORAL-UI-582/.test(next.result.text) || !/14px/.test(next.result.text))throw new Error('Attachment content verification failed');break;}
  if(['failed','unknown','blocked_login'].includes(next.state)){process.exitCode=1;break;}
 }
}
