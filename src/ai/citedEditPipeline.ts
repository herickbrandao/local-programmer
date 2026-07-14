import * as fs from 'fs/promises';
import { AIProvider, ChatMessage, PendingChange, FileChange } from './types';
import { TaskState } from './taskTracker';
import { ContextManager } from '../workspace/contextManager';
import { ToolResult } from '../tools/types';
import { recordReadRange } from '../tools/fileReadChunks';
import { normalizeToolArgs, resolveWorkspacePath } from '../tools/pathUtils';
import { coerceImplementPhaseRead } from './executionPhase';
import {
  clampEditToCitation,
  findCitationForFile,
  formatCitationConstraint,
  type FileLineCitation,
} from './lineCitations';
import {
  buildMarkdownDirectoryTree,
  detectTreeRootFromLines,
  looksLikeDirectoryTree,
} from './projectTreeFormatter';
import { formatNumberedLines } from '../tools/fileReadChunks';
import { extractToolCallsFromContent, toToolCalls } from './toolCallParser';
import { EDIT_RESPONSE_TOKENS } from './contextBudget';

export interface CitedEditDeps {
  provider: AIProvider;
  model: string;
  workspaceRoot: string;
  contextManager: ContextManager;
  emitThinking: (content: string) => void;
  emitMessage: (content: string) => void;
  signal?: AbortSignal;
  executeEdit: (
    args: Record<string, unknown>,
    taskState: TaskState,
    pendingChanges: PendingChange[],
    sessionChanges: FileChange[]
  ) => Promise<ToolResult>;
}

export interface CitedEditResult {
  handled: boolean;
  success: boolean;
  changesCount: number;
  message: string;
}

export type PrepStepId =
  | 'verify_context'
  | 'gather_structure'
  | 'analyze_format'
  | 'draft_change'
  | 'apply_edit'
  | 'verify_result';

export type PrepStepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface PrepStep {
  id: PrepStepId;
  label: string;
  status: PrepStepStatus;
  detail?: string;
}

export interface CitedEditPreparation {
  steps: PrepStep[];
  cite: FileLineCitation;
  filePath: string;
  editStartLine: number;
  editEndLine: number;
  originalLines: string[];
  projectTree?: string;
  projectFileCount?: number;
  formatNotes?: string;
  draftContent?: string;
}

const PREP_STEPS: Array<{ id: PrepStepId; label: string }> = [
  { id: 'verify_context', label: 'Verificar contexto e trecho citado' },
  { id: 'gather_structure', label: 'Ler estrutura real do projeto' },
  { id: 'analyze_format', label: 'Analisar formato do trecho original' },
  { id: 'draft_change', label: 'Elaborar alteração' },
  { id: 'apply_edit', label: 'Aplicar edição' },
  { id: 'verify_result', label: 'Verificar resultado' },
];

function createPreparation(cite: FileLineCitation, filePath: string): CitedEditPreparation {
  return {
    steps: PREP_STEPS.map((s) => ({ ...s, status: 'pending' as PrepStepStatus })),
    cite,
    filePath,
    editStartLine: cite.startLine,
    editEndLine: cite.endLine,
    originalLines: [],
  };
}

function setStep(prep: CitedEditPreparation, id: PrepStepId, status: PrepStepStatus, detail?: string): void {
  const step = prep.steps.find((s) => s.id === id);
  if (step) {
    step.status = status;
    if (detail) {
      step.detail = detail;
    }
  }
}

function formatPrepProgress(prep: CitedEditPreparation): string {
  const done = prep.steps.filter((s) => s.status === 'done').length;
  return prep.steps
    .map((s, i) => {
      const icon = s.status === 'done' ? '✓' : s.status === 'running' ? '→' : s.status === 'failed' ? '✗' : '○';
      return `${icon} ${i + 1}/${prep.steps.length} ${s.label}${s.detail ? ` — ${s.detail}` : ''}`;
    })
    .join('\n');
}

function needsProjectStructure(goal: string, lines: string[]): boolean {
  return (
    /arquitetura|hierarqu|diret[oó]rio|estrutura|árvore|tree|pastas?|folder/i.test(goal)
    && looksLikeDirectoryTree(lines)
  );
}

function findCodeBlockAround(allLines: string[], line: number): { fenceStart: number; fenceEnd: number } | null {
  let openIdx = -1;
  for (let i = line - 1; i >= 0; i--) {
    if (allLines[i].trim().startsWith('```')) {
      openIdx = i;
      break;
    }
  }
  if (openIdx < 0) {
    return null;
  }
  for (let i = line - 1; i < allLines.length; i++) {
    if (allLines[i].trim() === '```' && i > openIdx) {
      return { fenceStart: openIdx + 1, fenceEnd: i + 1 };
    }
  }
  return null;
}

/** Restringe a edição ao miolo útil (árvore ou bloco), expandindo ao ``` completo se necessário */
export function resolveEffectiveEditRange(
  allLines: string[],
  cite: FileLineCitation,
  goal: string
): { startLine: number; endLine: number; reason: string; expandedCite?: FileLineCitation } {
  const slice = allLines.slice(cite.startLine - 1, cite.endLine);
  const isTree = looksLikeDirectoryTree(slice);
  const wantsStructure = needsProjectStructure(goal, slice);

  if (isTree && wantsStructure) {
    const block = findCodeBlockAround(allLines, cite.startLine);
    if (block && block.fenceEnd - block.fenceStart > 2) {
      const innerStart = block.fenceStart + 1;
      const innerEnd = block.fenceEnd - 1;
      return {
        startLine: innerStart,
        endLine: innerEnd,
        reason: `Bloco completo de árvore (linhas ${innerStart}-${innerEnd})`,
        expandedCite: {
          ...cite,
          startLine: innerStart,
          endLine: innerEnd,
          raw: `${cite.path}:${innerStart}-${innerEnd}`,
        },
      };
    }

    let start = 0;
    let end = slice.length - 1;
    while (end >= start && (/^#{1,6}\s/.test(slice[end].trim()) || slice[end].trim() === '```')) {
      end--;
    }
    while (start <= end && slice[start].trim() === '```') {
      start++;
    }
    if (start <= end) {
      return {
        startLine: cite.startLine + start,
        endLine: cite.startLine + end,
        reason: 'Trecho de árvore dentro da citação',
      };
    }
  }

  return {
    startLine: cite.startLine,
    endLine: cite.endLine,
    reason: 'Intervalo citado pelo usuário',
  };
}

function extractJsonContent(text: string): string | null {
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [block?.[1]?.trim(), text.trim()].filter(Boolean) as string[];

  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.content === 'string' && parsed.content.trim()) {
        return parsed.content;
      }
    } catch {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
          if (typeof parsed.content === 'string' && parsed.content.trim()) {
            return parsed.content;
          }
        } catch {
          // próximo
        }
      }
    }
  }
  return null;
}

async function draftContentWithAI(
  provider: AIProvider,
  model: string,
  goal: string,
  prep: CitedEditPreparation,
  numberedOriginal: string,
  extraContext: string,
  signal?: AbortSignal
): Promise<string | null> {
  const citeBlock = formatCitationConstraint([prep.cite]);
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'Você prepara o conteúdo de substituição para edit_file replace_lines.',
        'Responda SOMENTE com JSON: {"content":"..."}',
        'O content substitui as linhas indicadas — use \\n para quebras.',
        'Preserve o MESMO formato visual do trecho original (indentação, ├──, blocos markdown, etc.).',
        'Use a estrutura REAL do projeto fornecida — não invente arquivos.',
        citeBlock,
      ].filter(Boolean).join('\n'),
    },
    {
      role: 'user',
      content: [
        `Pedido: ${goal}`,
        '',
        `Arquivo: ${prep.filePath}`,
        `Substituir linhas ${prep.editStartLine}-${prep.editEndLine}`,
        prep.formatNotes ? `Formato: ${prep.formatNotes}` : '',
        '',
        extraContext ? `## Dados do projeto\n${extraContext}` : '',
        '',
        '## Trecho atual (com numeração)',
        numberedOriginal,
        '',
        'Gere o novo conteúdo completo para estas linhas.',
      ].filter(Boolean).join('\n'),
    },
  ];

  const response = await provider.chat(messages, {
    model,
    temperature: 0,
    maxResponseTokens: EDIT_RESPONSE_TOKENS,
    signal,
  });

  const fromJson = extractJsonContent(response.content);
  if (fromJson) {
    return fromJson;
  }

  const toolCall = response.toolCalls?.[0]
    ?? toToolCalls(extractToolCallsFromContent(response.content) ?? [])[0];
  if (toolCall?.name === 'edit_file') {
    const args = toolCall.arguments as Record<string, unknown>;
    if (typeof args.content === 'string' && args.content.trim()) {
      return args.content;
    }
  }

  return null;
}

export async function runCitedEditPipeline(
  goal: string,
  taskState: TaskState,
  projectContext: string,
  pendingChanges: PendingChange[],
  sessionChanges: FileChange[],
  deps: CitedEditDeps
): Promise<CitedEditResult> {
  const initialChanges = sessionChanges.length;
  const cite = taskState.citedRanges?.[0];

  if (!cite) {
    return { handled: false, success: false, changesCount: 0, message: 'Sem citação com linhas.' };
  }

  let filePath = cite.path;
  try {
    await fs.access(resolveWorkspacePath(deps.workspaceRoot, filePath));
  } catch {
    return { handled: false, success: false, changesCount: 0, message: `Arquivo não encontrado: ${cite.path}` };
  }

  const prep = createPreparation(cite, filePath);
  taskState.citedEditPrep = prep;

  deps.emitThinking('Preparando edição em etapas (trecho citado)...');
  deps.emitMessage(['## Preparação da edição', '', formatPrepProgress(prep)].join('\n'));

  // 1 — Verificar contexto
  setStep(prep, 'verify_context', 'running');
  deps.emitThinking('1/6 Verificando contexto e trecho citado...');

  const fullPath = resolveWorkspacePath(deps.workspaceRoot, filePath);
  let fileContent: string;
  try {
    fileContent = await fs.readFile(fullPath, 'utf-8');
  } catch {
    setStep(prep, 'verify_context', 'failed', 'Arquivo inacessível');
    return { handled: true, success: false, changesCount: 0, message: 'Arquivo citado não encontrado.' };
  }

  const allLines = fileContent.split('\n');
  const range = resolveEffectiveEditRange(allLines, cite, goal);
  prep.editStartLine = range.startLine;
  prep.editEndLine = range.endLine;
  prep.originalLines = allLines.slice(range.startLine - 1, range.endLine);

  if (range.expandedCite && taskState.citedRanges) {
    prep.cite = range.expandedCite;
    taskState.citedRanges = taskState.citedRanges.map((c) =>
      findCitationForFile([c], filePath) ? range.expandedCite! : c
    );
  }

  taskState.filesRead.add(filePath);
  recordReadRange(taskState.fileReadCoverage, filePath, range.startLine, range.endLine, allLines.length);

  setStep(prep, 'verify_context', 'done', `${filePath}:${range.startLine}-${range.endLine}`);
  deps.emitMessage(['## Preparação da edição', '', formatPrepProgress(prep)].join('\n'));

  // 2 — Coletar estrutura
  setStep(prep, 'gather_structure', 'running');
  deps.emitThinking('2/6 Lendo estrutura real do projeto...');

  let extraContext = projectContext;
  const wantsStructure = needsProjectStructure(goal, prep.originalLines);

  if (wantsStructure) {
    const treeRoot = detectTreeRootFromLines(prep.originalLines);
    const projectFiles = await deps.contextManager.getProjectFilePaths(deps.workspaceRoot, `${treeRoot}/`);
    prep.projectFileCount = projectFiles.length;
    prep.projectTree = buildMarkdownDirectoryTree(treeRoot, projectFiles);
    extraContext = [
      `Raiz da árvore: ${treeRoot}/`,
      `Arquivos indexados sob ${treeRoot}/: ${projectFiles.length}`,
      '',
      'Estrutura atual (use como base — preserve o estilo visual do trecho original):',
      prep.projectTree,
    ].join('\n');
    setStep(prep, 'gather_structure', 'done', `${projectFiles.length} arquivos em ${treeRoot}/`);
  } else {
    const codeIndex = await deps.contextManager.getCodeIndexSummary(deps.workspaceRoot);
    if (codeIndex) {
      extraContext = `${projectContext}\n\nÍndice:\n${codeIndex}`;
    }
    setStep(prep, 'gather_structure', 'skipped', 'Pedido não exige árvore de diretórios');
  }
  deps.emitMessage(['## Preparação da edição', '', formatPrepProgress(prep)].join('\n'));

  // 3 — Analisar formato
  setStep(prep, 'analyze_format', 'running');
  deps.emitThinking('3/6 Analisando formato do trecho original...');

  if (looksLikeDirectoryTree(prep.originalLines)) {
    prep.formatNotes = 'Árvore ASCII com src/ na raiz, ├── e └──; manter mesma indentação (│   ).';
  } else if (prep.originalLines.some((l) => l.trim().startsWith('```'))) {
    prep.formatNotes = 'Bloco markdown com cercas ``` — preserve-as se estiverem no intervalo.';
  } else {
    prep.formatNotes = 'Manter estilo, headings e listas do trecho original.';
  }

  setStep(prep, 'analyze_format', 'done', range.reason);
  deps.emitMessage(['## Preparação da edição', '', formatPrepProgress(prep)].join('\n'));

  // 4 — Elaborar alteração
  setStep(prep, 'draft_change', 'running');
  deps.emitThinking('4/6 Elaborando alteração com base nos dados coletados...');

  if (wantsStructure && prep.projectTree) {
    prep.draftContent = prep.projectTree;
    setStep(prep, 'draft_change', 'done', 'Árvore gerada a partir do índice do projeto');
  } else {
    const numbered = formatNumberedLines(prep.originalLines, prep.editStartLine);
    const drafted = await draftContentWithAI(
      deps.provider,
      deps.model,
      goal,
      prep,
      numbered,
      extraContext,
      deps.signal
    );
    if (!drafted) {
      setStep(prep, 'draft_change', 'failed', 'Modelo não gerou conteúdo');
      return {
        handled: true,
        success: false,
        changesCount: 0,
        message: 'Preparação falhou ao elaborar o novo conteúdo.',
      };
    }
    prep.draftContent = drafted;
    setStep(prep, 'draft_change', 'done', `${drafted.split('\n').length} linha(s)`);
  }
  deps.emitMessage(['## Preparação da edição', '', formatPrepProgress(prep)].join('\n'));

  // 5 — Aplicar
  setStep(prep, 'apply_edit', 'running');
  deps.emitThinking(`5/6 Aplicando edição em ${filePath}:${prep.editStartLine}-${prep.editEndLine}...`);

  const editArgs: Record<string, unknown> = {
    path: filePath,
    action: 'replace_lines',
    start_line: prep.editStartLine,
    end_line: prep.editEndLine,
    content: prep.draftContent,
  };

  const clamped = clampEditToCitation(filePath, editArgs.start_line, editArgs.end_line, taskState.citedRanges);
  if (clamped) {
    editArgs.start_line = clamped.start_line;
    editArgs.end_line = clamped.end_line;
  }

  const normalized = coerceImplementPhaseRead(
    normalizeToolArgs(deps.workspaceRoot, editArgs),
    taskState,
    'implement'
  );

  const result = await deps.executeEdit(normalized, taskState, pendingChanges, sessionChanges);

  if (!result.success) {
    setStep(prep, 'apply_edit', 'failed', result.output.slice(0, 120));
    return {
      handled: true,
      success: false,
      changesCount: sessionChanges.length - initialChanges,
      message: `Falha ao aplicar edição: ${result.output.slice(0, 300)}`,
    };
  }

  const unchanged = (result.data as { unchanged?: boolean } | undefined)?.unchanged;
  if (unchanged) {
    setStep(prep, 'apply_edit', 'failed', 'Conteúdo idêntico ao atual');
    return {
      handled: true,
      success: false,
      changesCount: 0,
      message: 'Nenhuma alteração — o conteúdo gerado era igual ao trecho atual. Reindexe o projeto ou refine o pedido.',
    };
  }

  setStep(prep, 'apply_edit', 'done', filePath);
  taskState.filesChanged = sessionChanges.map((c) => c.file);
  deps.emitMessage(['## Preparação da edição', '', formatPrepProgress(prep)].join('\n'));

  // 6 — Verificar
  setStep(prep, 'verify_result', 'running');
  deps.emitThinking('6/6 Verificando resultado...');

  const updated = await fs.readFile(fullPath, 'utf-8');
  const updatedSlice = updated.split('\n').slice(prep.editStartLine - 1, prep.editEndLine).join('\n');
  const changed = updatedSlice !== prep.originalLines.join('\n');

  setStep(
    prep,
    'verify_result',
    changed ? 'done' : 'failed',
    changed ? 'Trecho atualizado' : 'Trecho inalterado'
  );

  const message = [
    '## Edição concluída (preparação em etapas)',
    '',
    formatPrepProgress(prep),
    '',
    `**Arquivo:** ${filePath}:${prep.editStartLine}-${prep.editEndLine}`,
    changed ? '**Status:** trecho atualizado com dados do projeto.' : '**Status:** verificação não confirmou mudança.',
    '',
    'Revise o diff no card do arquivo.',
  ].join('\n');

  deps.emitMessage(message);

  return {
    handled: true,
    success: changed,
    changesCount: sessionChanges.length - initialChanges,
    message,
  };
}
