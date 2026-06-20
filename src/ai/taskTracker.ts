import { FileChange } from './types';
import { MessageIntent } from './messageIntent';
import { TaskPlan } from './taskDecomposer';
import { ExecutionPhase, buildImplementPhaseMessage, createInitialPhase } from './executionPhase';
import { FileReadCoverageMap, formatCoverageSummary } from '../tools/fileReadChunks';

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
  hadToolCalls: boolean
): boolean {
  if (state.continuationCount >= 12) {
    return false;
  }
  if (toolsMode !== 'agent') {
    return false;
  }
  if (state.intent !== 'project_write') {
    return false;
  }
  if (sessionChanges.length > 0) {
    return false;
  }

  // Pedido de alteração: resposta só texto sem editar → continuar até implementar
  if (!hadToolCalls) {
    if (state.filesRead.size > 0) {
      state.forceImplement = true;
    }
    return true;
  }

  return false;
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
    'Use edit_file replace_lines (start_line/end_line do read_file). Opcional: verify_content.',
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
