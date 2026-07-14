export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
  internal?: boolean;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  tools?: ToolDefinition[];
  maxResponseTokens?: number;
  /** Ollama: força o modelo a emitir tool_calls em vez de só texto */
  requireToolCall?: boolean;
  /** Cancela a requisição HTTP em andamento */
  signal?: AbortSignal;
  /** Callback de streaming (deltas de texto) */
  onToken?: (delta: string) => void;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  done: boolean;
  doneReason?: string;
  tokenUsage?: TokenUsage;
}

export interface AIProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  listModels(): Promise<string[]>;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
}

export type PermissionMode = 'manual' | 'smart' | 'auto';

export interface FileChange {
  file: string;
  oldContent: string;
  newContent: string;
}

export interface VersionManifest {
  id: string;
  date: string;
  model: string;
  prompt: string;
  changes: FileChange[];
}

export interface PermissionRequest {
  action: string;
  description: string;
  file?: string;
  details?: string;
  toolName: string;
}

export type ApprovalScope = 'once' | 'session' | 'deny';

export interface PendingChange {
  file: string;
  oldContent: string;
  newContent: string;
  accepted?: boolean;
}

export interface FileChangedData {
  file: string;
  oldContent: string;
  newContent: string;
  versionId?: string | null;
}

export interface AgentEvent {
  type:
    | 'thinking'
    | 'tool_call'
    | 'tool_result'
    | 'permission'
    | 'diff'
    | 'file_changed'
    | 'message'
    | 'error'
    | 'checkpoint'
    | 'done'
    | 'token_usage'
    | 'stream_delta'
    | 'cancelled';
  content: string;
  data?: unknown;
}
