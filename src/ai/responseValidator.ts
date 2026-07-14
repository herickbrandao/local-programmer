import { MessageIntent } from './messageIntent';
import { AIProvider, ChatMessage } from './types';

export function looksLikeManualInstructions(response: string): boolean {
  const lower = response.toLowerCase();
  return /\b(aplique manualmente|você precisa aplicar|voce precisa aplicar|faça você mesmo|sem acesso direto|não é possível alterar|nao e possivel alterar|instruções para você|siga as instruções)\b/i.test(lower);
}

/**
 * Modelo alegou não conseguir ler o projeto.
 * Só trate como prematuro se o host já tiver workspace + memória prontos.
 */
export function claimsNoProjectAccess(response: string): boolean {
  return /\b(não tenho acesso|nao tenho acesso|não posso analisar o projeto|nao posso analisar o projeto|sem acesso aos arquivos|não posso analisar diretamente|nao posso analisar diretamente|não tenho acesso aos arquivos|nao tenho acesso aos arquivos)\b/i.test(
    response
  );
}

export function isAgentImplementationTask(
  intent: MessageIntent,
  toolsMode: string
): boolean {
  return intent === 'project_write' && toolsMode === 'agent';
}

export interface ResponseAssessment {
  satisfactory: boolean;
  reason: string;
  source: 'heuristic' | 'ai' | 'both' | 'fast_path';
}

const LOCATION_QUESTION_PATTERN =
  /\b(onde (eu )?(altero|mudo|troco|configuro|encontro|fica|est[aá]|defino)|qual (arquivo|past[ae])|em qual (arquivo|past[ae]))\b/iu;

export function isSimpleLocationQuestion(question: string): boolean {
  return LOCATION_QUESTION_PATTERN.test(question);
}

function hasUnclosedCodeFence(text: string): boolean {
  const fences = text.match(/```/g);
  return fences !== null && fences.length % 2 !== 0;
}

function looksTruncated(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 20) {
    return false;
  }

  if (hasUnclosedCodeFence(trimmed)) {
    return true;
  }

  const lastChar = trimmed.slice(-1);
  const endsCleanly = /[.!?…)"'`\]}]$/.test(lastChar) || trimmed.endsWith('```');
  if (endsCleanly) {
    return false;
  }

  if (trimmed.length > 100 && !endsCleanly) {
    return true;
  }

  return false;
}

function answersLocationQuestion(response: string): boolean {
  const lower = response.toLowerCase();
  const hasPath = /package\.json|media\/|icon\.(svg|png|jpg)|contributes|viewscontainers/i.test(response);
  const hasGuidance = /\b(arquivo|past[ae]|substitu|edite|troque|altere|fica em|está em|esta em)\b/i.test(lower);
  const complete = /[.!?]$/.test(response.trim()) && response.trim().length >= 80;
  return hasPath && hasGuidance && complete;
}

function heuristicAssessment(userQuestion: string, response: string): ResponseAssessment | null {
  const text = response.trim();
  if (!text) {
    return { satisfactory: false, reason: 'Resposta vazia', source: 'heuristic' };
  }

  if (isSimpleLocationQuestion(userQuestion) && answersLocationQuestion(text)) {
    return { satisfactory: true, reason: 'Resposta localiza o arquivo corretamente', source: 'fast_path' };
  }

  if (looksTruncated(text)) {
    return { satisfactory: false, reason: 'Resposta aparenta estar cortada no meio', source: 'heuristic' };
  }

  const asksExplain = /\b(o que|what|explica|descrev|como funciona|para que serve)\b/i.test(userQuestion);
  if (asksExplain && text.length < 120) {
    return { satisfactory: false, reason: 'Explicação muito curta para a pergunta', source: 'heuristic' };
  }

  if (looksLikeManualInstructions(text)) {
    return {
      satisfactory: false,
      reason: 'Resposta instrui o usuário manualmente em vez de implementar no projeto',
      source: 'heuristic',
    };
  }

  return null;
}

function parseValidationJson(content: string): ResponseAssessment | null {
  const jsonMatch = content.match(/\{[\s\S]*"satisfactory"[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { satisfactory?: boolean; reason?: string };
    if (typeof parsed.satisfactory !== 'boolean') {
      return null;
    }
    return {
      satisfactory: parsed.satisfactory,
      reason: parsed.reason?.trim() || (parsed.satisfactory ? 'OK' : 'Resposta insatisfatória'),
      source: 'ai',
    };
  } catch {
    return null;
  }
}

export function isResponseTruncated(text: string): boolean {
  return looksTruncated(text);
}

export async function validateResponseWithAI(
  provider: AIProvider,
  userQuestion: string,
  assistantResponse: string,
  model: string
): Promise<ResponseAssessment> {
  const isSimple = isSimpleLocationQuestion(userQuestion);
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `Você avalia respostas de assistente de programação.
${isSimple ? 'Pergunta simples de LOCALIZAÇÃO — basta indicar caminho(s) de arquivo e o que editar. NÃO exija blocos de código completos.' : ''}

Marque satisfactory=false se: cortada, não responde, ou inútil.
Marque satisfactory=true se: responde de forma completa e útil (para perguntas simples, resposta curta com caminhos basta).

JSON apenas: {"satisfactory":true,"reason":"..."}`,
    },
    {
      role: 'user',
      content: `Pedido:\n${userQuestion}\n\nResposta:\n${assistantResponse.slice(0, 4000)}`,
    },
  ];

  try {
    const result = await provider.chat(messages, { model, temperature: 0 });
    const parsed = parseValidationJson(result.content);
    if (parsed) {
      return parsed;
    }
  } catch {
    // fallback
  }

  return { satisfactory: true, reason: 'Validação indisponível — aceita', source: 'ai' };
}

export async function assessResponseQuality(
  provider: AIProvider,
  model: string,
  userQuestion: string,
  assistantResponse: string,
  generationComplete = true
): Promise<ResponseAssessment> {
  const fastPath = heuristicAssessment(userQuestion, assistantResponse);
  if (fastPath?.satisfactory && fastPath.source === 'fast_path') {
    return fastPath;
  }

  if (!generationComplete) {
    return {
      satisfactory: false,
      reason: 'Geração interrompida pelo limite de tokens',
      source: 'heuristic',
    };
  }

  if (fastPath && !fastPath.satisfactory) {
    const aiResult = await validateResponseWithAI(provider, userQuestion, assistantResponse, model);
    if (!aiResult.satisfactory) {
      return {
        satisfactory: false,
        reason: `${fastPath.reason}; ${aiResult.reason}`,
        source: 'both',
      };
    }
    return aiResult;
  }

  return validateResponseWithAI(provider, userQuestion, assistantResponse, model);
}

export function buildRefinementPrompt(reason: string, userQuestion: string, allowTools = false): string {
  const simple = isSimpleLocationQuestion(userQuestion);
  const lines = [
    '[Refino automático — reescreva do zero]',
    `Motivo: ${reason}`,
    `Pedido original: ${userQuestion}`,
  ];

  if (allowTools) {
    lines.push(
      'IMPLEMENTE com edit_file replace_lines (start_line/end_line do read_file). NÃO reescreva arquivos inteiros.',
    );
  } else if (simple) {
    lines.push(
      'Responda em NO MÁXIMO 8 linhas. Indique apenas o(s) caminho(s) de arquivo e o que mudar. SEM blocos de código longos, SEM colar SVG.'
    );
  } else {
    lines.push(
      'Reescreva a resposta COMPLETA do zero. Seja conciso. Evite blocos de código enormes — use trechos curtos ou só caminhos de arquivo.',
      'Termine com frase completa. Apenas texto, sem ferramentas.'
    );
  }

  return lines.join('\n');
}

export async function synthesizeFinalAnswer(
  provider: AIProvider,
  model: string,
  userQuestion: string,
  partialAttempts: string[],
  maxResponseTokens: number
): Promise<string> {
  const partials = partialAttempts
    .map((part, index) => `--- Tentativa ${index + 1} (incompleta) ---\n${part.slice(0, 1200)}`)
    .join('\n\n');

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `Você produz a resposta FINAL para o usuário em português.
Regras obrigatórias:
- Resposta completa em no máximo 12 linhas
- NÃO cole SVG nem arquivos inteiros
- Cite caminhos com \`backticks\`
- Termine com ponto final
- Para extensões VSCode: ícone costuma estar em package.json (contributes) e media/icon.svg`,
    },
    {
      role: 'user',
      content: `Pergunta do usuário:\n${userQuestion}\n\nTentativas anteriores falharam ou cortaram:\n${partials || '(nenhuma)'}\n\nEscreva agora a resposta final, curta e completa:`,
    },
  ];

  const result = await provider.chat(messages, {
    model,
    temperature: 0.2,
    maxResponseTokens,
  });

  const text = result.content.trim();
  if (text && !/[.!?]$/.test(text)) {
    return `${text}.`;
  }
  return text || 'Não foi possível gerar uma resposta completa. Verifique package.json e a pasta media/ do projeto para o ícone.';
}
