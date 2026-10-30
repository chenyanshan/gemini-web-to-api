// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {listModels,selectModel,selectThinking,matchesCurrentModel} from '../extension/adapter';
beforeEach(()=>{
 Object.defineProperty(HTMLElement.prototype,'innerText',{configurable:true,get(){return this.textContent;}});
 vi.spyOn(HTMLElement.prototype,'getClientRects').mockImplementation(function(this:HTMLElement){let el:HTMLElement|null=this;while(el){if(el.style.display==='none')return [] as unknown as DOMRectList;el=el.parentElement;}return [{}] as unknown as DOMRectList;});
 document.body.innerHTML='<div data-test-id="bard-mode-menu-button"><button aria-label="打开模式选择器，当前模式为 Pro 中">Pro 中</button></div><gem-menu data-test-id="gem-mode-menu" role="menu" style="display:none"><gem-menu-item role="menuitem" data-mode-id="pro">3.1 Pro 高级推理<mat-icon data-mat-icon-name="check"></mat-icon></gem-menu-item><gem-menu-item role="menuitem" data-mode-id="argon">4 Argon 复杂任务</gem-menu-item><gem-menu-item role="menuitem" value="thinking_level" aria-controls="thinking-menu">思考等级</gem-menu-item><div style="display:none"><gem-menu id="thinking-menu" role="menu"><gem-menu-item role="menuitem" data-level="low">低 快速高效<mat-icon data-mat-icon-name="check"></mat-icon></gem-menu-item><gem-menu-item role="menuitem" data-level="medium">中 深度适中</gem-menu-item><gem-menu-item role="menuitem" data-level="high">高 超级详尽</gem-menu-item></gem-menu></div></gem-menu>';
 const menu=document.querySelector<HTMLElement>('[data-test-id="gem-mode-menu"]')!;
 document.querySelector('[data-test-id="bard-mode-menu-button"]')!.addEventListener('click',()=>{menu.style.display=menu.style.display==='none'?'block':'none';});
 for(const el of document.querySelectorAll('[data-level]'))el.addEventListener('click',()=>{document.querySelector('#thinking-menu mat-icon')?.remove();el.insertAdjacentHTML('beforeend','<mat-icon data-mat-icon-name="check"></mat-icon>');menu.style.display='none';});
});
afterEach(()=>vi.restoreAllMocks());
it('verifies the full selected model even when the header is abbreviated and the wrapper lacks aria-expanded',async()=>{
 expect((await listModels()).map(x=>x.label)).toContain('3.1 Pro 高级推理');
 expect(await selectModel('3.1 Pro')).toBe('3.1 Pro 高级推理');
 expect(matchesCurrentModel('打开模式选择器，当前模式为“Pro 中” Pro 中','3.1 Pro')).toBe(true);
 expect(matchesCurrentModel('Pro 中','4 Argon')).toBe(false);
});
it('selects and rechecks a thinking option in the controlled, initially collapsed submenu',async()=>{
 expect(await selectThinking('medium')).toBe('中 深度适中');
 expect(document.querySelector('[data-level="medium"] [data-mat-icon-name="check"]')).not.toBeNull();
 expect(await selectThinking('high')).toBe('高 超级详尽');
});
