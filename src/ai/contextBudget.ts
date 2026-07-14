import { ChatMessage } from './types';
import { ExecutionPhase } from './executionPhase';
import { MessageIntent } from './messageIntent';

/** Caps para edits — respostas longas só atrasam Ollama sem ganho */
export const EDIT_RESPONSE_TOKENS = 3072;
export const PLAN_RESPONSE_TOKENS = 2048;
export const VERIFY_RESPONSE_TOKENS = 1024;
export const CHAT_WITH_TOOLS_TOKENS = 4096;

const MAX_TOOL_RESULT_CHARS = 2400;
const MAX_MSG_CHARS = 6000;

/**
 * Reduz o histórico enviado ao modelo: mantém system + últimas mensagens,
 * trunca tool results enormes (maior custo de prefill no Ollama).
 */
export function trimChatMessagesForRequest(
  messages: ChatMessage[],
  phase: ExecutionPhase,
  intent: MessageIntent
): ChatMessage[] {
  const system = messages.find((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system' && !m.internal);

  const maxRest = phase === 'implement' || intent === 'project_write' ? 14 : 28;
  const sliced = rest.slice(-maxRest);

  const trimmed = sliced.map((m) => {
    let content = m.content;
    if (m.role === 'tool' && content.length > MAX_TOOL_RESULT_CHARS) {
      content = `${content.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[resultado truncado para performance]`;
    } else if (content.length > MAX_MSG_CHARS) {
      content = `${content.slice(0, MAX_MSG_CHARS)}\n…[truncado]`;
    }
    return content === m.content ? m : { ...m, content };
  });

  return system ? [system, ...trimmed] : trimmed;
}

/** Contexto enxuto para fase de implementação (sem árvore completa / símbolos) */
export function shouldUseLeanContext(phase: ExecutionPhase, intent: MessageIntent): boolean {
  return phase === 'implement' || intent === 'project_write';
}
