import type {Job} from './protocol.js';
export function recoveryAdvice(job:Job){
  if(job.state==='completed' || job.state==='failed')return {action:'none',message:job.state==='completed'?'任务已完成，使用已保存结果。':'任务已停止；先处理 error，再决定下一步。'};
  if(job.state==='blocked_login')return {action:'login_then_resume',job_id:job.id,message:'请恢复原浏览器登录，然后 gemini_job_resume；保留原任务。'};
  if(job.state!=='unknown')return {action:'poll',job_id:job.id,wait_ms:20000,message:'继续查询同一个 job_id；工具超时不会取消任务。'};
  if(job.error?.code==='turn_missing')return {action:'retry_missing',job_id:job.id,requires_duplicate_risk_acknowledgement:true,message:'原对话缺少本轮。若用户已授权刷新重试，可用 gemini_job_retry_missing 重发一次，保存其新的 request_id；否则先说明可能重复消耗额度。'};
  if(['session_conflict','draft_conflict','attachment_conflict','model_mismatch','send_state_unknown'].includes(job.error?.code || ''))return {action:'inspect',job_id:job.id,message:'调用 gemini_job_inspect 检查原页与检查点；不要覆盖其他草稿或改用新会话。'};
  const refresh=!!job.checkpoint && (job.checkpoint.recovery?.refreshes || 0)<2;
  return {action:refresh?'resume_with_refresh':'inspect',job_id:job.id,refresh,message:refresh?'调用 gemini_job_resume(refresh=true)，刷新原页后核对；发送前可重建附件，发送后只读取原轮回复。':'已达到刷新上限或没有检查点。检查错误及原页，报告具体阻塞原因，不要无限轮询或创建重复请求。'};
}
