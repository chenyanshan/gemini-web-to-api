import { generationIdleTimeout, type RunCommand, type Checkpoint, type Outcome } from '../src/protocol';
import * as page from './adapter';
import * as uploads from './attachments';
type Ledger={checkpoint:Checkpoint;outcome?:Outcome};
const running=new Map<string,Promise<Outcome>>();
const ledgerKey=(id:string)=>`job:${id}`;
async function readLedger(id:string):Promise<Ledger|undefined>{return (await chrome.storage.local.get<Record<string,Ledger|undefined>>(ledgerKey(id)))[ledgerKey(id)];}
async function saveLedger(id:string,value:Ledger){await chrome.storage.local.set({[ledgerKey(id)]:value});}
async function progress(command:RunCommand,checkpoint:Checkpoint,state:string) {
  checkpoint.updatedAt=Date.now();await saveLedger(command.job.id,{checkpoint});
  // The send intent must be acknowledged by the durable service before clicking Send.
  const response=await chrome.runtime.sendMessage({type:'progress',jobId:command.job.id,attempt:command.job.attempt,checkpoint,state});
  if(!response?.ok)throw new page.PageError('bridge_disconnected','本地服务未确认任务状态，暂停发送或继续等待恢复');
}
function verifyConversation(command:RunCommand,checkpoint?:Checkpoint) {
  const expected=command.session.conversationUrl || checkpoint?.conversationUrl;
  if(expected && page.currentUrl()!==expected)throw new page.PageError('session_conflict','专用标签页已离开原对话，禁止在其他会话发送');
}
export async function execute(command:RunCommand,target:string):Promise<Outcome> {
  let ledger=await readLedger(command.job.id);
  if(ledger?.outcome && 'result' in ledger.outcome)return ledger.outcome;
  let cp=ledger?.checkpoint || command.job.checkpoint || undefined;
  let sendIntent=!!cp && cp.phase!=='preparing';
  try {
    for(let n=0;n<100 && (!page.editor() || !page.currentModel()) && !page.loginRequired();n++)await page.pause(250);
    if(page.loginRequired())throw new page.PageError('login_required','请在此 Chrome 配置文件中登录 Gemini 后恢复原任务');
    verifyConversation(command,cp);
    if(cp){
      const deadline=Math.min(command.job.deadline,Date.now()+15000);
      while((page.userMessages().length<cp.beforeUsers.length || page.replies().length<cp.beforeReplies.length) && Date.now()<deadline)await page.pause(300);
    }
    if(command.recover && !cp)throw new page.PageError('send_state_unknown','恢复任务缺少发送前记录，不能安全重发');
    if(!sendIntent) {
      if(page.generating())throw new page.PageError('session_conflict','页面已有其他生成任务');
      const beforeUsers=page.userMessages(),beforeReplies=page.replies();
      if(cp && (!page.prefixMatches(cp.beforeUsers,beforeUsers) || beforeUsers.length!==cp.beforeUsers.length || !page.prefixMatches(cp.beforeReplies,beforeReplies) || beforeReplies.length!==cp.beforeReplies.length))throw new page.PageError('session_conflict','准备阶段原会话内容发生变化');
      // Compare a persisted baseline for follow-up turns, including human changes between jobs.
      const baselineKey=`baseline:${command.session.id}`;
      const baseline=(await chrome.storage.local.get<Record<string,{users:string[];replies:string[]}|undefined>>(baselineKey))[baselineKey];
      if(baseline && (JSON.stringify(baseline.users)!==JSON.stringify(beforeUsers) || JSON.stringify(baseline.replies)!==JSON.stringify(beforeReplies)))throw new page.PageError('session_conflict','对话历史与上次完成时不一致，可能有手工消息或历史尚未加载');
      cp={recovery:cp?.recovery,upload:cp?.upload,phase:'preparing',beforeUsers,beforeReplies,prompt:command.job.prompt,conversationUrl:page.currentUrl(),modelLabel:cp?.modelLabel || '',thinkingLabel:cp?.thinkingLabel,updatedAt:Date.now()};
      await progress(command,cp,'preparing');
      cp.modelLabel=await page.selectModel(target);
      cp.thinkingLabel=await page.selectThinking(command.session.thinkingLevel);
      await progress(command,cp,'preparing');
      const editor=page.editor();
      const draft=editor instanceof HTMLTextAreaElement?editor.value:editor?.innerText || '';
      // A resumed preparation can retain our unsent draft. Never overwrite unrelated drafts.
      if(page.normalized(draft)!==page.normalized(command.job.prompt))await page.fillPrompt(command.job.prompt);
      const files=command.job.attachments || [];
      if(cp.recovery?.resetUpload){
        // Navigation may restore a draft. Reuse it if present; never append a second
        // copy. An empty composer and unchanged history prove this is safe to rebuild.
        if(!uploads.cards().length)cp.upload=undefined;
        cp.recovery={...cp.recovery,resetUpload:false};
        await progress(command,cp,'preparing');
      }
      const started=cp.upload?.ids || [];
      if(started.some((id,i)=>files[i]?.id!==id))throw new page.PageError('attachment_conflict','附件上传记录与原请求不一致');
      uploads.assertNoForeignAttachments(files.slice(0,started.length));
      if(started.length)await uploads.waitAttachments(files.slice(0,started.length),Math.min(command.job.deadline,Date.now()+30000));
      for(let i=started.length;i<files.length;i++){
        const file=await uploads.attachmentFile(command.job.id,files[i]);
        const input=await uploads.fileInput(files[i]);
        cp.upload={ids:files.slice(0,i+1).map(f=>f.id),state:'uploading'};
        await progress(command,cp,'preparing');
        const before=uploads.cards();
        uploads.attach(input,file);
        await uploads.waitAttachments(files.slice(0,i+1),Math.min(command.job.deadline,Date.now()+120000),{file:files[i],before});
      }
      if(files.length){
        await uploads.verifyImageSnapshots(files);
        cp.upload={ids:files.map(f=>f.id),state:'ready'};await progress(command,cp,'preparing');
        if(!uploads.checkAttachments(files))throw new page.PageError('attachment_not_ready','发送前附件再次校验失败');
      }
      const button=page.sendButton();
      if(!button || button.disabled || button.getAttribute('aria-disabled')==='true')throw new page.PageError('adapter_incompatible','发送按钮不可用，尚未发送');
      verifyConversation(command,cp);
      cp.phase='dispatching';sendIntent=true;
      await progress(command,cp,'dispatching');
      // The durable acknowledgement may take seconds. Recheck the draft immediately
      // before the click so a removed attachment cannot turn this into a text-only send.
      if(files.length)await uploads.verifyImageSnapshots(files);
      const finalButton=page.sendButton();
      const currentEditor=page.editor();
      const finalDraft=currentEditor instanceof HTMLTextAreaElement?currentEditor.value:currentEditor?.innerText || '';
      if(!uploads.checkAttachments(files) || page.normalized(finalDraft)!==page.normalized(command.job.prompt) || !finalButton || finalButton.disabled || finalButton.getAttribute('aria-disabled')==='true')throw new page.PageError('draft_conflict','发送确认期间草稿或附件发生变化，尚未点击发送');
      finalButton.click();
    }
    if(!cp)throw new page.PageError('send_state_unknown','没有可恢复的发送记录');
    let seenUser=false;
    let stableSince=Date.now(),lastText='';
    let streamingReported=false;
    let missingSince=Date.now();
    let attachmentsMissingSince=0;
    let activityAt=Date.now(),lastActivity='';
    while(Date.now()<command.job.deadline) {
      await page.pause(600);
      if(page.loginRequired())throw new page.PageError('login_required','登录已失效，请登录后恢复原任务');
      verifyConversation(command,cp);
      const users=page.userMessages(),replies=page.replies();
      if(!page.prefixMatches(cp.beforeUsers,users) || !page.prefixMatches(cp.beforeReplies,replies))throw new page.PageError('session_conflict','历史消息发生变化或尚未完整加载，请恢复后重新核对');
      if(users.length>cp.beforeUsers.length+1 || replies.length>cp.beforeReplies.length+1)throw new page.PageError('session_conflict','本轮生成期间出现额外消息');
      if(users.length===cp.beforeUsers.length+1) {
        if(page.normalized(users.at(-1)!)!==page.normalized(command.job.prompt))throw new page.PageError('session_conflict','新出现的用户消息与本次提问不符');
        if((command.job.attachments || []).length && !uploads.checkSentAttachments(command.job.attachments!,Array.from(document.querySelectorAll('user-query')).at(-1) || null)){
          if(!attachmentsMissingSince)attachmentsMissingSince=Date.now();
          if(Date.now()-attachmentsMissingSince>15000)throw new page.PageError('attachment_unverified','已发送消息的附件无法完整核对；保留原任务，不会自动重发');
          continue;
        }
        attachmentsMissingSince=0;
        seenUser=true;missingSince=Date.now();
        if(cp.phase!=='submitted' || (!cp.conversationUrl && page.currentUrl())) {
          cp.phase='submitted';cp.conversationUrl=page.currentUrl();await progress(command,cp,'submitted');
        }
      } else if(seenUser || (command.recover && Date.now()-missingSince>15_000)) {
        throw new page.PageError('turn_missing','原对话里未找到本轮提问，可能未持久化。已保留原提问；不会自动重发或切换模型');
      }
      const activity=JSON.stringify([users,replies]);
      if(activity!==lastActivity){lastActivity=activity;activityAt=Date.now();}
      const idleTimeout=generationIdleTimeout(command.session.model,command.session.thinkingLevel);
      if(Date.now()-activityAt>idleTimeout)throw new page.PageError('generation_stalled',`页面超过 ${idleTimeout/1000} 秒没有回复进展，尝试刷新原对话核对`);
      const failure=page.pageFailure();if(failure)throw new page.PageError('generation_failed',failure);
      if(!seenUser)continue;
      const modelLabel=page.currentModel();
      if(!page.matchesCurrentModel(modelLabel,target))throw new page.PageError('model_mismatch',`网页当前模型「${modelLabel}」不符合「${target}」`);
      const elements=page.replyElements();
      const answer=elements.length===cp.beforeReplies.length+1?elements.at(-1):undefined;
      if(!answer)continue;
      const text=page.markdown(answer);
      if(text.trim() && !streamingReported){await progress(command,cp,'streaming');streamingReported=true;}
      if(text!==lastText){lastText=text;stableSince=Date.now();}
      if(text.trim() && !page.generating() && page.completeSignal(answer) && Date.now()-stableSince>=2000) {
        const url=page.currentUrl();if(!url)throw new page.PageError('session_not_saved','回复已出现，但尚未取得可恢复的对话地址');
        cp.conversationUrl=url;
        const outcome:Outcome={result:{text,requestedModel:command.session.model,observedModelLabel:modelLabel,modelVerified:true,requestedThinkingLevel:command.session.thinkingLevel,observedThinkingLabel:cp.thinkingLabel,thinkingVerified:!!cp.thinkingLabel,conversationUrl:url,completedAt:Date.now()},checkpoint:cp};
        await saveLedger(command.job.id,{checkpoint:cp,outcome});
        await chrome.storage.local.set({[`baseline:${command.session.id}`]:{users:page.userMessages(),replies:page.replies()}});
        return outcome;
      }
    }
    throw new page.PageError('generation_timeout','等待超过总期限；请查看检查点和恢复建议，查询原任务，不要另建重复请求');
  } catch(e) {
    const error=e instanceof page.PageError?e:new page.PageError('adapter_error',(e as Error).message);
    const uncertain=sendIntent || command.recover || !!cp?.upload?.ids.length || ['attachment_conflict','session_conflict','draft_conflict'].includes(error.code);
    const outcome:Outcome={error:{code:error.code,message:error.message},state:error.code==='login_required'?'blocked_login':uncertain?'unknown':'failed',checkpoint:cp};
    if(cp)await saveLedger(command.job.id,{checkpoint:cp,outcome});
    return outcome;
  }
}
const messageHandler:Parameters<typeof chrome.runtime.onMessage.addListener>[0]=(message,_sender,respond)=>{
  if(message.type==='inspectTurn'){
    respond({visibility:document.visibilityState,focused:document.hasFocus(),url:page.currentUrl(),model:page.currentModel(),generating:page.generating(),users:page.userMessages(),replies:page.replies(),editor:page.editor()?.outerHTML.slice(0,3000),composerHtml:uploads.composer()?.outerHTML.slice(0,60000),userHtml:Array.from(document.querySelectorAll('user-query')).at(-1)?.outerHTML.slice(0,40000),buttons:Array.from(document.querySelectorAll<HTMLElement>('model-response button, user-query button, button[data-test-id="bard-mode-menu-button"], button[aria-label="发送消息"], button[aria-label="停止回答"]')).filter(e=>e.getClientRects().length>0).map(e=>({label:e.getAttribute('aria-label'),testId:e.getAttribute('data-test-id'),text:e.innerText})),replyHtml:page.replyElements().at(-1)?.outerHTML.slice(0,60000)});return;
  }
  if(message.type==='ping'){respond({ok:true,url:page.currentUrl()});return;}
  if(message.type==='inspectControls'){page.inspectControls(message.selections).then(respond).catch(e=>respond({ok:false,error:e.message,diagnostic:{url:location.href,title:document.title,readyState:document.readyState,pickers:Array.from(document.querySelectorAll('[data-test-id="bard-mode-menu-button"]')).map(e=>({html:e.outerHTML.slice(0,2000),hiddenAncestor:e.closest('[data-visible="false"], [hidden]')?.outerHTML.slice(0,500),rects:e.getClientRects().length}))}}));return true;}
  if(message.type==='models') {page.listModels().then(options=>respond({ok:true,options,current:page.currentModel(),url:page.currentUrl()})).catch(e=>respond({ok:false,error:e.message}));return true;}
  if(message.type==='run') {
    const command:RunCommand=message.command;
    let promise=running.get(command.job.id);
    if(!promise){promise=execute(command,message.target);running.set(command.job.id,promise);void promise.finally(()=>running.delete(command.job.id));}
    promise.then(respond).catch(e=>respond({state:'unknown',error:{code:'adapter_error',message:e.message}}));return true;
  }
};
const bridgeWindow=globalThis as typeof globalThis & {__geminiBridgeHandler?:typeof messageHandler};
if(bridgeWindow.__geminiBridgeHandler)chrome.runtime.onMessage.removeListener(bridgeWindow.__geminiBridgeHandler);
chrome.runtime.onMessage.addListener(messageHandler);
bridgeWindow.__geminiBridgeHandler=messageHandler;
