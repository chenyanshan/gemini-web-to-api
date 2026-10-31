import { describe,it,expect,afterEach } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import type { Checkpoint } from '../src/protocol.js';
const stores:Store[]=[];const dirs:string[]=[];
const setup=()=>{const dir=mkdtempSync(join(tmpdir(),'gemini-store-'));dirs.push(dir);const path=join(dir,'test.sqlite');const store=new Store(path);stores.push(store);return {store,path};};
afterEach(()=>{for(const store of stores.splice(0))store.close();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
const browser='a7c87420-35ae-411c-93b5-3cc6c63f3a38';
const cp:Checkpoint={phase:'submitted',beforeUsers:[],beforeReplies:[],prompt:'Design a navbar',conversationUrl:'https://gemini.google.com/app/abc123',modelLabel:'3.1 Pro',updatedAt:Date.now()};
describe('durable task semantics',()=>{
  it('deduplicates completed requests even after revision changes',()=>{
    const {store}=setup();const s=store.createSession('3.1 pro');const j=store.submit(s.id,'one','Design a navbar',0);
    store.dispatch(j.id,browser);store.checkpoint(j.id,cp,'submitted');
    store.finish(j.id,{result:{text:'Use a compact header.',requestedModel:'3.1 pro',observedModelLabel:'3.1 Pro',modelVerified:true,requestedThinkingLevel:'high' as const,observedThinkingLabel:'高',thinkingVerified:true,conversationUrl:cp.conversationUrl!,completedAt:Date.now()}});
    const same=store.submit(s.id,'one','Design a navbar',0);
    expect(same.id).toBe(j.id);expect(same.state).toBe('completed');expect(store.session(s.id).revision).toBe(1);
    expect(()=>store.submit(s.id,'one','Different prompt',0)).toThrow('不同内容');
    expect(()=>store.submit(s.id,'two','Next prompt',0)).toThrow('revision');
    expect(store.submit(s.id,'two','Next prompt',1).state).toBe('queued');
  });
  it('does not increment revision twice for a repeated result',()=>{
    const {store}=setup();const s=store.createSession('4 argon');const j=store.submit(s.id,'one','Design',0);store.dispatch(j.id,browser);
    const outcome={result:{text:'Answer',requestedModel:'4 argon' as const,observedModelLabel:'4 Argon',modelVerified:true,requestedThinkingLevel:'high' as const,observedThinkingLabel:'高',thinkingVerified:true,conversationUrl:'https://gemini.google.com/app/abcdef',completedAt:Date.now()}};
    store.finish(j.id,outcome);store.finish(j.id,outcome);expect(store.session(s.id).revision).toBe(1);
  });
  it('holds the session if a failure occurs after send intent',()=>{
    const {store}=setup();const s=store.createSession('4 argon');const j=store.submit(s.id,'one','Design',0);store.dispatch(j.id,browser);
    store.checkpoint(j.id,{...cp,phase:'dispatching',prompt:'Design'},'dispatching');
    const failed=store.finish(j.id,{state:'failed',error:{code:'network',message:'Disconnected'}});
    expect(failed.state).toBe('unknown');expect(store.session(s.id).status).toBe('blocked');
    expect(()=>store.submit(s.id,'two','Design',0)).toThrow('先恢复');
    expect(store.resume(j.id).state).toBe('reconciling');
  });
  it('restores interrupted tasks into reconciliation and retains prompts',()=>{
    const {store,path}=setup();const s=store.createSession('4 argon');const j=store.submit(s.id,'one','Improve UI',0);store.dispatch(j.id,browser);store.checkpoint(j.id,{...cp,prompt:'Improve UI'},'submitted');
    store.close();stores.splice(stores.indexOf(store),1);
    const reopened=new Store(path);stores.push(reopened);
    expect(reopened.job(j.id).state).toBe('reconciling');expect(reopened.job(j.id).prompt).toBe('Improve UI');expect(reopened.job(j.id).checkpoint).toEqual({...cp,prompt:'Improve UI'});
    expect(()=>reopened.dispatch(j.id,'another-browser')).toThrow('另一个浏览器');
  });
  it('rejects overlapping turns and duplicate conversation bindings',()=>{
    const {store}=setup();const url='https://gemini.google.com/app/old123';const s=store.createSession('3.1 pro','existing',url);
    expect(()=>store.createSession('4 argon','same',url)).toThrow('已绑定');
    store.submit(s.id,'one','Design',0);expect(()=>store.submit(s.id,'two','Other',0)).toThrow('已有任务');
    expect(()=>store.createSession('3.1 pro','bad','https://evil.example/app/abc')).toThrow('对话地址');
  });
  it('will not accept a result from another conversation or silently changed model',()=>{
    const {store}=setup();const s=store.createSession('4 argon','existing','https://gemini.google.com/app/first');const j=store.submit(s.id,'one','Design',0);store.dispatch(j.id,browser);
    expect(()=>store.finish(j.id,{result:{text:'x',requestedModel:'3.1 pro',observedModelLabel:'3.1 Pro',modelVerified:true,requestedThinkingLevel:'high' as const,observedThinkingLabel:'高',thinkingVerified:true,conversationUrl:'https://gemini.google.com/app/first',completedAt:Date.now()}})).toThrow('校验失败');
    expect(store.job(j.id).state).toBe('preparing');expect(store.session(s.id).revision).toBe(0);
  });
  it('archives a missing turn before an explicit retry, and deduplicates the retry operation',()=>{
    const {store}=setup();const s=store.createSession('4 argon');const j=store.submit(s.id,'one','Design',0);store.dispatch(j.id,browser);
    store.checkpoint(j.id,{...cp,prompt:'Design'},'submitted');
    store.finish(j.id,{state:'unknown',error:{code:'turn_missing',message:'Turn vanished'}});
    const retry=store.retryMissing(j.id,'retry-one');expect(retry.prompt).toBe('Design');expect(retry.state).toBe('queued');
    expect(store.job(j.id).replacementJobId).toBe(retry.id);expect(store.job(j.id).checkpoint?.phase).toBe('submitted');
    expect(store.retryMissing(j.id,'retry-one').id).toBe(retry.id);expect(()=>store.retryMissing(j.id,'retry-two')).toThrow('已经发起重试');
  });

  it('cancels a stalled task while preserving its send record and blocking reuse of ambiguous context',()=>{
    const {store}=setup();const s=store.createSession('4 argon');const j=store.submit(s.id,'one','Design',0);store.dispatch(j.id,browser);store.checkpoint(j.id,{...cp,prompt:'Design'},'submitted');
    expect(store.cancel(j.id).error?.code).toBe('cancelled');expect(store.job(j.id).checkpoint?.phase).toBe('submitted');expect(store.session(s.id).status).toBe('blocked');
    expect(store.cancel(j.id).error?.code).toBe('cancelled');
  });

});

describe('session configuration and bounded preparation recovery',()=>{
 it('switches configuration in the same context and replays old requests after the switch',()=>{
  const {store}=setup();const s=store.createSession('3.1 pro','UI','https://gemini.google.com/app/switch');
  const j=store.submit(s.id,'one','Design',0);store.dispatch(j.id,browser);
  store.finish(j.id,{result:{text:'Answer',requestedModel:'3.1 pro',observedModelLabel:'Pro',modelVerified:true,requestedThinkingLevel:'high',observedThinkingLabel:'高',thinkingVerified:true,conversationUrl:s.conversationUrl!,completedAt:Date.now()}});
  const next=store.updateSession(s.id,1,'4 argon','high');
  expect(next).toMatchObject({id:s.id,conversationUrl:s.conversationUrl,model:'4 argon',thinkingLevel:'high',revision:2});
  expect(store.updateSession(s.id,1,'4 argon','high')).toEqual(next);
  expect(store.submit(s.id,'one','Design',0).id).toBe(j.id);
  expect(()=>store.updateSession(s.id,1,'3.1 pro')).toThrow('revision');
  expect(()=>store.submit(s.id,'two','Next',1)).toThrow('revision');
  expect(store.submit(s.id,'two','Next',2)).toMatchObject({model:'4 argon',thinkingLevel:'high'});
  expect(()=>store.updateSession(s.id,2,'3.1 pro')).toThrow('先处理');
 });
 it('does not allow lowering upload progress unless a persisted preparation refresh was consumed',()=>{
  const {store}=setup();const file=store.upload('ui.txt','text/plain',Buffer.from('UI'));const s=store.createSession('3.1 pro');const j=store.submit(s.id,'one','Design',0,600000,[file.id]);store.dispatch(j.id,browser);
  const preparing:Checkpoint={...cp,phase:'preparing',prompt:'Design',upload:{ids:[file.id],state:'uploading'}};
  store.checkpoint(j.id,preparing,'preparing');
  expect(()=>store.checkpoint(j.id,{...preparing,upload:undefined},'preparing')).toThrow('不能回退');
  store.checkpoint(j.id,{...preparing,recovery:{refreshes:1,resetUpload:true}},'preparing');
  expect(store.checkpoint(j.id,{...preparing,upload:undefined,recovery:{refreshes:1,resetUpload:false}},'preparing').checkpoint?.upload).toBeUndefined();
  expect(()=>store.checkpoint(j.id,{...preparing,recovery:{refreshes:0,resetUpload:false}},'preparing')).toThrow('刷新次数');
 });
 it('rejects clearing attachments of a dispatched turn and excessive refresh attempts',()=>{
  const {store}=setup();const s=store.createSession('3.1 pro');const j=store.submit(s.id,'one','Design',0);store.dispatch(j.id,browser);
  const sent={...cp,prompt:'Design'};store.checkpoint(j.id,sent,'submitted');
  expect(()=>store.checkpoint(j.id,{...sent,recovery:{refreshes:1,resetUpload:true}},'submitted')).toThrow('已发送');
  store.checkpoint(j.id,{...sent,recovery:{refreshes:1,resetUpload:false}},'submitted');
  store.checkpoint(j.id,{...sent,recovery:{refreshes:2,resetUpload:false}},'submitted');
  store.finish(j.id,{state:'unknown',error:{code:'generation_failed',message:'failed'}});
  expect(()=>store.resume(j.id,true)).toThrow('已刷新两次');expect(store.session(s.id).status).toBe('blocked');
 });
});

it('defaults to high and gives Argon high twenty minutes, preserving timeout choices on replay and recovery',()=>{
 const {store}=setup();const pro=store.createSession('3.1 pro');expect(pro.thinkingLevel).toBe('high');
 const normal=store.submit(pro.id,'normal','UI',0);expect(normal.deadline-normal.createdAt).toBe(600000);
 const argon=store.createSession('4 argon');const slow=store.submit(argon.id,'slow','UI',0);expect(slow.deadline-slow.createdAt).toBe(1200000);
 expect(store.submit(argon.id,'slow','UI',0).id).toBe(slow.id);
 store.dispatch(slow.id,browser);store.finish(slow.id,{state:'unknown',error:{code:'generation_timeout',message:'timeout'}});
 const before=Date.now();expect(store.resume(slow.id).deadline).toBeGreaterThanOrEqual(before+1200000);
 const explicit=store.createSession('4 argon');const custom=store.submit(explicit.id,'custom','UI',0,900000);expect(custom.timeoutMs).toBe(900000);expect(store.submit(explicit.id,'custom','UI',0,900000).id).toBe(custom.id);
});
