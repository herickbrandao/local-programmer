import * as fs from 'fs/promises';
import { AIProvider, ChatMessage, ToolDefinition } from './types';
import { TaskState } from './taskTracker';
import {
  buildConcreteEditHint,
  listFilesReadyToEdit,
  pickPrimaryEditTarget,
} from './executionPhase';
import { extractFilenamesFromPrompt } from './taskCompletion';
import { resolveWorkspacePath } from '../tools/pathUtils';
import { extractToolCallsFromContent, toToolCalls } from './toolCallParser';
import {
  clampEditToCitation,
  findCitationForFile,
  formatCitationConstraint,
  getPrimaryCitation,
} from './lineCitations';

const EDIT_FILE_TOOL: ToolDefinition = {
  name: 'edit_file',
  description: 'Substitui linhas por número. OBRIGATÓRIO usar replace_lines.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      action: { type: 'string', enum: ['replace_lines'] },
      start_line: { type: 'number' },
      end_line: { type: 'number' },
      content: { type: 'string' },
    },
    required: ['path', 'action', 'start_line', 'end_line', 'content'],
  },
};

export interface ForcedEditResult {
  success: boolean;
  message: string;
  args?: Record<string, unknown>;
}

function inferFallbackTarget(taskState: TaskState, userPrompt: string): string | undefined {
  const cite = getPrimaryCitation(taskState.citedRanges);
  if (cite) {
    return cite.path;
  }

  const ready = listFilesReadyToEdit(taskState);
  if (ready[0]) {
    return ready[0];
  }

  const goal = taskState.goal || userPrompt;
  const fromPrompt = extractFilenamesFromPrompt(goal);
  if (fromPrompt[0]) {
    return fromPrompt[0];
  }

  if (/documenta|readme|docs?|manual|ollama/i.test(goal)) {
    return 'README.md';
  }

  if (/front|bonito|ui|painel|visual|layout|css|embelez/i.test(goal)) {
    return 'src/ui/panelHtml.ts';
  }
  if (/agent|edit_file|tool|n[aã]o consegue|nunca consegue|funcionar|loop|itera/i.test(goal)) {
    return 'src/ai/agentController.ts';
  }

  return pickPrimaryEditTarget(taskState, userPrompt) ?? undefined;
}

function findEditWindow(lines: string[], filePath: string, goal: string): { start: number; end: number } {
  const lower = filePath.toLowerCase();
  const ui = /bonito|layout|front|visual|ui|css|embelez|melhor/i.test(goal);

  if (lower.includes('panelhtml') && ui) {
    const styleIdx = lines.findIndex((l) => l.includes('<style>'));
    if (styleIdx >= 0) {
      return { start: styleIdx + 2, end: Math.min(styleIdx + 45, lines.length) };
    }
    const bodyIdx = lines.findIndex((l) => /^\s*body\s*\{/.test(l));
    if (bodyIdx >= 0) {
      return { start: bodyIdx + 1, end: Math.min(bodyIdx + 25, lines.length) };
    }
  }

  const chatIdx = lines.findIndex((l) => l.includes('.chat-') || l.includes('.message'));
  if (chatIdx >= 0 && ui) {
    return { start: chatIdx + 1, end: Math.min(chatIdx + 30, lines.length) };
  }

  return { start: 1, end: Math.min(40, lines.length) };
}

function buildNumberedSnippet(lines: string[], start: number, end: number): string {
  return lines
    .slice(start - 1, end)
    .map((line, i) => `${start + i}| ${line}`)
    .join('\n');
}

export async function attemptForcedEdit(
  provider: AIProvider,
  model: string,
  workspaceRoot: string,
  taskState: TaskState,
  userPrompt: string,
  attempt: number
): Promise<ForcedEditResult> {
  const ready = listFilesReadyToEdit(taskState);
  const path = inferFallbackTarget(taskState, userPrompt);
  if (!path) {
    return { success: false, message: 'Nenhum arquivo alvo para edição forçada.' };
  }

  const fullPath = resolveWorkspacePath(workspaceRoot, path);
  let content: string;
  try {
    content = await fs.readFile(fullPath, 'utf-8');
  } catch {
    return { success: false, message: `Arquivo não encontrado: ${path}` };
  }

  const cite = findCitationForFile(taskState.citedRanges, path);
  const prep = taskState.citedEditPrep;

  if (prep?.draftContent && prep.filePath === path.replace(/\\/g, '/')) {
    return {
      success: true,
      message: `Usando rascunho da preparação para ${path}`,
      args: {
        path,
        action: 'replace_lines',
        start_line: prep.editStartLine,
        end_line: prep.editEndLine,
        content: prep.draftContent,
      },
    };
  }

  const lines = content.split('\n');
  const window = cite
    ? { start: cite.startLine, end: cite.endLine }
    : findEditWindow(lines, path, taskState.goal || userPrompt);
  const snippet = buildNumberedSnippet(lines, window.start, window.end);
  const hint = buildConcreteEditHint(path, taskState.goal || userPrompt);
  const citeBlock = formatCitationConstraint(taskState.citedRanges);
  const structureBlock = prep?.projectTree
    ? `\nEstrutura REAL do projeto (use esta — não invente):\n${prep.projectTree}`
    : '';

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'Você é um editor de código. Responda SOMENTE com um bloco ```json',
        'contendo: {"name":"edit_file","arguments":{"path":"...","action":"replace_lines","start_line":N,"end_line":M,"content":"..."}}',
        'Sem texto antes ou depois. content usa \\n para quebras de linha.',
        cite
          ? `OBRIGATÓRIO: start_line=${cite.startLine} end_line=${cite.endLine} — trecho citado pelo usuário.`
          : '',
      ].filter(Boolean).join('\n'),
    },
    {
      role: 'user',
      content: [
        `Tarefa: ${taskState.goal || userPrompt}`,
        `Arquivo: ${path}`,
        citeBlock,
        structureBlock,
        `Tentativa: ${attempt}`,
        hint,
        '',
        `Trecho atual (linhas ${window.start}-${window.end}):`,
        snippet,
        '',
        cite
          ? `Substitua SOMENTE as linhas ${cite.startLine}-${cite.endLine} conforme a tarefa.`
          : 'Gere edit_file replace_lines melhorando este trecho conforme a tarefa.',
      ].filter(Boolean).join('\n'),
    },
  ];

  try {
    const response = await provider.chat(messages, {
      model,
      tools: [EDIT_FILE_TOOL],
      temperature: 0,
      maxResponseTokens: 8192,
    });

    let toolCall = response.toolCalls?.[0];
    if (!toolCall) {
      const extracted = extractToolCallsFromContent(response.content);
      if (extracted?.[0]) {
        toolCall = toToolCalls(extracted)[0];
      }
    }

    if (!toolCall || toolCall.name !== 'edit_file') {
      return {
        success: false,
        message: `Modelo não retornou edit_file (tentativa ${attempt}).`,
      };
    }

    const args = toolCall.arguments as Record<string, unknown>;
    if (!args.path) {
      args.path = path;
    }
    if (args.action !== 'replace_lines') {
      args.action = 'replace_lines';
    }

    const clamped = clampEditToCitation(
      String(args.path),
      args.start_line,
      args.end_line,
      taskState.citedRanges
    );
    if (clamped) {
      args.start_line = clamped.start_line;
      args.end_line = clamped.end_line;
    } else if (cite) {
      args.start_line = cite.startLine;
      args.end_line = cite.endLine;
    }

    return {
      success: true,
      message: `Edição forçada gerada para ${String(args.path)}`,
      args,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Falha na edição forçada: ${msg}` };
  }
}

export function buildEditSuccessMessage(changedFiles: string[], goal: string): string {
  return [
    'Alterações aplicadas.',
    '',
    `**Pedido:** ${goal}`,
    `**Arquivos modificados:** ${changedFiles.join(', ')}`,
    '',
    'Revise o diff e recarregue a extensão se necessário (Developer: Reload Window).',
  ].join('\n');
}
