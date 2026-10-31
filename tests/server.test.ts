import { afterEach,describe,it,expect } from 'vitest';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createBridge } from '../src/server.js';
import { Store } from '../src/store.js';
const resources:{bridge:ReturnType<typeof createBridge>;store:Store;ws?:WebSocket}[]=[];
afterEach(async()=>{for(const r of resources.splice(0)){r.ws?.terminate();await r.bridge.close();r.store.close();}});
async function setup(){const store=new Store(':memory:');const bridge=createBridge(store,'test-token');bridge.server.listen(0,'127.0.0.1');await once(bridge.server,'listening');const port=(bridge.server.address() as AddressInfo).port;const resource={bridge,store,ws:undefined as WebSocket|undefined};resources.push(resource);return {...resource,resource,port,url:`http://127.0.0.1:${port}`};}
function next(ws:WebSocket,type:string):Promise<any>{return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{ws.off('message',listener);reject(new Error(`No ${type}`));},3000);const listener=(data:any)=>{const msg=JSON.parse(data.toString());if(msg.type===type){clearTimeout(timeout);ws.off('message',listener);resolve(msg);}};ws.on('message',listener);});}
const headers={Authorization:'Bearer test-token','Content-Type':'application/json'};
describe('local API and browser recovery',()=>{
 it('authenticates binary uploads and downloads and carries attachment snapshots on submit',async()=>{
  const {url}=await setup();const bytes=new Uint8Array([137,80,78,71,0,255]);
  const uploadHeaders={Authorization:'Bearer test-token','X-File-Name':encodeURIComponent('参考.png'),'Content-Type':'image/png'};
  expect((await fetch(url+'/api/files',{method:'POST',body:bytes})).status).toBe(401);
  const response=await fetch(url+'/api/files',{method:'POST',headers:uploadHeaders,body:bytes});expect(response.status).toBe(201);
  const file=await response.json();expect(file.name).toBe('参考.png');
  expect((await fetch(url+'/api/files/'+file.id+'/content')).status).toBe(401);
  const download=await fetch(url+'/api/files/'+file.id+'/content',{headers});expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
  const session=await(await fetch(url+'/api/sessions',{method:'POST',headers,body:'{}'})).json();
  const job=await(await fetch(url+'/api/sessions/'+session.id+'/jobs',{method:'POST',headers,body:JSON.stringify({prompt:'UI',request_id:'file-test',expected_revision:0,attachment_ids:[file.id]})})).json();
  expect(job.attachments).toEqual([file]);
 });

 it('requires authentication, blocks webpage origins, and defaults new sessions to Pro',async()=>{
  const {url}=await setup();expect((await fetch(`${url}/api/health`)).status).toBe(401);
  expect((await fetch(`${url}/api/health`,{headers:{...headers,Origin:'https://evil.example'}})).status).toBe(403);
  const created=await fetch(`${url}/api/sessions`,{method:'POST',headers,body:'{}'});expect(created.status).toBe(201);expect(await created.json()).toMatchObject({model:'3.1 pro',thinkingLevel:'high'});
  const argon=await(await fetch(`${url}/api/sessions`,{method:'POST',headers,body:JSON.stringify({model:'4 argon'})})).json();
  const slow=await(await fetch(`${url}/api/sessions/${argon.id}/jobs`,{method:'POST',headers,body:JSON.stringify({request_id:'slow',prompt:'Global UI redesign',expected_revision:0})})).json();
  expect(slow.thinkingLevel).toBe('high');expect(slow.deadline-slow.createdAt).toBe(1200000);
  const bad=await fetch(`${url}/api/sessions`,{method:'POST',headers,body:JSON.stringify({model:'anything'})});expect(bad.status).toBe(400);
 });
 it('executes, recovers after socket loss, and returns the same result for retries',async()=>{
  const {url,port,store,resource}=await setup();
  const s=store.createSession('3.1 pro');
  const ws=new WebSocket(`ws://127.0.0.1:${port}/bridge`,{origin:'chrome-extension://'+'a'.repeat(32)});resource.ws=ws;await once(ws,'open');
  let ready=next(ws,'ready');ws.send(JSON.stringify({type:'hello',token:'test-token',browserId:'a7c87420-35ae-411c-93b5-3cc6c63f3a38'}));await ready;
  const payload={request_id:'stable-key',prompt:'Improve UI',expected_revision:0};
  let commandPromise=next(ws,'run');const response=await fetch(`${url}/api/sessions/${s.id}/jobs`,{method:'POST',headers,body:JSON.stringify(payload)});const job=await response.json();
  const command=await commandPromise;expect(command.recover).toBe(false);
  const cp={phase:'submitted',beforeUsers:[],beforeReplies:[],prompt:'Improve UI',conversationUrl:'https://gemini.google.com/app/abc123',modelLabel:'3.1 Pro',updatedAt:Date.now()};
  let ack=next(ws,'ack');ws.send(JSON.stringify({type:'progress',jobId:job.id,attempt:command.job.attempt,eventId:'one',state:'submitted',checkpoint:cp}));await ack;
  ws.close();await once(ws,'close');
  const reconnect=new WebSocket(`ws://127.0.0.1:${port}/bridge`,{origin:'chrome-extension://'+'a'.repeat(32)});resource.ws=reconnect;await once(reconnect,'open');
  ready=next(reconnect,'ready');commandPromise=next(reconnect,'run');reconnect.send(JSON.stringify({type:'hello',token:'test-token',browserId:'a7c87420-35ae-411c-93b5-3cc6c63f3a38'}));await ready;const recovered=await commandPromise;expect(recovered.recover).toBe(true);expect(recovered.job.checkpoint).toEqual(cp);
  ack=next(reconnect,'ack');reconnect.send(JSON.stringify({type:'outcome',jobId:job.id,attempt:recovered.job.attempt,eventId:'two',outcome:{result:{text:'Use spacing consistently.',requestedModel:'3.1 pro',observedModelLabel:'3.1 Pro',modelVerified:true,requestedThinkingLevel:'high' as const,observedThinkingLabel:'高',thinkingVerified:true,conversationUrl:cp.conversationUrl,completedAt:Date.now()},checkpoint:cp}}));await ack;
  const retry=await fetch(`${url}/api/sessions/${s.id}/jobs`,{method:'POST',headers,body:JSON.stringify(payload)});const cached=await retry.json();expect(cached.id).toBe(job.id);expect(cached.state).toBe('completed');expect(store.session(s.id).revision).toBe(1);
 });
 it('releases a blocked queue only after the extension confirms closing the cancelled task tab',async()=>{
  const {url,port,store,resource}=await setup();const s=store.createSession('4 argon');const j=store.submit(s.id,'one','UI',0);
  const browserId='a7c87420-35ae-411c-93b5-3cc6c63f3a38';store.dispatch(j.id,browserId);store.finish(j.id,{state:'unknown',error:{code:'generation_timeout',message:'Stalled'}});
  const ws=new WebSocket(`ws://127.0.0.1:${port}/bridge`,{origin:'chrome-extension://'+'a'.repeat(32)});resource.ws=ws;await once(ws,'open');
  const ready=next(ws,'ready');ws.send(JSON.stringify({type:'hello',token:'test-token',browserId}));await ready;
  const command=next(ws,'cancelJob');const response=fetch(`${url}/api/jobs/${j.id}/cancel`,{method:'POST',headers});const close=await command;
  expect(store.job(j.id).state).toBe('unknown');ws.send(JSON.stringify({type:'inspection',controlId:close.controlId,result:{ok:true}}));
  const data=await(await response).json();expect(data.error.code).toBe('cancelled');expect(store.session(s.id).status).toBe('blocked');
  const fresh=store.createSession('3.1 pro');expect(store.submit(fresh.id,'fresh','UI',0).state).toBe('queued');
 });

});

it('persists refresh intent across the API and websocket and returns recovery guidance',async()=>{
 const {url,port,store,resource}=await setup();const browserId='a7c87420-35ae-411c-93b5-3cc6c63f3a38';
 const s=store.createSession('3.1 pro');const j=store.submit(s.id,'recover','UI',0);store.dispatch(j.id,browserId);
 const cp={phase:'preparing' as const,beforeUsers:[],beforeReplies:[],prompt:'UI',conversationUrl:null,modelLabel:'Pro',updatedAt:Date.now()};
 store.checkpoint(j.id,cp,'preparing');store.finish(j.id,{state:'unknown',error:{code:'attachment_not_ready',message:'Upload stalled'}});
 const current=await(await fetch(url+'/api/jobs/'+j.id,{headers})).json();expect(current.recovery).toMatchObject({action:'resume_with_refresh',refresh:true});
 const ws=new WebSocket(`ws://127.0.0.1:${port}/bridge`,{origin:'chrome-extension://'+'a'.repeat(32)});resource.ws=ws;await once(ws,'open');const ready=next(ws,'ready');ws.send(JSON.stringify({type:'hello',token:'test-token',browserId}));await ready;
 const run=next(ws,'run');const resumed=await fetch(url+'/api/jobs/'+j.id+'/resume',{method:'POST',headers,body:JSON.stringify({refresh:true})});expect(resumed.status).toBe(200);
 const command=await run;expect(command.job.refreshRequested).toBe(true);
 const ack=next(ws,'ack');ws.send(JSON.stringify({type:'progress',eventId:'refresh',jobId:j.id,attempt:command.job.attempt,state:'preparing',checkpoint:{...cp,recovery:{refreshes:1,resetUpload:true}}}));await ack;
 expect(store.job(j.id).checkpoint?.recovery).toEqual({refreshes:1,resetUpload:true});expect(store.job(j.id).refreshRequested).toBe(false);
});
