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
    store.finish(j.id,{result:{text:'Use a compact header.',requestedModel:'3.1 pro',observedModelLabel:'3.1 Pro',modelVerified:true,requestedThinkingLevel:'medium' as const,observedThinkingLabel:'中',thinkingVerified:true,conversationUrl:cp.conversationUrl!,completedAt:Date.now()}});
    const same=store.submit(s.id,'one','Design a navbar',0);
    expect(same.id).toBe(j.id);expect(same.state).toBe('completed');expect(store.session(s.id).revision).toBe(1);
    expect(()=>store.submit(s.id,'one','Different prompt',0)).toThrow('不同内容');
    expect(()=>store.submit(s.id,'two','Next prompt',0)).toThrow('revision');
    expect(store.submit(s.id,'two','Next prompt',1).state).toBe('queued');
  });
  it('does not increment revision twice for a repeated result',()=>{
    const {store}=setup();const s=store.createSession('4 argon');const j=store.submit(s.id,'one','Design',0);store.dispatch(j.id,browser);
    const outcome={result:{text:'Answer',requestedModel:'4 argon' as const,observedModelLabel:'4 Argon',modelVerified:true,requestedThinkingLevel:'medium' as const,observedThinkingLabel:'中',thinkingVerified:true,conversationUrl:'https://gemini.google.com/app/abcdef',completedAt:Date.now()}};
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
    expect(()=>store.finish(j.id,{result:{text:'x',requestedModel:'3.1 pro',observedModelLabel:'3.1 Pro',modelVerified:true,requestedThinkingLevel:'medium' as const,observedThinkingLabel:'中',thinkingVerified:true,conversationUrl:'https://gemini.google.com/app/first',completedAt:Date.now()}})).toThrow('校验失败');
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
