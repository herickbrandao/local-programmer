import { FileChange } from './types';
import { MessageIntent } from './messageIntent';
import { TaskPlan } from './taskDecomposer';
import { ExecutionPhase, buildImplementPhaseMessage, createInitialPhase, needsMoreFileWork, listFilesReadyToEdit } from './executionPhase';
import { FileReadCoverageMap, formatCoverageSummary } from '../tools/fileReadChunks';
import type { EditPlan } from './editPlanPipeline';
import { buildPlanContextBlock } from './editPlanPipeline';

export type PlanPhase = 'idle' | 'planning' | 'executing' | 'verifying' | 'complete' | 'complete_with_warnings' | 'failed';

export interface TaskState {
  goal: string;
  intent: MessageIntent;
  iteration: number;
  continuationCount: number;
  filesRead: Set<string>;
  filesChanged: string[];
  taskPlan?: TaskPlan;
  phase: ExecutionPhase;
  totalReads: number;
  consecutiveReadIterations: number;
  forceImplement: boolean;
  fileReadCounts: Record<string, number>;
  fileReadCoverage: FileReadCoverageMap;
  /** Evita repetir aviso de modo editor na mesma sessão */
  editorModeAnnounced?: boolean;
  /** Plano estruturado de edições (análise → N alterações → verificação) */
  editPlan?: EditPlan;
  planPhase?: PlanPhase;
  /** Plano em etapas já executado neste subtask — evita repetir */
  planPipelineDone?: boolean;
}

export function createTaskState(goal: string, intent: MessageIntent): TaskState {
  return {
    goal,
    intent,
    iteration: 0,
    continuationCount: 0,
    filesRead: new Set(),
    filesChanged: [],
    phase: createInitialPhase(),
    totalReads: 0,
    consecutiveReadIterations: 0,
    forceImplement: false,
    fileReadCounts: {},
    fileReadCoverage: {},
  };
}

export function buildTaskContextBlock(state: TaskState, phaseContext = ''): string {
  const read = [...state.filesRead];
  const changed = state.filesChanged;
  const lines = [
    '',
    '## Tarefa em andamento (mantenha foco)',
    `Objetivo do usuário: ${state.goal}`,
    `Iteração: ${state.iteration}`,
  ];

  if (state.taskPlan) {
    const plan = state.taskPlan;
    lines.push(
      `Plano em etapas (${plan.currentIndex + 1}/${plan.subtasks.length}):`,
      `Etapa atual: ${plan.subtasks[plan.currentIndex]}`
    );
    if (plan.completedNotes.length > 0) {
      lines.push(`Etapas concluídas: ${plan.completedNotes.length}/${plan.subtasks.length}`);
    }
    lines.push('Após todas as etapas, integre o resultado final de forma coesa.');
  }

  const planBlock = buildPlanContextBlock(state.editPlan);
  if (planBlock) {
    lines.push(planBlock);
  }

  if (read.length > 0) {
    lines.push(`Arquivos tocados: ${read.join(', ')}`);
  }
  const coverageLines = formatCoverageSummary(state.fileReadCoverage);
  if (coverageLines.length > 0) {
    lines.push('Cobertura de leitura:');
    lines.push(...coverageLines);
  }
  if (changed.length > 0) {
    lines.push(`Arquivos já alterados: ${changed.join(', ')}`);
    const pendingEdit = listFilesReadyToEdit(state);
    if (pendingEdit.length > 0) {
      lines.push(`⚠ Ainda editar: ${pendingEdit.join(', ')}`);
    }
  } else if (state.intent === 'project_write') {
    lines.push('⚠ Ainda NENHUM arquivo foi alterado — use edit_file replace_lines (números do read_file).');
  }

  lines.push('Conclua a tarefa antes de responder só com texto.');
  return lines.join('\n') + phaseContext;
}

export function shouldAutoContinue(
  state: TaskState,
  toolsMode: string,
  sessionChanges: FileChange[],
  _hadToolCalls: boolean,
  userPrompt?: string
): boolean {
  const maxContinuations = 25;
  if (state.continuationCount >= maxContinuations) {
    return false;
  }
  if (toolsMode !== 'agent') {
    return false;
  }
  if (state.intent !== 'project_write') {
    return false;
  }

  if (sessionChanges.length > 0) {
    return needsMoreFileWork(state, userPrompt ?? state.goal, sessionChanges);
  }

  if (state.filesRead.size > 0) {
    state.forceImplement = true;
  }
  return true;
}

export function buildTaskIncompleteMessage(state: TaskState, userPrompt: string): string {
  const read = [...state.filesRead];
  const pendingEdit = listFilesReadyToEdit(state);
  return [
    'Não foi possível aplicar alterações após várias tentativas automáticas.',
    '',
    `**Pedido:** ${state.goal || userPrompt}`,
    read.length > 0 ? `**Arquivos lidos:** ${read.join(', ')}` : '',
    state.filesChanged.length > 0 ? `**Já alterados:** ${state.filesChanged.join(', ')}` : '',
    pendingEdit.length > 0 ? `**Pendentes:** ${pendingEdit.join(', ')}` : '',
    '',
    'Dica: cite o arquivo e trecho desejado (ex.: `@src/ui/panelHtml.ts:90-120`) ou use um modelo maior no Ollama.',
  ].filter(Boolean).join('\n');
}

export function buildContinuationMessage(state: TaskState, userPrompt?: string): string {
  const read = [...state.filesRead];
  if (state.phase === 'implement') {
    return buildImplementPhaseMessage(state, userPrompt ?? state.goal);
  }
  return [
    '[Continuação automática — complete a tarefa]',
    `Objetivo original: ${state.goal}`,
    read.length > 0 ? `Você já leu: ${read.join(', ')}` : '',
    'Use edit_file replace_lines nos arquivos já lidos. Leia outros arquivos se o pedido envolver mais de um.',
    'Depois chame test_project para validar. Não reescreva arquivos inteiros.',
  ].filter(Boolean).join('\n');
}

export function isTaskLikelyComplete(
  state: TaskState,
  sessionChanges: FileChange[],
  responseContent: string
): boolean {
  if (state.intent !== 'project_write') {
    return true;
  }
  if (sessionChanges.length > 0) {
    return true;
  }
  const lower = responseContent.toLowerCase();
  const doneHints = ['implementado', 'alteração concluída', 'arquivo modificado', 'pronto!', 'concluído'];
  return doneHints.some((h) => lower.includes(h)) && sessionChanges.length > 0;
}
