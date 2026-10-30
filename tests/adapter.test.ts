// @vitest-environment jsdom
import { describe,it,expect } from 'vitest';
import { markdown,matchesModel,prefixMatches,extractUserText } from '../extension/adapter';
describe('page parsing safeguards',()=>{
 it('reads the language from Gemini code-block decorations without leaking the decoration into the answer',()=>{
  const el=document.createElement('model-response');el.innerHTML='<div class="markdown"><p>UI-BRIDGE-73K</p><div class="formatted-code-block-internal-container"><div><div class="code-block-decoration"><span>CSS</span><button>复制代码</button></div><pre><code data-test-id="code-content">padding: 8px 24px;\n</code></pre></div></div></div>';
  const text=markdown(el);expect(text).toContain('```css\npadding: 8px 24px;\n```');expect(text).not.toContain('CSS');expect(text).not.toContain('复制代码');
 });
 it('excludes duplicated screen-reader prompt text from user turns',()=>{
  const el=document.createElement('user-query');el.innerHTML='<div class="query-text"><h5 class="cdk-visually-hidden screen-reader-user-query-label">你说 First line Second line</h5><p class="query-text-line">First line</p><p class="query-text-line">Second line</p></div>';
  expect(extractUserText(el)).toBe('First line Second line');
 });
 it('preserves code fences and whitespace, excluding copy controls',()=>{
  const el=document.createElement('model-response');el.innerHTML='<div class="markdown"><p>Example:</p><pre><code class="language-ts">const x = 1;\n  const y = 2;</code><button>Copy</button></pre><p>Done.</p></div>';
  const text=markdown(el);expect(text).toContain('```ts\nconst x = 1;\n  const y = 2;\n```');expect(text).not.toContain('Copy');expect(text).toContain('Done.');
 });
 it('does not confuse model versions or accept an empty target',()=>{
  expect(matchesModel('打开模式选择器，当前模式为“4 Argon”','4 Argon')).toBe(true);
  expect(matchesModel('3.1 Pro','4 Argon')).toBe(false);expect(matchesModel('14 Argon','4 Argon')).toBe(false);expect(matchesModel('3.1 Pro','')).toBe(false);
 });
 it('detects changed or missing history instead of matching only the last prompt',()=>{
  expect(prefixMatches(['first'],['first','next'])).toBe(true);expect(prefixMatches(['first'],['different','next'])).toBe(false);expect(prefixMatches(['first'],[])).toBe(false);
 });
});
