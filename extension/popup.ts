interface PopupState {url?:string;token?:string;labels?:Record<string,string>;connectionState?:string;connectionError?:string;activeJob?:{model:string;state:string;id:string;error?:string};modelOptions?:{label:string;available:boolean}[]}
const input=(id:string)=>document.getElementById(id) as HTMLInputElement;
const message=(s:string)=>{document.getElementById('message')!.textContent=s;};
async function render(){
  const values=await chrome.storage.local.get<PopupState>(['connectionState','connectionError','activeJob','modelOptions']);
  const states:Record<string,string>={connected:'已连接本地服务',connecting:'正在连接…',disconnected:'连接中断，等待恢复',unpaired:'尚未配对',error:'连接配置异常'};
  document.getElementById('state')!.textContent=states[values.connectionState || ""] || '尚未连接';
  document.getElementById('dot')!.className=values.connectionState==='connected'?'connected':'';
  document.getElementById('job')!.textContent=values.activeJob?`${values.activeJob.model} · ${values.activeJob.state}\n${values.activeJob.id}\n${values.activeJob.error || ''}`:'尚无任务';
  document.getElementById('models')!.textContent=values.modelOptions?.map((v:{label:string;available:boolean})=>`${v.available?'✓':'—'} ${v.label}`).join('\n') || '尚未读取网页模型';
  if(values.connectionError)message(values.connectionError);
}
void chrome.storage.local.get<PopupState>(['url','token','labels']).then(values=>{
  if(values.url)input('url').value=values.url;if(values.token)input('token').value=values.token;
  if(values.labels){input('pro').value=values.labels['3.1 pro'];input('argon').value=values.labels['4 argon'];}
});
document.getElementById('settings')!.addEventListener('submit',event=>{
  event.preventDefault();
  void (async()=>{
    const url=new URL(input('url').value.trim());
    if(url.protocol!=='http:' || url.hostname!=='127.0.0.1' || url.pathname!=='/' || url.search || url.hash || url.username || url.password)throw new Error('仅支持 http://127.0.0.1:端口');
    const token=input('token').value.trim();if(!token)throw new Error('请填写配对令牌');
    await chrome.storage.local.set({url:url.origin,token,labels:{'3.1 pro':input('pro').value.trim(),'4 argon':input('argon').value.trim()}});
    await chrome.runtime.sendMessage({type:'reconnect'});message('已保存，正在连接本地服务。');
  })().catch(e=>message(e.message));
});
document.getElementById('inspect')!.addEventListener('click',event=>{
  const button=event.target as HTMLButtonElement;button.disabled=true;message('');
  chrome.runtime.sendMessage({type:'inspectModels'}).then(result=>{if(!result.ok)message(result.error);else message(`当前模型：${result.current}`);}).catch(e=>message(e.message)).finally(()=>{button.disabled=false;void render();});
});
chrome.storage.onChanged.addListener(()=>void render());
void render();
