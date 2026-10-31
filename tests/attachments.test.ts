// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {checkSentAttachments,checkAttachments,waitAttachments,verifyImageSnapshots,assertNoForeignAttachments} from '../extension/attachments';
import type {Attachment} from '../src/protocol';
const text:Attachment={id:'text',name:'brief.txt',mimeType:'text/plain',size:2,sha256:'abc',createdAt:0};
const image:Attachment={...text,id:'image',name:'layout.png',mimeType:'image/png'};
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();document.body.innerHTML='';});
function setup(){
 vi.spyOn(HTMLElement.prototype,'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
 document.body.innerHTML='<input-container><div contenteditable="true" role="textbox"></div><gem-attachment><span class="gem-attachment-text">brief</span><span class="gem-attachment-extension-label">TXT</span></gem-attachment><gem-media-attachment><img alt="attachment" src="blob:https://gemini.google.com/test"></gem-media-attachment><button aria-label="Send"></button></input-container>';
}
it('checks separate image and document cards, exact filenames, and pending indicators',()=>{
 setup();expect(checkAttachments([image,text])).toBe(true);expect(checkAttachments([text])).toBe(false);
 document.querySelector('gem-attachment')!.insertAdjacentHTML('beforeend','<mat-progress-spinner role="progressbar"></mat-progress-spinner>');
 expect(checkAttachments([image,text])).toBe(false);
 document.querySelector('mat-progress-spinner')!.remove();expect(checkAttachments([image,{...text,name:'other.txt'}])).toBe(false);
});
it('waits through an initially blank uploading card and never accepts a missing attachment',async()=>{
 setup();vi.useFakeTimers();document.querySelector('gem-media-attachment')!.remove();
 const card=document.querySelector('gem-attachment')!;card.innerHTML='<mat-progress-spinner role="progressbar"></mat-progress-spinner>';
 const pending=waitAttachments([text],Date.now()+10000);
 await vi.advanceTimersByTimeAsync(900);
 card.innerHTML='<span class="gem-attachment-text">brief</span><span class="gem-attachment-extension-label">TXT</span>';
 await vi.advanceTimersByTimeAsync(3000);await pending;
 card.remove();const missing=expect(waitAttachments([text],Date.now()+1000)).rejects.toMatchObject({code:'attachment_not_ready'});
 await vi.advanceTimersByTimeAsync(1500);await missing;
});
it('rejects a changed image preview before sending',async()=>{
 setup();vi.spyOn(globalThis,'fetch').mockResolvedValue({arrayBuffer:async()=>new TextEncoder().encode('wrong picture').buffer} as Response);
 await expect(verifyImageSnapshots([image])).rejects.toMatchObject({code:'attachment_conflict'});
});

it('reconciles sent image and document previews, rejecting missing or renamed files',()=>{
 document.body.innerHTML='<user-query><user-query-file-preview><img data-test-id="uploaded-img"></user-query-file-preview><user-query-file-preview><div data-test-id="uploaded-file"><button aria-label="brief.txt"></button></div></user-query-file-preview></user-query>';
 const root=document.querySelector('user-query')!;expect(checkSentAttachments([image,text],root)).toBe(true);
 expect(checkSentAttachments([image,{...text,name:'other.txt'}],root)).toBe(false);
 root.querySelector('img')!.remove();expect(checkSentAttachments([image,text],root)).toBe(false);
});

it('recognizes code cards that omit an extension label, rejecting ambiguous basenames',()=>{
 setup();document.querySelector('gem-media-attachment')!.remove();
 document.querySelector('gem-attachment')!.innerHTML='<span class="gem-attachment-text">component</span><img src="https://drive-thirdparty.googleusercontent.com/32/type/text/code">';
 const code={...text,name:'component.html',mimeType:'text/html'};
 expect(checkAttachments([code])).toBe(true);
 expect(checkAttachments([{...code,name:'other.html'}])).toBe(false);
 document.querySelector('input-container')!.append(document.querySelector('gem-attachment')!.cloneNode(true));
 expect(checkAttachments([code,{...code,id:'css',name:'component.css',mimeType:'text/css'}])).toBe(false);
});

it('tracks sequential uploads with identical stems without confusing their source snapshots',async()=>{
 setup();vi.useFakeTimers();document.querySelector('gem-media-attachment')!.remove();document.querySelector('gem-attachment')!.remove();
 const js={...text,id:'js',name:'component.js',mimeType:'text/javascript'},css={...text,id:'css',name:'component.css',mimeType:'text/css'};
 const root=document.querySelector('input-container')!;
 const html='<gem-attachment><span class="gem-attachment-text">component</span><img src="https://drive-thirdparty.googleusercontent.com/32/type/text/code"></gem-attachment>';
 root.insertAdjacentHTML('beforeend',html);
 let waiting=waitAttachments([js],Date.now()+5000,{file:js,before:[]});await vi.advanceTimersByTimeAsync(2500);await waiting;
 const before=Array.from(root.querySelectorAll('gem-attachment'));root.insertAdjacentHTML('beforeend',html);
 waiting=waitAttachments([js,css],Date.now()+5000,{file:css,before});await vi.advanceTimersByTimeAsync(2500);await waiting;
 expect(checkAttachments([js,css])).toBe(true);
 expect(checkAttachments([js,{...css,id:'changed-source'}])).toBe(false);
});

it.each(['current-jo...field.dart','current-jo…field.dart'])('recognizes a newly uploaded long Dart filename shown as %s',async name=>{
 setup();vi.useFakeTimers();
 const root=document.querySelector('input-container')!;
 const before=Array.from(root.querySelectorAll('gem-attachment,gem-media-attachment'));
 const dart={...text,id:'dart',name:'current-job-field.dart.txt'};
 root.insertAdjacentHTML('beforeend',`<gem-attachment><span class="gem-attachment-text">${name}</span><span class="gem-attachment-extension-label">TXT</span><button aria-label="close ${name}"></button></gem-attachment>`);
 expect(checkAttachments([text,image,dart])).toBe(false);
 const waiting=waitAttachments([text,image,dart],Date.now()+5000,{file:dart,before});
 await vi.advanceTimersByTimeAsync(2500);await waiting;
 expect(checkAttachments([text,image,dart])).toBe(true);
 expect(root.querySelectorAll('gem-attachment')[1].getAttribute('data-gemini-bridge-file-id')).toBe(dart.id);
 expect(checkAttachments([text,image,{...dart,id:'different-snapshot'}])).toBe(false);
});

it('does not adopt an existing ambiguous shortened filename without upload evidence',()=>{
 setup();document.querySelector('gem-media-attachment')!.remove();
 document.querySelector('gem-attachment')!.innerHTML='<span class="gem-attachment-text">current-jo...field.dart</span><span class="gem-attachment-extension-label">TXT</span>';
 const dart={...text,name:'current-job-field.dart.txt'};
 expect(checkAttachments([dart])).toBe(false);
 expect(()=>assertNoForeignAttachments([dart])).toThrow('其他附件');
});

it.each([
 ['current-jo...other.dart','TXT',false],
 ['current-jo...field.dart','PDF',false],
 ['...','TXT',false],
 ['current-jo...field.dart','TXT',true],
])('rejects unmatched names, wrong extensions, and replaced prior cards (%s, %s, replaced=%s)',async(name,ext,replace)=>{
 setup();vi.useFakeTimers();document.querySelector('gem-media-attachment')!.remove();
 const root=document.querySelector('input-container')!;const before=Array.from(root.querySelectorAll('gem-attachment'));
 if(replace){before[0].remove();root.append(before[0].cloneNode(true));}
 const dart={...text,id:'dart',name:'current-job-field.dart.txt'};
 root.insertAdjacentHTML('beforeend',`<gem-attachment><span class="gem-attachment-text">${name}</span><span class="gem-attachment-extension-label">${ext}</span></gem-attachment>`);
 const waiting=expect(waitAttachments([text,dart],Date.now()+1000,{file:dart,before})).rejects.toMatchObject({code:'attachment_not_ready'});
 await vi.advanceTimersByTimeAsync(1500);await waiting;
 expect(root.querySelector('[data-gemini-bridge-file-id]')).toBeNull();
});
