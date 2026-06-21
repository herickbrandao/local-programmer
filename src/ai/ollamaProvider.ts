import * as http from 'http';
import * as https from 'https';
import { getExtensionSettings } from '../config/settings';
import {
  extractToolCallsFromContent,
  parseToolArguments,
  toToolCalls,
} from './toolCallParser';
import { AIProvider, ChatMessage, ChatOptions, ChatResponse, ToolCall } from './types';

interface OllamaMessage {
  role: string;
  content: string;
}

interface OllamaChatResponse {
  message: {
    role: string;
    content: string;
    tool_calls?: Array<{
      function: {
        name: string;
        arguments?: Record<string, unknown> | string;
        parameters?: Record<string, unknown> | string;
      };
    }>;
  };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  done_reason?: string;
}

interface OllamaModel {
  name: string;
}

function httpRequest(
  url: string,
  options?: { method?: string; body?: string; timeoutMs?: number }
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const timeoutMs = options?.timeoutMs ?? 30000;

    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: options?.method ?? 'GET',
        headers: options?.body
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(options.body) }
          : {},
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') });
        });
      }
    );

    req.on('error', (err) => {
      reject(new Error(`Erro de conexão com Ollama: ${err.message}`));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout (${Math.round(timeoutMs / 1000)}s) ao conectar ao Ollama — aumente em Configurações`));
    });

    if (options?.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function parseOllamaToolArgs(
  toolName: string,
  raw: Record<string, unknown> | string | undefined
): Record<string, unknown> {
  if (typeof raw === 'string') {
    return parseToolArguments(toolName, raw);
  }
  if (raw && typeof raw === 'object') {
    return parseToolArguments(toolName, raw);
  }
  return {};
}

export class OllamaProvider implements AIProvider {
  readonly name = 'ollama';
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? getExtensionSettings().ollamaUrl;
  }

  updateUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, '');
  }

  private getUrl(): string {
    return this.baseUrl || getExtensionSettings().ollamaUrl;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const settings = getExtensionSettings();
      const response = await httpRequest(`${this.getUrl()}/api/tags`, {
        timeoutMs: settings.connectionTimeoutMs,
      });
      return response.status >= 200 && response.status < 300;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const settings = getExtensionSettings();
      const response = await httpRequest(`${this.getUrl()}/api/tags`, {
        timeoutMs: settings.connectionTimeoutMs,
      });
      if (response.status < 200 || response.status >= 300) {
        return [];
      }
      const data = JSON.parse(response.body) as { models?: OllamaModel[] };
      return data.models?.map((m) => m.name) ?? [];
    } catch {
      return [];
    }
  }

  async testConnection(timeoutOverrideMs?: number): Promise<{ ok: boolean; message: string; models: string[] }> {
    try {
      const settings = getExtensionSettings();
      const timeoutMs = timeoutOverrideMs ?? settings.connectionTimeoutMs;
      const response = await httpRequest(`${this.getUrl()}/api/tags`, {
        timeoutMs,
      });
      if (response.status < 200 || response.status >= 300) {
        return { ok: false, message: `Ollama respondeu com status ${response.status}`, models: [] };
      }
      const data = JSON.parse(response.body) as { models?: OllamaModel[] };
      const models = data.models?.map((m) => m.name) ?? [];
      return {
        ok: true,
        message: `Conectado — ${models.length} modelo(s) disponível(is)`,
        models,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message, models: [] };
    }
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const settings = getExtensionSettings();
    const model = options?.model ?? settings.model;

    const ollamaMessages: OllamaMessage[] = messages.map((m) => ({
      role: m.role === 'tool' ? 'user' : m.role,
      content: m.role === 'tool' ? `Tool result (${m.name}): ${m.content}` : m.content,
    }));

    const body: Record<string, unknown> = {
      model,
      messages: ollamaMessages,
      stream: false,
      options: {
        temperature: options?.temperature ?? settings.temperature,
        num_predict: options?.maxResponseTokens ?? settings.maxResponseTokens,
      },
    };

    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
      if (options.requireToolCall) {
        body.tool_choice = 'required';
      }
    }

    const response = await httpRequest(`${this.getUrl()}/api/chat`, {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: settings.requestTimeoutMs,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Ollama error (${response.status}): ${response.body}`);
    }

    const data = JSON.parse(response.body) as OllamaChatResponse;
    const content = data.message?.content ?? '';

    let toolCalls: ToolCall[] | undefined;

    if (data.message?.tool_calls && data.message.tool_calls.length > 0) {
      toolCalls = data.message.tool_calls.map((tc, i) => ({
        id: `call_${Date.now()}_${i}`,
        name: tc.function.name,
        arguments: parseOllamaToolArgs(
          tc.function.name,
          tc.function.arguments ?? tc.function.parameters
        ),
      }));
    } else {
      const extracted = extractToolCallsFromContent(content);
      toolCalls = extracted ? toToolCalls(extracted) : undefined;
    }

    return {
      content,
      toolCalls,
      done: data.done,
      doneReason: data.done_reason,
      tokenUsage: {
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
    };
  }
}
