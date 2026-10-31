import type {Attachment} from '../src/protocol';
import {editor,pause,PageError,sendButton,pageFailure,normalized} from './adapter';

export const composer=()=>editor()?.closest('input-container') || editor()?.closest('form');
export function cards(root:ParentNode|null=composer()):Element[] {
  return root?Array.from(root.querySelectorAll('gem-attachment, gem-media-attachment')):[];
}
function displayedNameMatches(text:string,name:string,allowTruncated:boolean) {
  if(text===name)return true;
  if(!allowTruncated)return false;
  const parts=text.split(/\.\.\.|…/);
  return parts.length===2 && parts.every(Boolean) && name.length>parts[0].length+parts[1].length && name.startsWith(parts[0]) && name.endsWith(parts[1]);
}
function matches(card:Element,file:Attachment,allowTruncated=false) {
  const tracked=card.getAttribute('data-gemini-bridge-file-id');
  if(tracked)return tracked===file.id;
  if(card.tagName.toLowerCase()==='gem-media-attachment')return file.mimeType.startsWith('image/') && !!card.querySelector('img');
  const text=normalized(card.querySelector('.gem-attachment-text')?.textContent || '');
  const ext=normalized(card.querySelector('.gem-attachment-extension-label')?.textContent || '').toLowerCase();
  const dot=file.name.lastIndexOf('.');
  return displayedNameMatches(text,file.name,allowTruncated) || (dot>0 && displayedNameMatches(text,file.name.slice(0,dot),allowTruncated) && (ext===file.name.slice(dot+1).toLowerCase() || (!ext && !!card.querySelector('img[src*="/type/text/code"]')))) ||
    Array.from(card.querySelectorAll('img')).some(img=>img.getAttribute('alt')===file.name);
}
export function checkAttachments(files:Attachment[],root:ParentNode|null=composer(),requireReady=true) {
  const actual=cards(root);
  const images=files.filter(f=>f.mimeType.startsWith('image/'));
  if(actual.length!==files.length || actual.filter(c=>c.tagName.toLowerCase()==='gem-media-attachment').length!==images.length || files.filter(f=>!f.mimeType.startsWith('image/')).some(f=>actual.filter(c=>matches(c,f)).length!==1))return false;
  if(actual.some(c=>c.tagName.toLowerCase()!=='gem-media-attachment' && files.filter(f=>matches(c,f)).length!==1))return false;
  if(!requireReady)return true;
  return actual.every(c=>!c.querySelector('[role="progressbar"], mat-spinner, mat-progress-spinner, [aria-busy="true"], .upload-error, .error') &&
    !/上传失败|无法上传|不支持|upload failed|unsupported|could not upload/i.test(c.textContent || ''));
}
export function assertNoForeignAttachments(files:Attachment[]) {
  if(cards().some(c=>!files.some(f=>matches(c,f))))throw new PageError('attachment_conflict','输入区有其他附件，停止发送以免混入无关文件');
}
export async function waitAttachments(files:Attachment[],deadline:number,pending?:{file:Attachment;before:Element[]}) {
  let stable=0;
  while(Date.now()<deadline){
    const failure=pageFailure();
    if(failure)throw new PageError('attachment_upload_failed',failure);
    if(cards().some(c=>c.querySelector('.upload-error, .error') || /上传失败|无法上传|不支持|upload failed|unsupported|could not upload/i.test(c.textContent || '')))throw new PageError('attachment_upload_failed','附件上传失败，尝试刷新原页后重新准备');
    if(cards().length>files.length)throw new PageError('attachment_conflict','输入区出现额外附件，停止发送');
    if(pending){
      const actual=cards();
      const added=actual.filter(c=>!pending.before.includes(c));
      // Gemini shortens long filenames in the DOM, including the close label.
      // Only bind a shortened name to the single new card from our own upload;
      // never use a fuzzy name to adopt an existing or restored draft attachment.
      if(added.length===1 && pending.before.every(c=>actual.includes(c)) && matches(added[0],pending.file,true))added[0].setAttribute('data-gemini-bridge-file-id',pending.file.id);
    }
    const button=sendButton();
    if(checkAttachments(files) && button && !button.disabled && button.getAttribute('aria-disabled')!=='true'){
      if(!stable)stable=Date.now();
      if(Date.now()-stable>=2000)return;
    }else stable=0;
    await pause(300);
  }
  throw new PageError('attachment_not_ready','附件缺失或上传尚未完成；未发送文字，可刷新原页后核对并重新准备附件');
}
export async function verifyImageSnapshots(files:Attachment[]) {
  const images=files.filter(f=>f.mimeType.startsWith('image/'));
  const previews=cards().filter(c=>c.tagName.toLowerCase()==='gem-media-attachment');
  if(images.length!==previews.length)throw new PageError('attachment_conflict','图片数量与原请求不一致');
  for(let i=0;i<images.length;i++){
    const src=previews[i].querySelector('img')?.getAttribute('src') || '';
    if(!src.startsWith('blob:https://gemini.google.com/'))throw new PageError('attachment_unverified','无法核对图片预览原始数据');
    const response=await fetch(src,{signal:AbortSignal.timeout(15000)});const bytes=await response.arrayBuffer();
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
    if(hash!==images[i].sha256)throw new PageError('attachment_conflict','图片预览与附件快照不一致');
  }
}
export async function fileInput(file:Attachment) {
  const inputs=()=>Array.from(document.querySelectorAll<HTMLInputElement>('input[type=file]'));
  const accepts=(e:HTMLInputElement)=>e.accept.split(',').some(raw=>{
    const a=raw.trim().toLowerCase();
    return a===file.mimeType.toLowerCase() || (a.endsWith('/*') && file.mimeType.startsWith(a.slice(0,-1))) || (a.startsWith('.') && file.name.toLowerCase().endsWith(a));
  });
  let input=inputs().find(accepts);
  if(!input){
    const button=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(e=>/上传和工具|uploads and tools|add files/i.test(e.getAttribute('aria-label') || ''));
    if(!button)throw new PageError('adapter_incompatible','找不到上传入口');
    button.click();await pause(350);input=inputs().find(accepts);
  }
  if(!input)throw new PageError('attachment_unsupported','网页上传入口不接受附件格式：'+file.name);
  return input;
}
export async function attachmentFile(jobId:string,file:Attachment) {
  const response=await chrome.runtime.sendMessage({type:'attachmentData',jobId,fileId:file.id});
  if(!response?.ok)throw new PageError('attachment_read_failed',response?.error || '读取附件失败');
  const bytes=Uint8Array.from(atob(response.base64),c=>c.charCodeAt(0));
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
  if(bytes.length!==file.size || hash!==file.sha256)throw new PageError('attachment_corrupt','附件大小或 SHA-256 校验失败');
  return new File([bytes],file.name,{type:file.mimeType});
}
export function attach(input:HTMLInputElement,file:File) {
  if(!input.isConnected)throw new PageError('adapter_incompatible','上传控件已变化，请恢复原任务检查');
  const transfer=new DataTransfer();transfer.items.add(file);
  input.value='';
  input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
}

// Sent turns use a different component from the draft composer. Gemini may serve
// resized images here, so reconcile image count and document names, never reupload.
export function checkSentAttachments(files:Attachment[],root:ParentNode|null) {
  if(!root)return false;
  const previews=Array.from(root.querySelectorAll('user-query-file-preview'));
  if(previews.length!==files.length)return false;
  const imageCount=previews.filter(e=>e.querySelector('img[data-test-id="uploaded-img"]')).length;
  return imageCount===files.filter(f=>f.mimeType.startsWith('image/')).length &&
    files.filter(f=>!f.mimeType.startsWith('image/')).every(f=>previews.filter(e=>Array.from(e.querySelectorAll('[data-test-id="uploaded-file"] button[aria-label]')).some(b=>b.getAttribute('aria-label')===f.name)).length===1);
}
