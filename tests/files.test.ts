import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.js';
import {readAttachment} from '../src/files.js';
import {MAX_FILE_BYTES,MAX_TOTAL_BYTES} from '../src/protocol.js';

it('keeps immutable, deduplicated snapshots across restarts and binds attachment identity to idempotency',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bridge-files-'));let s=new Store(join(dir,'db'));
 try{
  const bytes=Buffer.from('original brief');const file=s.upload('设计说明.txt','text/plain',bytes);
  bytes.fill(0);expect(s.fileBytes(file.id).toString()).toBe('original brief');
  expect(s.upload(file.name,file.mimeType,Buffer.from('original brief'))).toEqual(file);
  const session=s.createSession('3.1 pro');const job=s.submit(session.id,'key','UI',0,600000,[file.id]);
  s.close();s=new Store(join(dir,'db'));
  expect(s.fileBytes(file.id).toString()).toBe('original brief');
  expect(s.submit(session.id,'key','UI',0,600000,[file.id]).id).toBe(job.id);
  const updated=s.upload(file.name,file.mimeType,Buffer.from('changed'));expect(updated.id).not.toBe(file.id);
  expect(()=>s.submit(session.id,'key','UI',0,600000,[updated.id])).toThrow('不同内容');
  s.dispatch(job.id,'browser');
  s.checkpoint(job.id,{phase:'dispatching',beforeUsers:[],beforeReplies:[],prompt:'UI',conversationUrl:null,modelLabel:'Pro',updatedAt:Date.now(),upload:{ids:[file.id],state:'ready'}},'dispatching');
  s.finish(job.id,{state:'unknown',error:{code:'turn_missing',message:'missing'}});
  const retry=s.retryMissing(job.id,'retry');expect(retry.attachments).toEqual(job.attachments);
  expect(s.retryMissing(job.id,'retry').id).toBe(retry.id);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
it('rejects unsafe names, unknown IDs, duplicates and size/count limits',()=>{
 const s=new Store(':memory:');try{
  expect(()=>s.upload('../x','text/plain',Buffer.from('x'))).toThrow('文件名');
  expect(()=>s.upload('x','text/plain',Buffer.alloc(0))).toThrow('20 MiB');
  expect(()=>s.upload('x','text/plain',Buffer.alloc(MAX_FILE_BYTES+1))).toThrow('20 MiB');
  const a=s.upload('x.txt','text/plain',Buffer.from('x'));const session=s.createSession('3.1 pro');
  expect(()=>s.submit(session.id,'a','UI',0,600000,['missing'])).toThrow('找不到附件');
  expect(()=>s.submit(session.id,'a','UI',0,600000,[a.id,a.id])).toThrow('重复');
  expect(()=>s.submit(session.id,'a','UI',0,600000,Array(11).fill(a.id))).toThrow('10');
  const big=Array.from({length:3},(_,i)=>s.upload(i+'.txt','text/plain',Buffer.alloc(MAX_FILE_BYTES,42)));
  expect(big.reduce((n,f)=>n+f.size,0)).toBeGreaterThan(MAX_TOTAL_BYTES);
  expect(()=>s.submit(session.id,'a','UI',0,600000,big.map(f=>f.id))).toThrow('40 MiB');
 }finally{s.close();}
});
it('reads bounded regular files and MIME types; snapshot survives subsequent file edits',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bridge-paths-'));try{
  const path=join(dir,'参考.png');writeFileSync(path,Buffer.from([137,80,78,71,13,10,26,10,0]));
  const file=await readAttachment(path);expect(file.name).toBe('参考.png');expect(file.mimeType).toBe('image/png');
  writeFileSync(path,'changed');expect(file.bytes.length).toBe(9);
  await expect(readAttachment('relative.txt')).rejects.toThrow('绝对路径');
  await expect(readAttachment(dir)).rejects.toThrow('普通文件');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
it('requires complete upload evidence before dispatch and blocks uncertain preparation failures',()=>{
 const s=new Store(':memory:');try{
  const f=s.upload('brief.txt','text/plain',Buffer.from('brief'));const session=s.createSession('3.1 pro');
  const j=s.submit(session.id,'key','UI',0,600000,[f.id]);s.dispatch(j.id,'browser');
  const cp={phase:'preparing' as const,beforeUsers:[],beforeReplies:[],prompt:'UI',conversationUrl:null,modelLabel:'Pro',updatedAt:Date.now(),upload:{ids:[f.id],state:'uploading' as const}};
  s.checkpoint(j.id,cp,'preparing');
  expect(()=>s.checkpoint(j.id,{...cp,phase:'dispatching'},'dispatching')).toThrow('尚未就绪');
  expect(()=>s.checkpoint(j.id,{...cp,upload:{ids:[],state:'uploading'}},'preparing')).toThrow('不能回退');
  s.finish(j.id,{state:'failed',error:{code:'upload_failed',message:'interrupted'}});
  expect(s.job(j.id).state).toBe('unknown');expect(s.session(session.id).status).toBe('blocked');
 }finally{s.close();}
});
