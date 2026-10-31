import { conversationUrl, type ModelOption } from '../src/protocol';
export class PageError extends Error {constructor(public code:string,message:string){super(message);}}
export const pause=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
export const normalized=(s:string)=>s.replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
function visible(el:Element) {return !el.closest('[data-visible="false"], [hidden]') && el.getClientRects().length>0 && getComputedStyle(el).visibility!=='hidden';}
function all(selector:string) {return Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(visible);}
function label(el:Element) {return normalized(`${el.getAttribute('aria-label') || ''} ${(el as HTMLElement).innerText || el.textContent || ''}`);}
export function currentUrl() {try{return conversationUrl(location.href);}catch{return null;}}
export function loginRequired() {return all('a,button').some(e=>/^(登录|登入|sign in)$/i.test(normalized(e.innerText || e.textContent || '')));}
export function editor() {
  const candidates=all('[contenteditable="true"][role="textbox"], .ql-editor[contenteditable="true"], textarea[aria-label]');
  return candidates[0] || null;
}
export function generating() {return all('button').some(e=>/停止生成|停止回答|停止回复|stop (generating|response|responding)/i.test(label(e)) || e.getAttribute('data-test-id')==='stop-button');}
function picker() {const el=all('[data-test-id="bard-mode-menu-button"], button[aria-haspopup]').find(e=>e.getAttribute('data-test-id')==='bard-mode-menu-button' || /模式|模型|model|mode selector/i.test(label(e)));return el?.querySelector<HTMLElement>('button') || el || null;}
export function currentModel() {const el=picker();return el?label(el):'';}
export function matchesModel(labelText:string,target:string) {
  const normalize=(v:string)=>v.toLowerCase().replace(/[“”"'()（）,:：]/g,' ').replace(/\s+/g,' ').trim();
  const actual=normalize(labelText),expected=normalize(target);
  return expected.length>0 && (` ${actual} `).includes(` ${expected} `);
}
const optionSelector='[role="menuitem"], [role="menuitemradio"], [role="option"], [role="radio"], button[mat-menu-item]';
function modelMenu(){
  const id=picker()?.getAttribute('aria-controls');const controlled=id?document.getElementById(id):null;
  if(controlled && visible(controlled))return controlled;
  return all('[data-test-id="gem-mode-menu"], [role="menu"], [role="listbox"]').find(e=>e.getAttribute('data-test-id')==='gem-mode-menu' || e.querySelector('[data-mode-id]') || /3\.1\s*pro|4\s*argon/i.test(label(e)));
}
function modelOptions() {const root=modelMenu();return root?Array.from(root.querySelectorAll<HTMLElement>(optionSelector)).filter(e=>visible(e) && e.closest('[role="menu"], [role="listbox"]')===root):[];}
function menuOpen(){return !!modelMenu();}
async function until<T>(read:()=>T|undefined,code:string,message:string):Promise<T>{
  const deadline=Date.now()+4000;
  do {const value=read();if(value!==undefined)return value;await pause(100);}while(Date.now()<deadline);
  throw new PageError(code,message);
}
async function openModelMenu(){
  const button=await until(()=>picker() || undefined,'adapter_incompatible','找不到模型选择器');
  if(!menuOpen())button.click();
  return until(()=>{const items=modelOptions();return items.length?items:undefined;},'adapter_incompatible','模型菜单未就绪');
}
async function closeMenus(){
  for(let i=0;i<2 && menuOpen();i++){
    (document.activeElement || document).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
    await pause(150);
  }
  if(menuOpen())picker()?.click();
  await until(()=>menuOpen()?undefined:true,'adapter_incompatible','模型菜单未关闭');
}
export async function listModels():Promise<ModelOption[]> {
  const alreadyOpen=menuOpen();
  try {
    const options=(await openModelMenu()).filter(e=>e.hasAttribute('data-mode-id') || (!e.closest('[data-visible="false"]') && !/思考等级|thinking level/i.test(label(e)))).map(e=>({label:label(e),available:e.getAttribute('aria-disabled')!=='true' && !(e as HTMLButtonElement).disabled})).filter(o=>o.label);
    if(!options.length)throw new PageError('adapter_incompatible','未识别到模型列表，请反馈网页实际控件');
    return [...new Map(options.map(o=>[o.label,o])).values()];
  } finally {if(!alreadyOpen)await closeMenus();}
}
export function matchesCurrentModel(value:string,target:string){
  if(matchesModel(value,target))return true;
  if(/\d+(?:\.\d+)?\s*(?:pro|argon)/i.test(value))return false;
  const aliases:Record<string,string>={'3.1 pro':'Pro','4 argon':'Argon'};
  const alias=aliases[target.toLowerCase().trim()];return !!alias && matchesModel(value,alias);
}
export async function selectModel(target:string) {
  try {
    const matches=(await openModelMenu()).filter(e=>matchesModel(label(e),target));
    if(matches.length!==1)throw new PageError('model_unavailable',`无法唯一匹配模型「${target}」，请在插件中读取网页模型并设置准确名称`);
    const option=matches[0];
    if(option.getAttribute('aria-disabled')==='true' || (option as HTMLButtonElement).disabled)throw new PageError('model_unavailable',`模型「${target}」当前不可选`);
    if(selected(option))return label(option);
    option.click();await pause(200);
    await openModelMenu();
    const verified=await until(()=>modelOptions().find(e=>matchesModel(label(e),target) && selected(e)),'model_unverified',`已点击模型但无法验证选中项是「${target}」`);
    return label(verified);
  } finally {await closeMenus();}
}
export function extractUserText(el:Element){
  const content=el.querySelector('.query-text, [data-test-id="user-query"]') || el;
  const clone=content.cloneNode(true) as Element;
  clone.querySelectorAll('.cdk-visually-hidden, .screen-reader-user-query-label, [aria-hidden="true"], button').forEach(e=>e.remove());
  const lines=Array.from(clone.querySelectorAll('.query-text-line')).map(e=>e.textContent || '');
  return normalized(lines.length?lines.join('\n'):clone.textContent || '');
}
export function userMessages() {
  const nodes=all('user-query');
  if(nodes.length)return nodes.map(extractUserText);
  return all('[data-test-id="user-query"]').map(extractUserText);
}
export function replyElements() {return all('model-response');}
export function replyText(el:Element) {
  const content=el.querySelector('.markdown, .markdown-main-panel, message-content') || el;
  return normalized((content as HTMLElement).innerText || content.textContent || '');
}
export function replies() {return replyElements().map(replyText);}
export function completeSignal(el:Element) {
  if(el.querySelector('.markdown[aria-busy="true"]'))return false;
  // Require a finished-response action inside this turn, rather than an idle editor alone.
  return Array.from(el.querySelectorAll('button')).some(e=>visible(e) && /复制|copy|重新生成|regenerate|回答不错|good response|bad response|回答不好/i.test(label(e)));
}
export function pageFailure() {
  const alerts=all('[role="alert"], .error-message, [data-test-id="error-message"]').map(label).join('\n');
  return /出错|出了点问题|稍后重试|达到.*上限|something went wrong|try again|limit|unavailable/i.test(alerts)?alerts:'';
}
export async function fillPrompt(prompt:string) {
  const el=editor();if(!el)throw new PageError('adapter_incompatible','找不到 Gemini 输入框');
  const existing=normalized(el instanceof HTMLTextAreaElement?el.value:el.innerText);
  if(existing)throw new PageError('draft_conflict','专用标签页中已有未发送草稿，请先处理草稿');
  el.focus();
  if(el instanceof HTMLTextAreaElement){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,prompt);el.dispatchEvent(new Event('input',{bubbles:true}));}
  else {document.execCommand('insertText',false,prompt);if(normalized(el.innerText)!==normalized(prompt)){el.textContent=prompt;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:prompt}));}}
  await pause(250);
  const inserted=normalized(el instanceof HTMLTextAreaElement?el.value:el.innerText);
  if(inserted!==normalized(prompt))throw new PageError('adapter_incompatible','输入框内容校验失败，尚未发送');
}
export function sendButton() {
  return all('button').find(e=> /^(发送|发送消息|提交|send|send message|submit)$/i.test(normalized(e.getAttribute('aria-label') || '')) || ['send-button','send-message-button'].includes(e.getAttribute('data-test-id') || '')) as HTMLButtonElement|undefined;
}
export function markdown(el:Element):string {
  const root=el.querySelector('.markdown, .markdown-main-panel, message-content') || el;
  function walk(node:Node):string {
    if(node.nodeType===Node.TEXT_NODE)return node.textContent || '';
    if(!(node instanceof Element))return '';
    const tag=node.tagName.toLowerCase();
    if(['button','script','style','mat-icon'].includes(tag) || node.getAttribute('aria-hidden')==='true' || node.classList.contains('code-block-decoration'))return '';
    if(tag==='pre'){const code=node.querySelector('code') || node;const header=node.closest('.formatted-code-block-internal-container')?.querySelector('.code-block-decoration > span')?.textContent?.trim().toLowerCase() || '';const language=(code.className.match(/language-([\w+-]+)/)||[])[1] || (/^[a-z0-9_+#.-]+$/.test(header)?header:'');const value=code.textContent || '';const runs=value.match(/`+/g)||[];const fence='`'.repeat(Math.max(3,...runs.map(s=>s.length+1)));return `\n\n${fence}${language}\n${value.trimEnd()}\n${fence}\n\n`;}
    const inner=Array.from(node.childNodes).map(walk).join('');
    if(tag==='code')return '`'+inner+'`';
    if(tag==='br')return '\n';
    if(/^h[1-6]$/.test(tag))return `\n\n${'#'.repeat(Number(tag[1]))} ${inner}\n\n`;
    if(tag==='strong'||tag==='b')return `**${inner}**`;
    if(tag==='em'||tag==='i')return `*${inner}*`;
    if(tag==='a'){const href=node.getAttribute('href') || '';return /^https?:\/\//.test(href)?`[${inner}](${href})`:inner;}
    if(tag==='li')return `\n- ${inner.trim()}`;
    if(tag==='tr')return inner+'\n';
    if(tag==='td'||tag==='th')return inner+' | ';
    if(['p','section','ul','ol','blockquote','table'].includes(tag))return '\n'+inner+'\n';
    return inner;
  }
  return walk(root).trim();
}
export function prefixMatches(before:string[],after:string[]) {return after.length>=before.length && before.every((text,i)=>text===after[i]);}

const thinkingNames:Record<string,string[]>={low:['低','low'],medium:['中','medium'],high:['高','high']};
function thinkingMatch(value:string,level:string){return (thinkingNames[level] || []).some(name=>normalized(value).toLowerCase()===name || normalized(value).toLowerCase().startsWith(name+' '));}
function selected(option:HTMLElement){
  if(option.getAttribute('aria-checked')==='true' || option.getAttribute('aria-selected')==='true')return true;
  return !!option.querySelector('[data-mat-icon-name="check"], [data-mat-icon-name="check_circle"], .selected-checkmark') || Array.from(option.querySelectorAll('mat-icon')).some(e=>/^(check|done)$/i.test((e.textContent||'').trim()));
}
async function openThinkingOptions(){
  await openModelMenu();
  const thinking=modelOptions().find(e=>e.getAttribute('value')==='thinking_level' || /思考等级|thinking level|reasoning effort/i.test(label(e)));
  if(!thinking)throw new PageError('thinking_unavailable','当前模型没有可识别的思考等级选项');
  const controlled=()=>{
    const id=thinking.getAttribute('aria-controls');const root=id?document.getElementById(id):null;
    return root?Array.from(root.querySelectorAll<HTMLElement>(optionSelector)).filter(visible):[];
  };
  if(controlled().length)return controlled();
  thinking.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}));
  if(typeof PointerEvent!=='undefined')thinking.dispatchEvent(new PointerEvent('pointerenter',{bubbles:false,pointerType:'mouse'}));
  await pause(150);
  if(!controlled().length)thinking.click();
  return until(()=>{const items=controlled();return items.length?items:undefined;},'thinking_unavailable','思考等级子菜单未展开');
}
export async function selectThinking(level:string){
  try {
    const items=await openThinkingOptions();const options=items.filter(e=>thinkingMatch(label(e),level));
    if(options.length!==1)throw new PageError('thinking_unavailable',`无法唯一匹配思考等级 ${level}`);
    const option=options[0];
    if(option.getAttribute('aria-disabled')==='true' || (option as HTMLButtonElement).disabled)throw new PageError('thinking_unavailable',`当前模型不能选择 ${level}`);
    if(selected(option))return label(option);
    option.click();await pause(200);
    // Reopen the controls and inspect the selected marker, rather than trusting a click.
    await openThinkingOptions();
    const checked=await until(()=>Array.from(document.querySelectorAll<HTMLElement>(optionSelector)).find(e=>visible(e) && thinkingMatch(label(e),level) && selected(e)),'thinking_unverified',`已选择 ${level}，但尚不能确认网页选中状态`);
    return label(checked);
  } finally {
    await closeMenus();
  }
}
export async function inspectControls(selections:{model:string;thinkingLevel:string}[]=[]){
  const readyDeadline=Date.now()+18000;
  while(!picker() && !loginRequired() && Date.now()<readyDeadline)await pause(300);
  if(loginRequired())throw new PageError('login_required','诊断标签页尚未登录 Gemini');
  if(generating())throw new PageError('browser_busy','网页正在生成，请完成后检查控件');
  const models=await listModels();let thinking:unknown[]=[];let thinkingError='';let modelHtml='';let thinkingHtml='';
  const overlay=()=>Array.from(document.querySelectorAll('.cdk-overlay-container, [role="menu"], [role="listbox"], [role="dialog"]')).map(e=>e.outerHTML).join('\n').slice(0,60000);
  try {
    await openModelMenu();
    modelHtml=overlay();
    try {thinking=(await openThinkingOptions()).map(e=>({label:label(e),checked:selected(e),html:e.outerHTML.slice(0,6000)}));}catch(e){thinkingError=(e as Error).message;}
    thinkingHtml=overlay();
  } finally {await closeMenus();}
  const checks:unknown[]=[];let restoreError='';
  if(selections.length){
    let originalModel='';let originalThinking='';
    try {
      originalModel=label((await openModelMenu()).find(selected)!);
      const option=(await openThinkingOptions()).find(selected);
      originalThinking=Object.keys(thinkingNames).find(level=>option && thinkingMatch(label(option),level)) || '';
      await closeMenus();
      for(const selection of selections){
        try {const modelLabel=await selectModel(selection.model);const thinkingLabel=await selectThinking(selection.thinkingLevel);checks.push({...selection,ok:true,modelLabel,thinkingLabel,header:currentModel()});}
        catch(e){checks.push({...selection,ok:false,error:(e as Error).message});}
      }
    } finally {
      try{
        if(originalModel)await selectModel(models.find(m=>m.label===originalModel)?.label || originalModel);
        if(originalThinking)await selectThinking(originalThinking);
        await closeMenus();
      }catch(e){restoreError=(e as Error).message;}
    }
  }
  const composerHtml=editor()?.closest('input-container')?.outerHTML || editor()?.parentElement?.parentElement?.outerHTML;
  const uploadButton=all('button').find(e=>/上传和工具|上传文件|添加文件|upload files|add files|uploads and tools/i.test(label(e)));
  uploadButton?.click();await pause(300);
  const uploadHtml=overlay() + (document.querySelector('simplified-input-menu')?.outerHTML || '');
  return {ok:!restoreError,restoreError,checks,models,currentModel:currentModel(),thinking,thinkingError,modelHtml,thinkingHtml,composerHtml,uploadHtml,fileInputs:Array.from(document.querySelectorAll('input[type=file]')).map(e=>e.outerHTML)};
}
