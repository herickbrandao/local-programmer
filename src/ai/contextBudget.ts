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
/** Prefetch precisa caber — truncar em 6k apagava o código e gerava edição alucinada */
const MAX_PREFETCH_CHARS = 28_000;
const PREFETCH_MARKERS = [
  '[Contexto lido da memória RAM / disco — lote]',
  '[Contexto pré-carregado em lote',
];

function isPrefetchMessage(content: string): boolean {
  return PREFETCH_MARKERS.some((m) => content.startsWith(m) || content.includes(m));
}

/**
 * Reduz o histórico enviado ao modelo: mantém system + últimas mensagens,
 * trunca tool results enormes (maior custo de prefill no Ollama).
 *
 * Mensagens `internal` (prefetch, continuações) DEVEM ir ao modelo.
 * Prefetch é pinado e usa orçamento maior — senão o modelo “lê” paths sem ver o código.
 */
export function trimChatMessagesForRequest(
  messages: ChatMessage[],
  phase: ExecutionPhase,
  intent: MessageIntent
): ChatMessage[] {
  const system = messages.find((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');

  const pinned = rest.filter((m) => isPrefetchMessage(m.content));
  const unpinned = rest.filter((m) => !isPrefetchMessage(m.content));

  const maxRest = phase === 'implement' || intent === 'project_write' ? 14 : 28;
  const pinnedKeep = pinned.slice(-2);
  const unpinnedBudget = Math.max(4, maxRest - pinnedKeep.length);
  const sliced = [...pinnedKeep, ...unpinned.slice(-unpinnedBudget)];

  const trimmed = sliced.map((m) => {
    let content = m.content;
    const prefetch = isPrefetchMessage(content);
    const limit = prefetch
      ? MAX_PREFETCH_CHARS
      : m.role === 'tool'
        ? MAX_TOOL_RESULT_CHARS
        : MAX_MSG_CHARS;

    if (content.length > limit) {
      const note = prefetch
        ? '\n…[prefetch truncado — chame read_files no arquivo que faltar; NÃO invente código]'
        : m.role === 'tool'
          ? '\n…[resultado truncado para performance]'
          : '\n…[truncado]';
      content = `${content.slice(0, limit)}${note}`;
    }
    return content === m.content ? m : { ...m, content };
  });

  return system ? [system, ...trimmed] : trimmed;
}

/** Contexto enxuto para fase de implementação (sem árvore completa / símbolos) */
export function shouldUseLeanContext(phase: ExecutionPhase, intent: MessageIntent): boolean {
  return phase === 'implement' || intent === 'project_write';
}
