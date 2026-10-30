import { type RunCommand, type Outcome } from '../src/protocol';
type Settings={url:string;token:string;browserId:string;labels:Record<string,string>};
let socket:WebSocket|null=null;
let ready=false,connecting=false;
let reconnectTimer:ReturnType<typeof setTimeout>|undefined;
let heartTimer:ReturnType<typeof setInterval>|undefined;
let failures=0;
const pending=new Map<string,{resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
const commands=new Map<string,RunCommand>();
const running=new Map<string,Promise<void>>();
const cancelled=new Set<string>();
async function settings():Promise<Settings>{
  const values=await chrome.storage.local.get<Partial<Settings>>(['url','token','browserId','labels']);
  if(!values.browserId){values.browserId=crypto.randomUUID();await chrome.storage.local.set({browserId:values.browserId});}
  return {url:values.url || 'http://127.0.0.1:43123',token:values.token || '',browserId:values.browserId!,labels:values.labels || {'3.1 pro':'3.1 Pro','4 argon':'4 Argon'}};
}
async function status(state:string,error=''){await chrome.storage.local.set({connectionState:state,connectionError:error});}
function send(message:unknown){if(!socket || !ready || socket.readyState!==WebSocket.OPEN)throw new Error('本地服务未连接');socket.send(JSON.stringify(message));}
async function acknowledged(message:Record<string,unknown>) {
  const eventId=crypto.randomUUID();
  return new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(eventId);reject(new Error('本地服务确认超时'));},10_000);
    pending.set(eventId,{resolve,reject,timer});
    try{send({...message,eventId});}catch(e){clearTimeout(timer);pending.delete(eventId);reject(e);}
  });
}
function retry(){if(reconnectTimer)return;const delay=Math.random()*Math.min(30000,1000*2**Math.min(failures++,5));reconnectTimer=setTimeout(()=>{reconnectTimer=undefined;void connect();},delay);}
async function connect(){
  if(connecting || socket?.readyState===WebSocket.OPEN || socket?.readyState===WebSocket.CONNECTING)return;
  connecting=true;
  try {
    const config=await settings();if(!config.token){await status('unpaired');return;}
    const parsed=new URL(config.url);if(parsed.protocol!=='http:' || parsed.hostname!=='127.0.0.1' || parsed.pathname!=='/' || parsed.search || parsed.hash || parsed.username || parsed.password)throw new Error('服务地址必须是 http://127.0.0.1:端口');
    await status('connecting');
    const ws=new WebSocket(`${config.url.replace(/\/$/,'').replace('http:','ws:')}/bridge`);socket=ws;
    ws.onopen=()=>ws.send(JSON.stringify({type:'hello',token:config.token,browserId:config.browserId,version:chrome.runtime.getManifest().version}));
    ws.onmessage=event=>{
      const message=JSON.parse(event.data);
      if(message.type==='ready'){
        ready=true;failures=0;void status('connected');
        if(heartTimer)clearInterval(heartTimer);
        heartTimer=setInterval(()=>{try{send({type:'heartbeat'});}catch{}},20000);
      } else if(message.type==='ack'){
        const item=pending.get(message.eventId);if(item){clearTimeout(item.timer);pending.delete(message.eventId);item.resolve();}
      } else if(message.type==='cancelJob'){
        cancelled.add(message.jobId);
        void (async()=>{try{const key=`tab:${message.sessionId}`;const values=await chrome.storage.local.get(key);const tabId=values[key];if(typeof tabId==='number')await chrome.tabs.remove(tabId).catch(()=>{});await chrome.storage.local.remove(key);send({type:'inspection',controlId:message.controlId,result:{ok:true}});}catch(e){send({type:'inspection',controlId:message.controlId,result:{ok:false,error:(e as Error).message}});}})();
      } else if(message.type==='inspectJob'){
        void (async()=>{
          try{const key=`tab:${message.sessionId}`;const values=await chrome.storage.local.get(key);const tabId=values[key];if(typeof tabId!=='number')throw new Error('没有任务标签页');let result;try{result=await chrome.tabs.sendMessage(tabId,{type:'inspectTurn'});}catch{await chrome.scripting.executeScript({target:{tabId},files:['content.js']});result=await chrome.tabs.sendMessage(tabId,{type:'inspectTurn'});}send({type:'inspection',controlId:message.controlId,result});}
          catch(e){send({type:'inspection',controlId:message.controlId,result:{ok:false,error:(e as Error).message}});}
        })();
      } else if(message.type==='reload'){
        if(!running.size)chrome.runtime.reload();
      } else if(message.type==='inspect'){
        void (async()=>{
          try {
            if(running.size)throw new Error('任务正在执行');
            const tab=await chrome.tabs.create({url:'https://gemini.google.com/app',active:false});if(!tab.id)throw new Error('无法创建诊断标签页');
            try {
              let loaded=false;
              for(let i=0;i<40;i++){try{const ping=await chrome.tabs.sendMessage(tab.id,{type:'ping'});if(ping?.ok){loaded=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}
              if(!loaded)throw new Error('诊断页面未就绪');
              const result=await chrome.tabs.sendMessage(tab.id,{type:'inspectControls'});
              send({type:'inspection',controlId:message.controlId,result});
            } finally{await chrome.tabs.remove(tab.id).catch(()=>{});}
          } catch(e){send({type:'inspection',controlId:message.controlId,result:{ok:false,error:(e as Error).message}});}
        })();
      } else if(message.type==='run'){
        const command=message as RunCommand;commands.set(command.job.id,command);
        if(!running.has(command.job.id)){
          const promise=run(command,config).finally(()=>running.delete(command.job.id));running.set(command.job.id,promise);
        }
      } else if(message.type==='error')void status('connected',message.message);
    };
    ws.onclose=event=>{
      if(socket!==ws)return;socket=null;ready=false;
      if(heartTimer)clearInterval(heartTimer);
      for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('本地服务断开'));}pending.clear();
      void status('disconnected',event.reason);
      if(event.code!==1008)retry();
    };
    ws.onerror=()=>ws.close();
  } catch(e){await status('error',(e as Error).message);retry();}
  finally{connecting=false;}
}
async function activateWorkerTab(tabId:number){
  const tab=await chrome.tabs.get(tabId);
  const values=await chrome.storage.local.get<{workerWindowId?:number}>('workerWindowId');
  let worker:chrome.windows.Window|undefined;
  if(values.workerWindowId)try{worker=await chrome.windows.get(values.workerWindowId);}catch{}
  if(!worker?.id){worker=await chrome.windows.create({tabId,focused:false,width:1100,height:850});if(!worker?.id)throw new Error('无法创建执行窗口');await chrome.storage.local.set({workerWindowId:worker.id});}
  else if(tab.windowId!==worker.id)await chrome.tabs.move(tabId,{windowId:worker.id,index:-1});
  if(worker?.id)await chrome.windows.update(worker.id,{state:'normal',focused:true});
  await chrome.tabs.update(tabId,{active:true});
}
async function getTab(command:RunCommand):Promise<number> {
  const key=`tab:${command.session.id}`;
  const old=(await chrome.storage.local.get(key))[key];
  if(typeof old==='number'){
    try {
      const tab=await chrome.tabs.get(old);
      if(tab.url?.startsWith('https://gemini.google.com/')){await activateWorkerTab(old);return old;}
      throw new Error('原任务标签页被导航到其他网站，请返回 Gemini 后恢复任务');
    } catch(e){
      // Only a removed tab can be recreated; a navigated tab may still represent human intervention.
      if((e as Error).message.startsWith('原任务'))throw e;
    }
  }
  if(command.recover && !command.session.conversationUrl)throw new Error('原标签页丢失，且本轮尚无持久化对话地址，无法确认发送状态');
  const tab=await chrome.tabs.create({url:command.session.conversationUrl || 'https://gemini.google.com/app',active:false});
  if(!tab.id)throw new Error('无法创建 Gemini 标签页');
  await chrome.storage.local.set({[key]:tab.id});await activateWorkerTab(tab.id);return tab.id;
}
async function run(command:RunCommand,config:Settings) {
  let outcome:Outcome;
  try {
    await chrome.storage.local.set({activeJob:{id:command.job.id,model:command.session.model,state:command.recover?'恢复查询':'准备发送'}});
    if(cancelled.has(command.job.id))throw new Error('任务已取消');
    const tabId=await getTab(command);
    if(cancelled.has(command.job.id)){await chrome.tabs.remove(tabId).catch(()=>{});throw new Error('任务已取消');}
    let loaded=false;
    for(let i=0;i<80;i++){
      try {const res=await chrome.tabs.sendMessage(tabId,{type:'ping'});if(res?.ok){loaded=true;break;}}catch{if(i===0)await chrome.scripting.executeScript({target:{tabId},files:['content.js']}).catch(()=>{});}
      await new Promise(r=>setTimeout(r,250));
    }
    if(!loaded)throw new Error('Gemini 页面脚本未就绪；若安装插件前已打开此页，请刷新该页');
    if(cancelled.has(command.job.id))throw new Error('任务已取消');
    outcome=await chrome.tabs.sendMessage(tabId,{type:'run',command,target:config.labels[command.session.model] || command.session.model});
    if(!outcome)throw new Error('页面连接中断，结果未知');
  } catch(e){outcome={state:'unknown',error:{code:'page_unavailable',message:(e as Error).message}};}
  const latest=commands.get(command.job.id) || command;
  try{await acknowledged({type:'outcome',jobId:command.job.id,attempt:latest.job.attempt,outcome});}
  catch{socket?.close();}
  await chrome.storage.local.set({activeJob:{id:command.job.id,model:command.session.model,state:'result' in outcome?'completed':outcome.state,error:'error' in outcome?outcome.error.message:''}});
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message.type==='attachmentData'){
    void (async()=>{
      const command=commands.get(message.jobId);
      if(!command || cancelled.has(message.jobId) || !(command.job.attachments || []).some(f=>f.id===message.fileId))throw new Error('附件不属于当前任务');
      const key='tab:'+command.session.id;const values=await chrome.storage.local.get(key);
      if(values[key]!==sender.tab?.id)throw new Error('任务标签页不匹配');
      const config=await settings();
      const response=await fetch(config.url.replace(/\/$/,'')+'/api/files/'+encodeURIComponent(message.fileId)+'/content',{headers:{Authorization:'Bearer '+config.token},signal:AbortSignal.timeout(60000)});
      if(!response.ok)throw new Error('读取本地附件失败');
      const bytes=new Uint8Array(await response.arrayBuffer());let binary='';
      for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      respond({ok:true,base64:btoa(binary)});
    })().catch(e=>respond({ok:false,error:e.message}));return true;
  }
  if(message.type==='progress'){
    // Only content scripts on the assigned tab may report a job checkpoint.
    const command=commands.get(message.jobId);
    if(!command){respond({ok:false});return;}
    chrome.storage.local.get(`tab:${command.session.id}`).then(async values=>{
      if(values[`tab:${command.session.id}`]!==sender.tab?.id)throw new Error('任务标签页不匹配');
      await acknowledged({...message,attempt:command.job.attempt});respond({ok:true});
    }).catch(e=>respond({ok:false,error:e.message}));return true;
  }
  if(sender.tab)return;
  if(message.type==='reconnect'){
    if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=undefined;}
    if(socket){socket.onclose=null;socket.close();socket=null;}ready=false;
    void connect().then(()=>respond({ok:true}));return true;
  }
  if(message.type==='inspectModels'){
    (async()=>{
      if(running.size)throw new Error('任务执行中，请完成后读取模型，避免干扰当前生成');
      const tabs=await chrome.tabs.query({active:true,currentWindow:true});const tab=tabs[0];
      if(!tab?.id || !tab.url?.startsWith('https://gemini.google.com/'))throw new Error('请先切换到主浏览器的 Gemini 标签页');
      const result=await chrome.tabs.sendMessage(tab.id,{type:'models'});
      if(result.ok){try{send({type:'models',options:result.options});}catch{}await chrome.storage.local.set({modelOptions:result.options,inspectedUrl:result.url});}
      respond(result);
    })().catch(e=>respond({ok:false,error:e.message}));return true;
  }
});
chrome.alarms.create('reconnect',{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(()=>void connect());
chrome.runtime.onStartup.addListener(()=>void connect());
chrome.runtime.onInstalled.addListener(()=>void connect());
void connect();
