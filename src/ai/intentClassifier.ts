import { OperationMode } from '../config/settings';
import { AIProvider, ChatMessage } from './types';
import { MessageIntent } from './messageIntent';

export interface IntentClassification {
  intent: MessageIntent;
  reason: string;
  source: 'ai' | 'mode';
}

const VALID_INTENTS: MessageIntent[] = ['conversational', 'project_read', 'project_write'];

function parseIntentResponse(content: string): { intent: MessageIntent; reason: string } | null {
  const block = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [block?.[1]?.trim(), content.trim()].filter(Boolean) as string[];

  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw) as { intent?: string; reason?: string };
      if (parsed.intent && VALID_INTENTS.includes(parsed.intent as MessageIntent)) {
        return {
          intent: parsed.intent as MessageIntent,
          reason: String(parsed.reason ?? '').trim(),
        };
      }
    } catch {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          const parsed = JSON.parse(raw.slice(start, end + 1)) as { intent?: string; reason?: string };
          if (parsed.intent && VALID_INTENTS.includes(parsed.intent as MessageIntent)) {
            return {
              intent: parsed.intent as MessageIntent,
              reason: String(parsed.reason ?? '').trim(),
            };
          }
        } catch {
          // próximo candidato
        }
      }
    }
  }

  return null;
}

function fallbackByMode(operationMode: OperationMode): IntentClassification {
  if (operationMode === 'analyze') {
    return { intent: 'project_read', reason: 'Modo Análise — somente leitura', source: 'mode' };
  }
  if (operationMode === 'agent') {
    return { intent: 'project_write', reason: 'Modo Agente — leitura e edição', source: 'mode' };
  }
  return { intent: 'conversational', reason: 'Modo Chat — conversa', source: 'mode' };
}

/**
 * A IA classifica o pedido. O modo da UI só impõe limites (Análise = nunca escrever).
 */
export async function classifyIntentWithAI(
  provider: AIProvider,
  model: string,
  userPrompt: string,
  operationMode: OperationMode,
  signal?: AbortSignal
): Promise<IntentClassification> {
  if (operationMode === 'analyze') {
    return { intent: 'project_read', reason: 'Modo Análise — somente leitura', source: 'mode' };
  }

  const text = userPrompt.trim();
  if (!text) {
    return { intent: 'conversational', reason: 'Mensagem vazia', source: 'mode' };
  }

  const modeHint =
    operationMode === 'agent'
      ? 'Modo Agente: o usuário espera que você USE ferramentas no projeto quando fizer sentido.'
      : 'Modo Chat: use ferramentas só se o pedido claramente envolver arquivos do projeto.';

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'Você classifica a intenção do usuário num assistente de código local (estilo Cursor).',
        modeHint,
        '',
        'Responda SOMENTE com JSON válido:',
        '{"intent":"conversational"|"project_read"|"project_write","reason":"uma frase curta"}',
        '',
        'conversational — cumprimento, conversa, dúvida geral, sem tocar no repositório',
        'project_read — investigar, analisar, explicar, ler código; SEM alterar arquivos',
        '  (mesmo que o usuário cite bugs ou "alteração" ao descrever um problema — se pediu só investigar, é read)',
        'project_write — criar, editar, corrigir, implementar, atualizar arquivos ou rodar mudanças no projeto',
      ].join('\n'),
    },
    { role: 'user', content: text },
  ];

  try {
    const response = await provider.chat(messages, {
      model,
      temperature: 0,
      maxResponseTokens: 256,
      signal,
    });

    const parsed = parseIntentResponse(response.content);
    if (parsed) {
      if (operationMode === 'chat' && parsed.intent === 'project_write') {
        return { ...parsed, source: 'ai' };
      }
      if (operationMode === 'agent' && parsed.intent === 'conversational') {
        const hasProjectCue = /[@./\\]|\.(ts|js|md|json|py)\b|src\/|readme|arquivo|projeto|código|codigo/i.test(text);
        if (hasProjectCue) {
          return {
            intent: 'project_read',
            reason: parsed.reason || 'Pedido sobre o projeto — iniciando com leitura',
            source: 'ai',
          };
        }
      }
      return { ...parsed, source: 'ai' };
    }
  } catch {
    // fallback abaixo
  }

  return fallbackByMode(operationMode);
}

export function formatIntentThinking(classification: IntentClassification): string {
  const labels: Record<MessageIntent, string> = {
    conversational: 'Conversa',
    project_read: 'Análise (sem alterar arquivos)',
    project_write: 'Implementação (pode editar)',
  };
  const label = labels[classification.intent];
  if (classification.source === 'ai' && classification.reason) {
    return `${label} — ${classification.reason}`;
  }
  return label;
}
