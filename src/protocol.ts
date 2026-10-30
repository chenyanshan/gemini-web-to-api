export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
export interface Attachment { id:string; name:string; mimeType:string; size:number; sha256:string; createdAt:number }
export const MODELS = ['3.1 pro', '4 argon'] as const;
export type Model = typeof MODELS[number];
export const THINKING_LEVELS = ['low', 'medium', 'high'] as const;
export type ThinkingLevel = typeof THINKING_LEVELS[number];
export type JobState = 'queued' | 'preparing' | 'dispatching' | 'submitted' | 'streaming' | 'reconciling' | 'completed' | 'failed' | 'unknown' | 'blocked_login';
export interface BridgeError { code: string; message: string }
export interface Session {
  id: string; label: string; model: Model; thinkingLevel: ThinkingLevel; conversationUrl: string | null;
  revision: number; browserId: string | null; status: 'ready' | 'busy' | 'blocked'; createdAt: number;
}
export interface Checkpoint {
  phase: 'preparing' | 'dispatching' | 'submitted';
  upload?: { ids:string[]; state:'uploading'|'ready' };
  beforeUsers: string[]; beforeReplies: string[]; prompt: string;
  conversationUrl: string | null; modelLabel: string; thinkingLabel?: string; updatedAt: number;
}
export interface Result {
  text: string; requestedModel: Model; observedModelLabel: string;
  modelVerified: boolean; requestedThinkingLevel?: ThinkingLevel; observedThinkingLabel?: string; thinkingVerified?: boolean; conversationUrl: string; completedAt: number;
}
export interface Job {
  id: string; sessionId: string; requestId: string; inputHash: string; prompt: string;
  attachments?: Attachment[];
  expectedRevision: number; state: JobState; createdAt: number; updatedAt: number;
  deadline: number; attempt: number; checkpoint: Checkpoint | null;
  result: Result | null; error: BridgeError | null; replacementJobId?: string;
}
export interface RunCommand { type: 'run'; job: Job; session: Session; recover: boolean }
export type Outcome = { result: Result; checkpoint?: Checkpoint } | { error: BridgeError; state: 'failed' | 'unknown' | 'blocked_login'; checkpoint?: Checkpoint };
export interface ModelOption { label: string; available: boolean }
export const isActive = (state: JobState) => ['preparing', 'dispatching', 'submitted', 'streaming', 'reconciling'].includes(state);
export function conversationUrl(raw: string): string {
  const url = new URL(raw);
  if (url.origin !== 'https://gemini.google.com' || !/^\/app\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)) throw new Error('需要 https://gemini.google.com/app/<对话ID> 格式的对话地址');
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
}
