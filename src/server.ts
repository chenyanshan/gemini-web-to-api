import {recoveryAdvice} from './recovery.js';
import { landing } from './landing.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { ApiError, Store } from './store.js';
import { MAX_FILE_BYTES, MAX_ATTACHMENTS, MODELS, THINKING_LEVELS, type Job, isActive } from './protocol.js';
const checkpointSchema = z.object({recovery:z.object({refreshes:z.number().int().min(0).max(2),resetUpload:z.boolean()}).optional(),phase:z.enum(['preparing','dispatching','submitted']),beforeUsers:z.array(z.string()),beforeReplies:z.array(z.string()),prompt:z.string(),conversationUrl:z.string().nullable(),modelLabel:z.string(),thinkingLabel:z.string().optional(),updatedAt:z.number(),upload:z.object({ids:z.array(z.string()).max(MAX_ATTACHMENTS),state:z.enum(['uploading','ready'])}).optional()});
const resultSchema = z.object({text:z.string().min(1),requestedModel:z.enum(MODELS),observedModelLabel:z.string(),modelVerified:z.boolean(),requestedThinkingLevel:z.enum(THINKING_LEVELS),observedThinkingLabel:z.string(),thinkingVerified:z.boolean(),conversationUrl:z.string(),completedAt:z.number()});
const outcomeSchema = z.union([
  z.object({result:resultSchema,checkpoint:checkpointSchema.optional()}),
  z.object({error:z.object({code:z.string(),message:z.string()}),state:z.enum(['failed','unknown','blocked_login']),checkpoint:checkpointSchema.optional()})
]);
function equal(a:string,b:string) { const x=Buffer.from(a),y=Buffer.from(b); return x.length === y.length && timingSafeEqual(x,y); }
async function body(req:IncomingMessage) {
  const chunks:Buffer[]=[]; let size=0;
  for await (const chunk of req) {size+=chunk.length; if(size>2_000_000) throw new ApiError('payload_too_large','请求过大',413); chunks.push(chunk);}
  try {return JSON.parse(Buffer.concat(chunks).toString() || '{}');} catch {throw new ApiError('invalid_json','JSON 格式错误');}
}
function send(res:ServerResponse,status:number,value:unknown) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value));}
export function createBridge(store:Store,token:string) {
  let connection: {ws:WebSocket;browserId:string;lastSeen:number;version:string}|null=null;
  let inFlight:string|null=null;
  let models:unknown[]=[];
  let modelsUpdatedAt:number|null=null;
  let stopped=false;
  const controls=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const server = createServer(async(req,res)=>{
    try {
      const host=req.headers.host || '';
      if(!/^127\.0\.0\.1:\d+$/.test(host)) throw new ApiError('invalid_host','仅接受 127.0.0.1',403);
      const origin=req.headers.origin;
      if(origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) throw new ApiError('invalid_origin','不接受网页跨域请求',403);
      const url=new URL(req.url || '/',`http://${host}`); const path=url.pathname;
      if(req.method==='GET' && path==='/') {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"});res.end(landing);return;}
      if(!equal(req.headers.authorization || '',`Bearer ${token}`)) throw new ApiError('unauthorized','本地连接凭证无效',401);
      if(req.method==='POST' && path==='/api/files') {
        let name:string;
        try {name=decodeURIComponent(String(req.headers['x-file-name'] || ''));} catch {throw new ApiError('invalid_filename','文件名编码错误');}
        if(Number(req.headers['content-length'])>MAX_FILE_BYTES)throw new ApiError('file_size','单个附件不能超过 20 MiB',413);
        const chunks:Buffer[]=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>MAX_FILE_BYTES)throw new ApiError('file_size','单个附件不能超过 20 MiB',413);chunks.push(chunk);}
        return send(res,201,store.upload(name,String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim(),Buffer.concat(chunks)));
      }
      const fileMatch=path.match(/^\/api\/files\/([a-f0-9]{64})(\/content)?$/);
      if(req.method==='GET' && fileMatch) {
        const file=store.file(fileMatch[1]);
        if(!fileMatch[2])return send(res,200,file);
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':file.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        res.end(store.fileBytes(file.id));return;
      }
      if(req.method==='GET' && path==='/api/health') return send(res,200,{ok:true,browserConnected:!!connection,browserId:connection?.browserId || null,extensionVersion:connection?.version || null,activeJobId:inFlight,blockedJobs:store.jobs().filter(j=>['unknown','blocked_login'].includes(j.state)).map(j=>({id:j.id,state:j.state,error:j.error,recovery:recoveryAdvice(j)})),models,modelsUpdatedAt});
      if(req.method==='POST' && path==='/api/dev/reload-extension') {
        if(!connection)throw new ApiError('browser_offline','插件尚未连接',503);
        if(inFlight)throw new ApiError('browser_busy','任务正在执行，不能重新加载插件',409);
        connection.ws.send(JSON.stringify({type:'reload'}));return send(res,200,{requested:true});
      }
      if(req.method==='POST' && path==='/api/browser/inspect') {
        const input=z.object({selections:z.array(z.object({model:z.enum(MODELS),thinkingLevel:z.enum(THINKING_LEVELS)})).max(12).default([])}).parse(await body(req));
        if(!connection)throw new ApiError('browser_offline','插件尚未连接',503);
        if(inFlight || store.jobs().some(j=>['unknown','blocked_login'].includes(j.state)))throw new ApiError('browser_busy','先处理当前任务，再检查网页控件',409);
        const controlId=crypto.randomUUID();
        const data=await new Promise<unknown>((resolve,reject)=>{
          const timer=setTimeout(()=>{controls.delete(controlId);reject(new ApiError('inspect_timeout','读取网页控件超时；更新插件后请刷新 Gemini 页面',504));},90000);
          controls.set(controlId,{resolve,reject,timer});connection!.ws.send(JSON.stringify({type:'inspect',controlId,selections:input.selections}));
        });
        return send(res,200,data);
      }
      if(req.method==='GET' && path==='/api/models') return send(res,200,{requestedModels:MODELS,options:models,verified:modelsUpdatedAt!==null,updatedAt:modelsUpdatedAt});
      if(req.method==='GET' && path==='/api/sessions') return send(res,200,store.sessions());
      if(req.method==='POST' && path==='/api/sessions') {
        const input=z.object({model:z.enum(MODELS).default('3.1 pro'),thinking_level:z.enum(THINKING_LEVELS).default('high'),label:z.string().max(200).default(''),conversation_url:z.string().optional()}).parse(await body(req));
        return send(res,201,store.createSession(input.model,input.label,input.conversation_url,input.thinking_level));
      }
      let match=path.match(/^\/api\/sessions\/([^/]+)$/);
      if(req.method==='GET' && match) return send(res,200,store.session(match[1]));
      if(req.method==='PATCH' && match){
        const input=z.object({expected_revision:z.number().int().min(0),model:z.enum(MODELS).optional(),thinking_level:z.enum(THINKING_LEVELS).optional()}).refine(v=>v.model!==undefined || v.thinking_level!==undefined).parse(await body(req));
        return send(res,200,store.updateSession(match[1],input.expected_revision,input.model,input.thinking_level));
      }
      match=path.match(/^\/api\/sessions\/([^/]+)\/jobs$/);
      if(req.method==='POST' && match) {
        const input=z.object({attachment_ids:z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(MAX_ATTACHMENTS).default([]),request_id:z.string().min(1).max(200).optional(),prompt:z.string().trim().min(1).max(200_000),expected_revision:z.number().int().min(0),timeout_ms:z.number().int().min(10_000).max(1_800_000).optional()}).parse(await body(req));
        const header=req.headers['idempotency-key'];
        if(typeof header==='string' && input.request_id && header!==input.request_id) throw new ApiError('idempotency_conflict','请求头和请求体 request_id 不一致',409);
        const key=z.string().min(1).max(200).parse(header || input.request_id);
        const job=store.submit(match[1],key,input.prompt,input.expected_revision,input.timeout_ms,input.attachment_ids);
        send(res,202,job); schedule(); return;
      }
      match=path.match(/^\/api\/jobs\/([^/]+)$/);
      if(req.method==='GET' && match) {
        const wait=z.coerce.number().int().min(0).max(20_000).parse(url.searchParams.get('wait_ms') || 0);
        let job=store.job(match[1]); const until=Date.now()+wait;
        while((job.state==='queued'||isActive(job.state)) && Date.now()<until && !res.destroyed && !stopped) {await new Promise(r=>setTimeout(r,250));job=store.job(match[1]);}
        return send(res,200,{...job,recovery:recoveryAdvice(job)});
      }
      match=path.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
      if(req.method==='POST' && match){
        const job=store.job(match[1]);
        if(job.state==='completed' || job.error?.code==='cancelled')return send(res,200,job);
        if(job.state!=='queued'){
          const session=store.session(job.sessionId);
          if(!connection || session.browserId!==connection.browserId)throw new ApiError('browser_offline','原浏览器未连接，无法确认关闭任务页',503);
          const controlId=crypto.randomUUID();const result=await new Promise<unknown>((resolve,reject)=>{
            const timer=setTimeout(()=>{controls.delete(controlId);reject(new ApiError('cancel_timeout','关闭任务页未确认，请重新查询任务',504));},10000);
            controls.set(controlId,{resolve,reject,timer});connection!.ws.send(JSON.stringify({type:'cancelJob',controlId,jobId:job.id,sessionId:job.sessionId}));
          });
          if(!(result as {ok?:boolean})?.ok)throw new ApiError('cancel_failed','插件未确认取消任务',409);
        }
        const result=store.cancel(job.id);if(inFlight===job.id)inFlight=null;send(res,200,result);schedule();return;
      }
      match=path.match(/^\/api\/jobs\/([^/]+)\/browser-state$/);
      if(req.method==='GET' && match){
        const job=store.job(match[1]);const session=store.session(job.sessionId);
        if(!connection || session.browserId!==connection.browserId)throw new ApiError('browser_offline','原浏览器未连接',503);
        const controlId=crypto.randomUUID();const data=await new Promise<unknown>((resolve,reject)=>{
          const timer=setTimeout(()=>{controls.delete(controlId);reject(new ApiError('inspect_timeout','读取任务页面超时',504));},10000);
          controls.set(controlId,{resolve,reject,timer});connection!.ws.send(JSON.stringify({type:'inspectJob',controlId,sessionId:job.sessionId}));
        });return send(res,200,data);
      }
      match=path.match(/^\/api\/jobs\/([^/]+)\/retry-missing$/);
      if(req.method==='POST' && match) {
        const input=z.object({request_id:z.string().min(1).max(200),acknowledge_duplicate_risk:z.literal(true)}).parse(await body(req));
        const job=store.retryMissing(match[1],input.request_id);send(res,202,job);schedule();return;
      }
      match=path.match(/^\/api\/jobs\/([^/]+)\/resume$/);
      if(req.method==='POST' && match) { const input=z.object({refresh:z.boolean().default(false)}).parse(await body(req));const job=store.resume(match[1],input.refresh);send(res,200,job);schedule();return; }
      throw new ApiError('not_found','接口不存在',404);
    } catch(e) {
      if(e instanceof z.ZodError) return send(res,400,{error:{code:'invalid_input',message:e.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')}});
      const error=e instanceof ApiError?e:new ApiError('internal_error','本地服务异常',500);
      if(!(e instanceof ApiError)) console.error(e);
      if(!res.headersSent) send(res,error.status,{error:{code:error.code,message:error.message}});
    }
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:4_000_000});
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/bridge' || !/^127\.0\.0\.1:\d+$/.test(req.headers.host || '') || !/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin || '')) {socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
  });
  wss.on('connection',(ws:WebSocket)=>{
    let browserId:string|null=null;
    const timeout=setTimeout(()=>ws.close(1008,'Authentication timeout'),5000);
    ws.on('message',raw=>{
      if(stopped)return;
      try {
        const msg=JSON.parse(raw.toString());
        if(!browserId) {
          const hello=z.object({type:z.literal('hello'),token:z.string(),browserId:z.string().uuid(),version:z.string().default('0.1.0')}).parse(msg);
          if(!equal(hello.token,token)) {ws.close(1008,'Unauthorized');return;}
          if(connection && connection.ws!==ws) {ws.close(1008,'Another browser is connected');return;}
          browserId=hello.browserId;clearTimeout(timeout);connection={ws,browserId,lastSeen:Date.now(),version:hello.version};
          ws.send(JSON.stringify({type:'ready'}));schedule();return;
        }
        if(connection?.ws!==ws) return;
        connection.lastSeen=Date.now();
        if(msg.type==='inspection') {
          const control=controls.get(msg.controlId);
          if(control){clearTimeout(control.timer);controls.delete(msg.controlId);control.resolve(msg.result);}
          if(msg.result?.ok && Array.isArray(msg.result.models)){models=msg.result.models;modelsUpdatedAt=Date.now();}
          return;
        }
        if(msg.type==='heartbeat') {ws.send(JSON.stringify({type:'heartbeat'}));return;}
        if(msg.type==='models') {models=z.array(z.object({label:z.string(),available:z.boolean()})).parse(msg.options);modelsUpdatedAt=Date.now();return;}
        if(msg.jobId!==inFlight) return;
        const job=store.job(msg.jobId);
        if(msg.attempt!==job.attempt) return;
        if(msg.type==='progress') {
          store.checkpoint(job.id,checkpointSchema.parse(msg.checkpoint),z.enum(['preparing','dispatching','submitted','streaming']).parse(msg.state));
          ws.send(JSON.stringify({type:'ack',eventId:msg.eventId}));
        } else if(msg.type==='outcome') {
          store.finish(job.id,outcomeSchema.parse(msg.outcome));inFlight=null;
          ws.send(JSON.stringify({type:'ack',eventId:msg.eventId}));schedule();
        }
      } catch(e) {ws.send(JSON.stringify({type:'error',message:e instanceof Error?e.message:'Invalid message'}));}
    });
    ws.on('close',()=>{clearTimeout(timeout);if(connection?.ws===ws){if(inFlight && !stopped){const job=store.job(inFlight);if(isActive(job.state))store.patchJob(inFlight,{state:'reconciling'});}connection=null;inFlight=null;models=[];modelsUpdatedAt=null;for(const p of controls.values()){clearTimeout(p.timer);p.reject(new ApiError('browser_offline','浏览器连接中断',503));}controls.clear();}});
    ws.on('error',()=>{});
  });
  function schedule() {
    if(stopped) return;
    if(inFlight){
      const active=store.job(inFlight);
      if(active.deadline<Date.now()){
        store.finish(active.id,{state:'unknown',error:{code:'deadline_exceeded',message:'任务超过总期限；保留发送记录，可继续恢复原任务或取消等待'}});
        inFlight=null;
      }
      return;
    }
    if(!connection || connection.ws.readyState!==WebSocket.OPEN) return;
    const jobs=store.jobs();
    const recovering=jobs.find(j=>isActive(j.state));
    // Do not overlap another generation with a turn whose outcome is still unknown.
    if(!recovering && jobs.some(j=>['unknown','blocked_login'].includes(j.state))) return;
    const job=recovering || jobs.find(j=>j.state==='queued');
    if(!job) return;
    if(job.deadline<Date.now()) {
      const active=store.patchJob(job.id,{state:'reconciling'});
      store.finish(active.id,{state:job.state==='queued'?'failed':'unknown',error:{code:'deadline_exceeded',message:'任务超过总期限；已发送任务只能恢复查询'}});return;
    }
    const session=store.session(job.sessionId);
    if(session.browserId && session.browserId!==connection.browserId) return;
    const dispatched=store.dispatch(job.id,connection.browserId);inFlight=job.id;
    connection.ws.send(JSON.stringify({type:'run',job:dispatched,session:store.session(job.sessionId),recover:job.state!=='queued'}));
  }
  const interval=setInterval(()=>{
    if(connection && Date.now()-connection.lastSeen>65_000) connection.ws.terminate();
    schedule();
  },1000);
  interval.unref();
  return {server,store, async close(){stopped=true;clearInterval(interval);for(const ws of wss.clients)ws.terminate();await new Promise<void>(r=>server.close(()=>r()));await new Promise<void>(r=>wss.close(()=>r()));}};
}
