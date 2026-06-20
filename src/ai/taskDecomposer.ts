import { AIProvider, ChatMessage } from './types';
import { MessageIntent } from './messageIntent';
import { isSimpleWriteRequest } from './taskCompletion';

export interface TaskPlan {
  originalGoal: string;
  subtasks: string[];
  currentIndex: number;
  completedNotes: string[];
}

export interface TaskDecomposition {
  decomposed: boolean;
  originalGoal: string;
  subtasks: string[];
}

const MIN_PROMPT_LENGTH = 60;
const MAX_SUBTASKS = 6;

const MULTI_STEP_PATTERN =
  /\b(e tamb[ée]m|depois disso|em seguida|al[eé]m disso|por fim|finalmente|primeiro[,:\s]|segundo[,:\s]|terceiro[,:\s]|outra coisa|tamb[ée]m preciso|tamb[ée]m quero)\b/iu;

const MULTI_ACTION_PATTERN =
  /\b(crie|criar|adicion[ea]|modific[ea]|edit[ea]|implement[ea]|refator[ea]|corrij[ea]|remov[ea]|atualiz[ea]|configure|configur[ea])\b/giu;

function splitNumberedOrBulletedList(prompt: string): string[] | null {
  const lines = prompt.split('\n').map((l) => l.trim()).filter(Boolean);
  const items: string[] = [];

  for (const line of lines) {
    const numbered = line.match(/^\d+[.)]\s+(.+)/);
    const bulleted = line.match(/^[-*•]\s+(.+)/);
    const text = numbered?.[1] ?? bulleted?.[1];
    if (text) {
      items.push(text.trim());
    }
  }

  if (items.length >= 2 && items.length <= MAX_SUBTASKS) {
    return items;
  }
  return null;
}

function splitOnSequencers(prompt: string): string[] | null {
  const parts = prompt
    .split(/\.\s+(?=Depois|Em seguida|Al[eé]m disso|Por fim|Finalmente|Tamb[ée]m)/iu)
    .map((p) => p.trim())
    .filter((p) => p.length >= 20);

  if (parts.length >= 2 && parts.length <= MAX_SUBTASKS) {
    return parts;
  }
  return null;
}

export function mightBenefitFromDecomposition(prompt: string, intent: MessageIntent): boolean {
  if (intent === 'conversational') {
    return false;
  }
  if (isSimpleWriteRequest(prompt)) {
    return false;
  }

  const text = prompt.trim();
  if (text.length < MIN_PROMPT_LENGTH) {
    return false;
  }

  if (splitNumberedOrBulletedList(text)) {
    return true;
  }
  if (splitOnSequencers(text)) {
    return true;
  }

  const actionMatches = text.match(MULTI_ACTION_PATTERN);
  if (actionMatches && actionMatches.length >= 2) {
    return true;
  }

  if (MULTI_STEP_PATTERN.test(text) && text.length >= 80) {
    return true;
  }

  const sentenceCount = text.split(/[.!?]+/).filter((s) => s.trim().length > 15).length;
  return sentenceCount >= 3 && text.length >= 100;
}

function parseDecompositionJson(content: string): TaskDecomposition | null {
  const jsonMatch = content.match(/\{[\s\S]*"decompose"[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      decompose?: boolean;
      subtasks?: string[];
    };

    if (!parsed.decompose || !Array.isArray(parsed.subtasks)) {
      return null;
    }

    const subtasks = parsed.subtasks
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter((s) => s.length >= 10)
      .slice(0, MAX_SUBTASKS);

    if (subtasks.length < 2) {
      return null;
    }

    return {
      decomposed: true,
      originalGoal: '',
      subtasks,
    };
  } catch {
    return null;
  }
}

function heuristicDecomposition(prompt: string): TaskDecomposition | null {
  const numbered = splitNumberedOrBulletedList(prompt);
  if (numbered) {
    return { decomposed: true, originalGoal: prompt, subtasks: numbered };
  }

  const sequenced = splitOnSequencers(prompt);
  if (sequenced) {
    return { decomposed: true, originalGoal: prompt, subtasks: sequenced };
  }

  return null;
}

async function aiDecomposition(
  provider: AIProvider,
  model: string,
  prompt: string
): Promise<TaskDecomposition | null> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `Analise se o pedido do usuário combina várias ações independentes que valem a pena executar em etapas separadas.
Responda JSON apenas:
{"decompose":true,"subtasks":["etapa 1 clara","etapa 2 clara"]}
ou
{"decompose":false,"subtasks":[]}

Regras:
- decompose=true só se houver 2–${MAX_SUBTASKS} etapas distintas e substanciais
- Cada subtask deve ser autocontida e executável no projeto
- Não divida perguntas simples, saudações ou um único arquivo/ação
- Mantenha o idioma original do pedido nas subtasks`,
    },
    {
      role: 'user',
      content: prompt,
    },
  ];

  try {
    const result = await provider.chat(messages, { model, temperature: 0 });
    const parsed = parseDecompositionJson(result.content);
    if (parsed) {
      return { ...parsed, originalGoal: prompt };
    }
  } catch {
    // fallback silencioso
  }

  return null;
}

export async function analyzeTaskDecomposition(
  provider: AIProvider,
  model: string,
  prompt: string,
  intent: MessageIntent
): Promise<TaskDecomposition> {
  const fallback: TaskDecomposition = {
    decomposed: false,
    originalGoal: prompt,
    subtasks: [prompt],
  };

  if (!mightBenefitFromDecomposition(prompt, intent)) {
    return fallback;
  }

  const heuristic = heuristicDecomposition(prompt);
  if (heuristic) {
    return heuristic;
  }

  const aiResult = await aiDecomposition(provider, model, prompt);
  if (aiResult) {
    return aiResult;
  }

  return fallback;
}

export function buildSubtaskFocusMessage(plan: TaskPlan): string {
  const current = plan.subtasks[plan.currentIndex];
  const total = plan.subtasks.length;
  const done = plan.completedNotes;

  const lines = [
    `[Etapa ${plan.currentIndex + 1}/${total} — foco exclusivo nesta etapa]`,
    `Objetivo geral (referência): ${plan.originalGoal}`,
    `Etapa atual: ${current}`,
  ];

  if (done.length > 0) {
    lines.push('', 'Etapas anteriores já concluídas:');
    done.forEach((note, index) => {
      lines.push(`${index + 1}. ${note}`);
    });
  }

  lines.push(
    '',
    'Execute SOMENTE esta etapa agora. Use ferramentas se necessário.',
    'Ao terminar esta etapa, responda com um resumo curto do que foi feito.',
    'Não antecipe etapas futuras — elas serão solicitadas em seguida.'
  );

  return lines.join('\n');
}

export function buildMergeMessage(plan: TaskPlan, sessionSummary: string): string {
  const lines = [
    '[Consolidação final — juntar todas as etapas]',
    `Pedido original do usuário: ${plan.originalGoal}`,
    '',
    'Etapas executadas:',
  ];

  plan.subtasks.forEach((subtask, index) => {
    const note = plan.completedNotes[index] ?? '(sem resumo registrado)';
    lines.push(`${index + 1}. ${subtask}`, `   Resultado: ${note}`);
  });

  if (sessionSummary) {
    lines.push('', `Alterações no projeto nesta sessão: ${sessionSummary}`);
  }

  lines.push(
    '',
    'Verifique se todas as etapas se integram corretamente.',
    'Se faltar algo, use ferramentas para corrigir.',
    'Responda ao usuário com um resumo final único, claro e completo — sem mencionar o processo interno de etapas.'
  );

  return lines.join('\n');
}

export function summarizeSessionChanges(changedFiles: string[]): string {
  if (changedFiles.length === 0) {
    return 'nenhum arquivo alterado';
  }
  return changedFiles.join(', ');
}
