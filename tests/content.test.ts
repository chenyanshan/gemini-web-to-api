// @vitest-environment jsdom
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import type {RunCommand,Checkpoint} from '../src/protocol';
vi.mock('../extension/adapter',async importOriginal=>{
 const actual=await importOriginal<typeof import('../extension/adapter')>();
 return {...actual,selectModel:vi.fn(async()=> '3.1 Pro'),selectThinking:vi.fn(async()=> '中')};
});
let storage:Record<string,unknown>;
let sendProgress:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 vi.useFakeTimers();storage={};sendProgress=vi.fn(async()=>({ok:true}));
 vi.stubGlobal('chrome',{storage:{local:{get:async(key:string)=>({[key]:storage[key]}),set:async(value:Record<string,unknown>)=>{Object.assign(storage,value);}}},runtime:{sendMessage:sendProgress,onMessage:{addListener:vi.fn(),removeListener:vi.fn()}}});
 vi.stubGlobal('location',{href:'https://gemini.google.com/app/abc123'});
 vi.spyOn(HTMLElement.prototype,'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
 Object.defineProperty(HTMLElement.prototype,'innerText',{configurable:true,get(){return this.textContent;},set(value){this.textContent=value;}});
 document.body.innerHTML='<button aria-haspopup="menu" aria-label="打开模式选择器，当前模式为 3.1 Pro">3.1 Pro</button><div contenteditable="true" role="textbox">Improve button spacing.</div><button aria-label="Send">Send</button>';
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
function command(recover=false):RunCommand{
 const now=Date.now();return {type:'run',recover,session:{id:'session',label:'test',model:'3.1 pro',thinkingLevel:'medium',conversationUrl:'https://gemini.google.com/app/abc123',revision:0,browserId:'browser',status:'busy',createdAt:now},job:{id:'job',sessionId:'session',requestId:'key',inputHash:'hash',prompt:'Improve button spacing.',expectedRevision:0,state:recover?'reconciling':'preparing',createdAt:now,updatedAt:now,deadline:now+60000,attempt:1,checkpoint:null,result:null,error:null}};
}
describe('browser turn recovery',()=>{
 it('persists send intent before clicking, and returns a completed cached result without another click',async()=>{
  const {execute}=await import('../extension/content');const click=vi.fn(()=>{
   const saved=storage['job:job'] as {checkpoint:Checkpoint};expect(saved.checkpoint.phase).toBe('dispatching');
   document.body.insertAdjacentHTML('beforeend','<user-query><div class="query-text">Improve button spacing.</div></user-query><model-response><div class="markdown"><p>Use an 8px gap.</p></div><button aria-label="Copy">Copy</button></model-response>');
  });document.querySelector('[aria-label="Send"]')!.addEventListener('click',click);
  const pending=execute(command(),'3.1 Pro');await vi.advanceTimersByTimeAsync(6000);const outcome=await pending;
  expect('result' in outcome).toBe(true);expect(click).toHaveBeenCalledTimes(1);
  const cached=await execute(command(true),'3.1 Pro');expect(cached).toEqual(outcome);expect(click).toHaveBeenCalledTimes(1);
 });
 it('does not click when the durable service fails to acknowledge send intent',async()=>{
  const {execute}=await import('../extension/content');sendProgress.mockImplementation(async(message)=>({ok:message.state!=='dispatching'}));
  const click=vi.fn();document.querySelector('[aria-label="Send"]')!.addEventListener('click',click);
  const pending=execute(command(),'3.1 Pro');await vi.advanceTimersByTimeAsync(1000);const outcome=await pending;
  expect(click).not.toHaveBeenCalled();expect('state' in outcome && outcome.state).toBe('unknown');
 });
 it('detects a vanished Argon turn after refresh without resending the prompt',async()=>{
  const {execute}=await import('../extension/content');
  document.body.insertAdjacentHTML('beforeend','<user-query><div class="query-text">Old question</div></user-query><model-response><div class="markdown">Old answer</div><button aria-label="Copy">Copy</button></model-response>');
  const c=command(true);c.session.model='4 argon';
  c.job.checkpoint={phase:'submitted',beforeUsers:['Old question'],beforeReplies:['Old answer'],prompt:c.job.prompt,conversationUrl:c.session.conversationUrl,modelLabel:'4 Argon',thinkingLabel:'中',updatedAt:Date.now()};
  const click=vi.fn();document.querySelector('[aria-label="Send"]')!.addEventListener('click',click);
  const pending=execute(c,'4 Argon');await vi.advanceTimersByTimeAsync(17000);const outcome=await pending;
  expect('error' in outcome && outcome.error.code).toBe('turn_missing');expect(click).not.toHaveBeenCalled();
  expect((storage['job:job'] as {checkpoint:Checkpoint}).checkpoint.prompt).toBe(c.job.prompt);
 });
 it('recovers a prepared attachment draft without uploading a duplicate',async()=>{
  const {execute}=await import('../extension/content');
  const c=command(true);const file={id:'file',name:'brief.txt',mimeType:'text/plain',size:4,sha256:'hash',createdAt:0};
  c.job.attachments=[file];
  c.job.checkpoint={phase:'preparing',beforeUsers:[],beforeReplies:[],prompt:c.job.prompt,conversationUrl:c.session.conversationUrl,modelLabel:'3.1 Pro',thinkingLabel:'中',updatedAt:Date.now(),upload:{ids:['file'],state:'uploading'}};
  const card='<gem-attachment><span class="gem-attachment-text">brief</span><span class="gem-attachment-extension-label">TXT</span></gem-attachment>';
  const wrapper=document.createElement('input-container');document.body.append(wrapper);wrapper.append(document.querySelector('[role=textbox]')!);wrapper.insertAdjacentHTML('beforeend',card);
  const click=vi.fn(()=>{
   expect((storage['job:job'] as {checkpoint:Checkpoint}).checkpoint.upload?.state).toBe('ready');
   document.body.insertAdjacentHTML('beforeend','<user-query><user-query-file-preview><div data-test-id="uploaded-file"><button aria-label="brief.txt"></button></div></user-query-file-preview><div class="query-text">Improve button spacing.</div></user-query><model-response><div class="markdown">Use 8px.</div><button aria-label="Copy"></button></model-response>');
  });
  document.querySelector('[aria-label=Send]')!.addEventListener('click',click);
  const pending=execute(c,'3.1 Pro');await vi.advanceTimersByTimeAsync(8000);const result=await pending;
  expect('result' in result).toBe(true);expect(click).toHaveBeenCalledTimes(1);
  expect(sendProgress.mock.calls.some(([m])=>m.type==='attachmentData')).toBe(false);
 });
 it('does not resend or send text alone when an interrupted attachment upload disappeared',async()=>{
  const {execute}=await import('../extension/content');const c=command(true);
  c.job.attachments=[{id:'file',name:'brief.txt',mimeType:'text/plain',size:4,sha256:'hash',createdAt:0}];
  c.job.checkpoint={phase:'preparing',beforeUsers:[],beforeReplies:[],prompt:c.job.prompt,conversationUrl:c.session.conversationUrl,modelLabel:'3.1 Pro',thinkingLabel:'中',updatedAt:Date.now(),upload:{ids:['file'],state:'uploading'}};
  const click=vi.fn();document.querySelector('[aria-label=Send]')!.addEventListener('click',click);
  const pending=execute(c,'3.1 Pro');await vi.advanceTimersByTimeAsync(32000);const outcome=await pending;
  expect('state' in outcome && outcome.state).toBe('unknown');
  expect('error' in outcome && outcome.error.code).toBe('attachment_not_ready');
  expect(click).not.toHaveBeenCalled();expect(sendProgress.mock.calls.some(([m])=>m.type==='attachmentData')).toBe(false);
 });

 it('rechecks attachments after the service acknowledges the send intent',async()=>{
  const {execute}=await import('../extension/content');const c=command(true);
  c.job.attachments=[{id:'file',name:'brief.txt',mimeType:'text/plain',size:4,sha256:'hash',createdAt:0}];
  c.job.checkpoint={phase:'preparing',beforeUsers:[],beforeReplies:[],prompt:c.job.prompt,conversationUrl:c.session.conversationUrl,modelLabel:'3.1 Pro',thinkingLabel:'中',updatedAt:Date.now(),upload:{ids:['file'],state:'ready'}};
  const wrapper=document.createElement('input-container');document.body.append(wrapper);wrapper.append(document.querySelector('[role=textbox]')!);
  wrapper.insertAdjacentHTML('beforeend','<gem-attachment><span class="gem-attachment-text">brief</span><span class="gem-attachment-extension-label">TXT</span></gem-attachment>');
  sendProgress.mockImplementation(async(message)=>{if(message.state==='dispatching')document.querySelector('gem-attachment')?.remove();return {ok:true};});
  const click=vi.fn();document.querySelector('[aria-label=Send]')!.addEventListener('click',click);
  const pending=execute(c,'3.1 Pro');await vi.advanceTimersByTimeAsync(5000);const outcome=await pending;
  expect('error' in outcome && outcome.error.code).toBe('draft_conflict');expect(click).not.toHaveBeenCalled();
 });

});
