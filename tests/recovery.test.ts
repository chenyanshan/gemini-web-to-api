import {afterEach,it,expect,vi} from 'vitest';
import {runWithRecovery,bounded,type RecoveryDriver} from '../extension/recovery';
import {recoveryAdvice} from '../src/recovery';
import type {Checkpoint,RunCommand,Outcome} from '../src/protocol';
const checkpoint:Checkpoint={phase:'preparing',beforeUsers:[],beforeReplies:[],prompt:'UI',conversationUrl:'https://gemini.google.com/app/test',modelLabel:'Pro',updatedAt:0,upload:{ids:['image'],state:'uploading'}};
function setup(phase:Checkpoint['phase']='preparing'){
 let cp:Checkpoint={...checkpoint,phase};
 const command={recover:false,job:{id:'j',deadline:Date.now()+600000,checkpoint:cp},session:{model:'3.1 pro',conversationUrl:cp.conversationUrl}} as RunCommand;
 const failed:Outcome={state:'unknown',error:{code:'attachment_not_ready',message:'upload stalled'},checkpoint:cp};
 const completed={result:{text:'UI answer'}} as Outcome;
 const order:string[]=[];
 const driver:RecoveryDriver={execute:vi.fn().mockResolvedValueOnce(failed).mockResolvedValue(completed),checkpoint:async()=>cp,persist:vi.fn(async next=>{order.push('persist');cp=next;}),reload:vi.fn(async()=>{order.push('reload');})};
 return {command,driver,order,failed,completed,cp:()=>cp};
}
afterEach(()=>vi.useRealTimers());
it('persists refresh intent, reloads once and rebuilds only an unsent draft on the same job',async()=>{
 const x=setup();expect(await runWithRecovery(x.command,x.driver)).toBe(x.completed);
 expect(x.order).toEqual(['persist','reload']);expect(x.cp().recovery).toEqual({refreshes:1,resetUpload:true});
 expect(x.driver.execute).toHaveBeenLastCalledWith(expect.objectContaining({recover:true,session:x.command.session,job:expect.objectContaining({id:'j'})}));
});
it('refreshes a sent stalled turn for reconciliation without clearing its upload/send record',async()=>{
 const x=setup('submitted');vi.mocked(x.driver.execute).mockReset().mockResolvedValueOnce({...x.failed,error:{code:'generation_stalled',message:'stalled'}} as Outcome).mockResolvedValue(x.completed);
 await runWithRecovery(x.command,x.driver);expect(x.cp().phase).toBe('submitted');expect(x.cp().upload).toEqual(checkpoint.upload);expect(x.cp().recovery?.resetUpload).toBe(false);
});
it('does not refresh repeatedly after failure or a worker restart',async()=>{
 const x=setup();vi.mocked(x.driver.execute).mockReset().mockResolvedValue(x.failed);
 expect(await runWithRecovery(x.command,x.driver)).toBe(x.failed);
 await runWithRecovery(x.command,x.driver);expect(x.driver.reload).toHaveBeenCalledTimes(1);
});
it.each(['session_conflict','draft_conflict','attachment_conflict','turn_missing','login_required','model_unavailable'])('does not refresh or overwrite %s',async code=>{
 const x=setup();vi.mocked(x.driver.execute).mockReset().mockResolvedValue({...x.failed,error:{code,message:code}} as Outcome);
 await runWithRecovery(x.command,x.driver);expect(x.driver.reload).not.toHaveBeenCalled();
});
it('never reloads if the service did not acknowledge its recovery checkpoint',async()=>{
 const x=setup();vi.mocked(x.driver.persist).mockRejectedValue(new Error('offline'));
 await expect(runWithRecovery(x.command,x.driver)).rejects.toThrow('offline');expect(x.driver.reload).not.toHaveBeenCalled();
});
it('supports one explicit refresh after automatic recovery, then enforces a persistent limit',async()=>{
 const x=setup();await runWithRecovery(x.command,x.driver);
 x.command.job.refreshRequested=true;
 await runWithRecovery(x.command,x.driver);expect(x.cp().recovery?.refreshes).toBe(2);
 const outcome=await runWithRecovery(x.command,x.driver);expect('error' in outcome && outcome.error.code).toBe('recovery_exhausted');expect(x.driver.reload).toHaveBeenCalledTimes(2);
});
it('bounds a page message that never returns and clears its timer on success',async()=>{
 vi.useFakeTimers();const promise=expect(bounded(new Promise(()=>{}),1000)).rejects.toThrow('期限');await vi.advanceTimersByTimeAsync(1001);await promise;
 expect(await bounded(Promise.resolve('done'),1000)).toBe('done');expect(vi.getTimerCount()).toBe(0);
});
it('provides actionable bounded recovery instructions for unknown jobs',()=>{
 const x=setup();const job={...x.command.job,state:'unknown',error:{code:'attachment_not_ready',message:'missing'}} as RunCommand['job'];
 expect(recoveryAdvice(job)).toMatchObject({action:'resume_with_refresh',refresh:true});
 expect(recoveryAdvice({...job,checkpoint:{...checkpoint,recovery:{refreshes:2,resetUpload:false}}})).toMatchObject({action:'inspect',refresh:false});
 expect(recoveryAdvice({...job,error:{code:'turn_missing',message:'missing'}}).action).toBe('retry_missing');
});

it('reconciles a rejected page connection using its latest durable checkpoint',async()=>{
 const x=setup('submitted');vi.mocked(x.driver.execute).mockReset().mockRejectedValueOnce(new Error('port closed')).mockResolvedValue(x.completed);
 expect(await runWithRecovery(x.command,x.driver)).toBe(x.completed);expect(x.driver.reload).toHaveBeenCalledTimes(1);expect(x.cp().recovery?.resetUpload).toBe(false);
});
