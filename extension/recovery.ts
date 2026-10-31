import type {Checkpoint,Outcome,RunCommand} from '../src/protocol';

const transient=new Set(['attachment_not_ready','attachment_upload_failed','attachment_unverified','adapter_incompatible','model_unverified','thinking_unverified','generation_failed','generation_stalled','page_unavailable']);
export interface RecoveryDriver {
  execute(command:RunCommand):Promise<Outcome>;
  checkpoint():Promise<Checkpoint|undefined>;
  persist(checkpoint:Checkpoint):Promise<void>;
  reload():Promise<void>;
}
// Persist a recovery intent before navigation. A restarted worker can safely finish
// the same reload; only content.ts may reset uploads, after checking the fresh page.
export async function runWithRecovery(command:RunCommand,driver:RecoveryDriver):Promise<Outcome> {
  let current=command;
  const refresh=async(cp:Checkpoint):Promise<void>=>{
    const next:Checkpoint={...cp,recovery:{refreshes:(cp.recovery?.refreshes || 0)+1,resetUpload:cp.phase==='preparing'},updatedAt:Date.now()};
    await driver.persist(next);
    await driver.reload();
    current={...command,recover:true,job:{...command.job,checkpoint:next,refreshRequested:false}};
  };
  if(command.job.refreshRequested){
    const cp=await driver.checkpoint();
    if(!cp)return {state:'unknown',error:{code:'send_state_unknown',message:'缺少检查点，无法安全刷新原任务'}};
    if((cp.recovery?.refreshes || 0)>=2)return {state:'unknown',checkpoint:cp,error:{code:'recovery_exhausted',message:'已达到两次刷新上限，请检查错误原因'}};
    await refresh(cp);
  }
  const execute=async()=>{
    try{return await driver.execute(current);}
    catch(e){return {state:'unknown' as const,checkpoint:await driver.checkpoint(),error:{code:'page_unavailable',message:(e as Error).message}};}
  };
  let outcome=await execute();
  if('result' in outcome || !transient.has(outcome.error.code))return outcome;
  const cp=await driver.checkpoint() || outcome.checkpoint;
  // One automatic refresh per job, retained across process restarts. Never change
  // the requested model or session, and reserve enough time to reconcile afterward.
  if(!cp || (cp.recovery?.refreshes || 0)>=1 || command.job.deadline-Date.now()<20000)return outcome;
  if(cp.phase!=='preparing' && !(cp.conversationUrl || command.session.conversationUrl))return outcome;
  await refresh(cp);
  outcome=await execute();
  return outcome;
}

export async function bounded<T>(operation:Promise<T>,ms:number):Promise<T>{
  let timer:ReturnType<typeof setTimeout>;
  try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('页面操作超过期限；请查询原任务并恢复核对')),Math.max(1,ms));})]);}
  finally{clearTimeout(timer!);}
}
