import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_ATTACHMENTS, type Attachment, type Job, type Session, type Model, type ThinkingLevel, type Outcome, type Checkpoint, isActive, conversationUrl } from './protocol.js';
export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, data TEXT NOT NULL, bytes BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, request_id TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(session_id,request_id));`);
    for (const job of this.jobs()) if (isActive(job.state)) this.patchJob(job.id, { state: 'reconciling' });
  }
  close() { this.db.close(); }
  upload(name:string, mimeType:string, bytes:Buffer):Attachment {
    if (!name || name.length>200 || /[/\\\x00-\x1f\x7f]/.test(name) || name==='.' || name==='..') throw new ApiError('invalid_filename','文件名必须是有效的文件名称，不能包含路径');
    if (!/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(mimeType)) throw new ApiError('invalid_mime','无效的 MIME 类型');
    if (!bytes.length || bytes.length>MAX_FILE_BYTES) throw new ApiError('file_size','单个附件须为 1 字节至 20 MiB',413);
    const sha256=createHash('sha256').update(bytes).digest('hex');
    const id=createHash('sha256').update(JSON.stringify([name,mimeType,sha256])).digest('hex');
    const file:Attachment={id,name,mimeType,size:bytes.length,sha256,createdAt:Date.now()};
    this.db.prepare('INSERT OR IGNORE INTO files VALUES (?,?,?)').run(id,JSON.stringify(file),bytes);
    return this.file(id);
  }
  file(id:string):Attachment {
    const row=this.db.prepare('SELECT data FROM files WHERE id=?').get(id) as {data:string}|undefined;
    if(!row)throw new ApiError('file_not_found','找不到附件快照',404);
    return JSON.parse(row.data);
  }
  fileBytes(id:string):Buffer {
    this.file(id);
    const row=this.db.prepare('SELECT bytes FROM files WHERE id=?').get(id) as {bytes:Uint8Array};
    return Buffer.from(row.bytes);
  }

  sessions(): Session[] { return (this.db.prepare('SELECT data FROM sessions ORDER BY rowid DESC').all() as {data:string}[]).map(r => JSON.parse(r.data)); }
  jobs(): Job[] { return (this.db.prepare('SELECT data FROM jobs ORDER BY rowid').all() as {data:string}[]).map(r => JSON.parse(r.data)); }
  session(id: string): Session {
    const row = this.db.prepare('SELECT data FROM sessions WHERE id=?').get(id) as {data:string}|undefined;
    if (!row) throw new ApiError('session_not_found', '找不到会话', 404);
    return JSON.parse(row.data);
  }
  job(id: string): Job {
    const row = this.db.prepare('SELECT data FROM jobs WHERE id=?').get(id) as {data:string}|undefined;
    if (!row) throw new ApiError('job_not_found', '找不到任务', 404);
    return JSON.parse(row.data);
  }
  saveSession(s: Session) { this.db.prepare('INSERT OR REPLACE INTO sessions VALUES (?,?)').run(s.id, JSON.stringify(s)); return s; }
  patchJob(id: string, changes: Partial<Job>) {
    const job = {...this.job(id), ...changes, updatedAt: Date.now()};
    this.db.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify(job), id); return job;
  }
  createSession(model: Model, label = '', url?: string, thinkingLevel: ThinkingLevel = 'medium') {
    let normalized: string | null = null;
    if (url) { try { normalized = conversationUrl(url); } catch (e) { throw new ApiError('invalid_conversation_url', (e as Error).message); } }
    if (normalized && this.sessions().some(s => s.conversationUrl === normalized)) throw new ApiError('session_exists', '这条网页对话已绑定，请复用已有 session_id', 409);
    return this.saveSession({ id: randomUUID(), label, model, thinkingLevel, conversationUrl: normalized, revision: 0, browserId: null, status: 'ready', createdAt: Date.now() });
  }
  submit(sessionId: string, requestId: string, prompt: string, expectedRevision: number, timeoutMs = 600_000, attachmentIds:string[] = []) {
    const session = this.session(sessionId);
    if(attachmentIds.length>MAX_ATTACHMENTS)throw new ApiError('too_many_files','每轮最多 10 个附件');
    const attachments=attachmentIds.map(id=>this.file(id));
    if(new Set(attachments.map(f=>f.name)).size!==attachments.length)throw new ApiError('duplicate_filename','同一轮附件文件名不能重复');
    if(attachments.reduce((n,f)=>n+f.size,0)>MAX_TOTAL_BYTES)throw new ApiError('files_too_large','每轮附件总计不能超过 40 MiB',413);
    const inputHash = createHash('sha256').update(JSON.stringify({prompt,expectedRevision,model:session.model,thinkingLevel:session.thinkingLevel,timeoutMs,...(attachments.length?{attachmentIds}: {})})).digest('hex');
    const old = this.db.prepare('SELECT data FROM jobs WHERE session_id=? AND request_id=?').get(sessionId, requestId) as {data:string}|undefined;
    if (old) { const job: Job = JSON.parse(old.data); if (job.inputHash !== inputHash) throw new ApiError('idempotency_conflict', '同一个 request_id 已用于不同内容', 409); return job; }
    if (session.status === 'blocked') throw new ApiError('session_blocked', '先恢复原任务；不要为同一问题创建新请求', 409);
    if (session.revision !== expectedRevision) throw new ApiError('revision_conflict', `当前会话 revision 为 ${session.revision}`, 409);
    if (this.jobs().some(j => j.sessionId === sessionId && (j.state === 'queued' || isActive(j.state)))) throw new ApiError('session_busy', '同一会话已有任务；完成后获取新 revision 再提交', 409);
    const now = Date.now();
    const job: Job = { id: randomUUID(), sessionId, requestId, prompt, inputHash, expectedRevision, attachments,
      state:'queued', createdAt:now, updatedAt:now, deadline:now + timeoutMs, attempt:0, checkpoint:null, result:null, error:null };
    this.db.prepare('INSERT INTO jobs VALUES (?,?,?,?)').run(job.id, sessionId, requestId, JSON.stringify(job));
    this.saveSession({...session, status:'busy'}); return job;
  }
  dispatch(id: string, browserId: string) {
    const job = this.job(id); const session = this.session(job.sessionId);
    if (session.browserId && session.browserId !== browserId) throw new ApiError('browser_mismatch', '该会话属于另一个浏览器配置文件', 409);
    if (job.expectedRevision !== session.revision) throw new ApiError('revision_conflict', '会话已变化', 409);
    this.saveSession({...session, browserId, status:'busy'});
    return this.patchJob(id, {state:job.state === 'queued' ? 'preparing' : 'reconciling', attempt:job.attempt+1, error:null});
  }
  checkpoint(id: string, checkpoint: Checkpoint, state: Job['state']) {
    const job = this.job(id); if (!isActive(job.state)) return job;
    if (checkpoint.prompt !== job.prompt) throw new ApiError('checkpoint_conflict','记录的提问与原任务不一致',409);
    const attachmentIds=(job.attachments || []).map(f=>f.id);
    const upload=checkpoint.upload;
    if(upload && (upload.ids.length>attachmentIds.length || upload.ids.some((id,i)=>id!==attachmentIds[i]) || (upload.state==='ready' && upload.ids.length!==attachmentIds.length)))throw new ApiError('checkpoint_conflict','附件上传记录与任务不一致',409);
    if(job.checkpoint?.upload && (!upload || upload.ids.length<job.checkpoint.upload.ids.length))throw new ApiError('checkpoint_conflict','附件上传记录不能回退',409);
    if(attachmentIds.length && checkpoint.phase!=='preparing' && upload?.state!=='ready')throw new ApiError('checkpoint_conflict','附件尚未就绪，禁止发送',409);
    // Never forget a durable send intent, even if an earlier progress event arrives late.
    const rank = {preparing:0, dispatching:1, submitted:2};
    if (job.checkpoint && rank[checkpoint.phase] < rank[job.checkpoint.phase]) return job;
    if (checkpoint.conversationUrl) {
      let url: string;
      try { url = conversationUrl(checkpoint.conversationUrl); } catch { throw new ApiError('invalid_conversation_url','网页返回了无效对话地址'); }
      const s = this.session(job.sessionId);
      if (s.conversationUrl && s.conversationUrl !== url) throw new ApiError('session_conflict','网页切换到了其他对话',409);
      if (this.sessions().some(other => other.id !== s.id && other.conversationUrl === url)) throw new ApiError('session_conflict','对话已绑定其他会话',409);
      this.saveSession({...s, conversationUrl:url});
    }
    return this.patchJob(id, {checkpoint,state});
  }
  finish(id: string, outcome: Outcome) {
    let job = this.job(id);
    if (job.state === 'completed') return job;
    if (!isActive(job.state)) return job;
    if (outcome.checkpoint) job = this.checkpoint(id, outcome.checkpoint, job.state);
    const session = this.session(job.sessionId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if ('result' in outcome) {
        const result = outcome.result;
        let url: string;
        try { url = conversationUrl(result.conversationUrl); } catch { throw new ApiError('session_conflict','回复缺少有效的原对话地址',409); }
        if (!result.text.trim() || !result.modelVerified || !result.thinkingVerified || result.requestedThinkingLevel !== session.thinkingLevel || result.requestedModel !== session.model || (session.conversationUrl && session.conversationUrl !== url)) throw new ApiError('invalid_result','回复、模型或会话校验失败',409);
        if (this.sessions().some(s => s.id !== session.id && s.conversationUrl === url)) throw new ApiError('session_conflict','对话已绑定其他会话',409);
        job = this.patchJob(id, {state:'completed',result,error:null});
        this.saveSession({...session, conversationUrl:url, revision:session.revision+1,status:'ready'});
      } else {
        // A failure after send intent can never release the session for a fresh prompt.
        const uncertain = job.checkpoint && (job.checkpoint.phase !== 'preparing' || !!job.checkpoint.upload?.ids.length);
        const state = uncertain && outcome.state === 'failed' ? 'unknown' : outcome.state;
        job = this.patchJob(id, {state, error:outcome.error});
        this.saveSession({...session,status:state === 'failed' ? 'ready':'blocked'});
      }
      this.db.exec('COMMIT'); return job;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  cancel(id:string){
    const job=this.job(id);
    if(job.state==='completed' || job.error?.code==='cancelled')return job;
    const session=this.session(job.sessionId);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const cancelled=this.patchJob(id,{state:'failed',error:{code:'cancelled',message:'已取消本地等待并关闭专用标签页；已发送内容可能仍被上游处理'}});
      this.saveSession({...session,status:job.state==='queued'?'ready':'blocked'});
      this.db.exec('COMMIT');return cancelled;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  retryMissing(id: string, requestId: string) {
    const old = this.job(id);
    if (old.replacementJobId) {
      const replacement = this.job(old.replacementJobId);
      if (replacement.requestId !== requestId) throw new ApiError('already_retried','本轮已经发起重试，请查询 replacementJobId',409);
      return replacement;
    }
    if (old.state !== 'unknown' || old.error?.code !== 'turn_missing') throw new ApiError('not_missing','只有核对后确认页面缺少本轮消息的任务才支持此操作',409);
    if (old.requestId === requestId) throw new ApiError('invalid_retry_key','显式重试使用新的 request_id；再次调用本操作复用该 ID',409);
    if (this.jobs().some(j => j.sessionId === old.sessionId && j.requestId === requestId)) throw new ApiError('idempotency_conflict','重试 request_id 已被使用',409);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.patchJob(id,{state:'failed',error:{code:'retry_authorized',message:'用户已明确授权重发缺失的一轮；原发送记录已保留'}});
      const session=this.session(old.sessionId);
      this.saveSession({...session,status:'ready'});
      const job=this.submit(old.sessionId,requestId,old.prompt,session.revision,600_000,(old.attachments || []).map(f=>f.id));
      this.patchJob(id,{replacementJobId:job.id});
      this.db.exec('COMMIT');return job;
    } catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  resume(id: string) {
    const job = this.job(id);
    if (!['unknown','blocked_login'].includes(job.state)) throw new ApiError('not_resumable','仅可恢复 unknown 或 blocked_login 任务',409);
    if (this.jobs().some(j => j.id !== id && j.sessionId === job.sessionId && (j.state === 'queued' || isActive(j.state)))) throw new ApiError('session_busy','会话已有其他任务',409);
    this.saveSession({...this.session(job.sessionId),status:'busy'});
    return this.patchJob(id, {state:'reconciling',deadline:Date.now()+600_000,error:null});
  }
}
