import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import {readAttachment} from './files.js';
import { config } from './config.js';
import { MAX_ATTACHMENTS, MAX_TOTAL_BYTES, MODELS, THINKING_LEVELS } from './protocol.js';
const settings=config();
const server=new McpServer({name:'gemini-web',version:JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version},{instructions:'Gemini is an auxiliary advisor through a real browser. Only call Gemini for UI and frontend design questions. Do not call it for backend, API, or general debugging work. Within UI/frontend design use 3.1 pro by default. Use 4 argon selectively for complex visual design or substantial UI refinement; its quota is small and it can stall. Never silently fall back or resend a stalled turn. Create a session or attach an existing Gemini conversation URL; reuse its session_id for follow-ups. Set thinking_level to low, medium (default), or high when creating a session. Include needed code/context explicitly. For UI reference screenshots, design briefs or source files, stage explicitly selected absolute file paths with gemini_files_upload, then pass returned IDs as attachment_ids to gemini_submit. Upload only files needed for the UI task. Staging saves immutable local snapshots; only submit sends them to Gemini. Reuse IDs on retries. Each turn supports up to 10 files, 20 MiB each and 40 MiB total; website format limits still apply. Save a unique request_id BEFORE submitting; retries MUST reuse it and the identical payload. Save job_id, then poll gemini_job_get. A tool timeout does not cancel the job. Never resubmit unknown outcomes with a new ID: use gemini_job_resume to reconcile. Refresh session revision before a new turn. Verify Gemini suggestions before applying code.'});
async function call(path:string,method='GET',body?:unknown) {
  try {
    const response=await fetch(`${settings.url}${path}`,{method,headers:{Authorization:`Bearer ${settings.token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25_000)});
    const data=await response.json();
    return {content:[{type:'text' as const,text:JSON.stringify(data,null,2)}],isError:!response.ok};
  } catch(e) {return {content:[{type:'text' as const,text:JSON.stringify({error:{code:'bridge_unavailable',message:`本地服务未连接或等待超时。先运行 npm start；已提交任务继续查询，不要重新提问。${(e as Error).message}`}})}],isError:true};}
}
server.registerTool('gemini_status',{description:'查看本地服务、浏览器连接与阻塞任务状态',inputSchema:{}},()=>call('/api/health'));
server.registerTool('gemini_models_list',{description:'查看用户配置的模型和插件最近从网页读取的可用模型；verified=false 表示尚未读取',inputSchema:{}},()=>call('/api/models'));
server.registerTool('gemini_sessions_list',{description:'列出已保存的会话，继续原会话前可查找 session_id',inputSchema:{}},()=>call('/api/sessions'));
server.registerTool('gemini_session_create',{description:'创建新会话，或传 conversation_url 绑定已有 Gemini 网页对话。模型固定为 3.1 pro 或 4 argon。',inputSchema:{model:z.enum(MODELS).default('3.1 pro'),thinking_level:z.enum(THINKING_LEVELS).default('medium'),label:z.string().optional(),conversation_url:z.string().optional()}},args=>call('/api/sessions','POST',args));
server.registerTool('gemini_session_get',{description:'读取会话当前 revision、模型和原对话地址',inputSchema:{session_id:z.string()}},args=>call(`/api/sessions/${encodeURIComponent(args.session_id)}`));
server.registerTool('gemini_files_upload',{description:'暂存本地参考图片或文件，返回 attachment_ids。只读取明确选择的文件；提交提问时才上传到 Gemini。相同文件去重。',inputSchema:{paths:z.array(z.string()).min(1).max(MAX_ATTACHMENTS)}},async({paths})=>{
  const files:unknown[]=[];
  try {
    let total=0;const names=new Set<string>();
    for(const path of paths){
      const file=await readAttachment(path);total+=file.bytes.length;
      if(total>MAX_TOTAL_BYTES)throw new Error('每轮附件总计不能超过 40 MiB');
      if(names.has(file.name))throw new Error('同一轮文件名不能重复');names.add(file.name);
      const response=await fetch(settings.url+'/api/files',{method:'POST',headers:{Authorization:'Bearer '+settings.token,'X-File-Name':encodeURIComponent(file.name),'Content-Type':file.mimeType},body:new Uint8Array(file.bytes),signal:AbortSignal.timeout(60000)});
      const data=await response.json();if(!response.ok)throw new Error(data.error?.message || '附件暂存失败');files.push(data);
    }
    return {content:[{type:'text' as const,text:JSON.stringify({files,attachment_ids:files.map(f=>(f as {id:string}).id)})}]};
  } catch(e){return {isError:true,content:[{type:'text' as const,text:JSON.stringify({error:{code:'file_upload_failed',message:(e as Error).message},staged:files})}]};}
});
server.registerTool('gemini_submit',{description:'提交一次提问并立即返回 job_id。相同逻辑请求重试必须复用 request_id 和完全相同的参数。',inputSchema:{session_id:z.string(),request_id:z.string(),prompt:z.string(),expected_revision:z.number().int().min(0),attachment_ids:z.array(z.string()).max(MAX_ATTACHMENTS).optional(),timeout_ms:z.number().int().min(10000).max(1800000).optional()}},({session_id,...args})=>call(`/api/sessions/${encodeURIComponent(session_id)}/jobs`,'POST',args));
server.registerTool('gemini_job_get',{description:'查询任务或等待最多 20 秒。completed 才是完整结果；等待状态继续查同一 job_id。',inputSchema:{job_id:z.string(),wait_ms:z.number().int().min(0).max(20000).default(20000)}},args=>call(`/api/jobs/${encodeURIComponent(args.job_id)}?wait_ms=${args.wait_ms}`));
server.registerTool('gemini_job_resume',{description:'人工登录或连接恢复后，对 unknown/blocked_login 原任务进行对账。此操作不授权重复发送已提交消息。',inputSchema:{job_id:z.string()}},args=>call(`/api/jobs/${encodeURIComponent(args.job_id)}/resume`,'POST',{}));
server.registerTool('gemini_job_cancel',{description:'放弃当前任务并关闭它的专用标签页，释放全局队列。已经发送的内容可能仍由上游处理；原会话暂停，后续请新建会话。',inputSchema:{job_id:z.string()}},args=>call(`/api/jobs/${encodeURIComponent(args.job_id)}/cancel`,'POST',{}));
server.registerTool('gemini_job_retry_missing',{description:'仅当原任务错误为 turn_missing 且用户明确同意重新发送时使用。网页消息缺失不能证明远端从未接受；可能再次消耗额度。保留原发送记录，为同一提问创建替代任务。重复调用必须复用本操作的 request_id。',inputSchema:{job_id:z.string(),request_id:z.string(),acknowledge_duplicate_risk:z.literal(true)}},({job_id,...args})=>call(`/api/jobs/${encodeURIComponent(job_id)}/retry-missing`,'POST',args));
await server.connect(new StdioServerTransport());
