import { IMPLEMENT_TOOLS, WRITE_TOOLS } from '../config/settings';
import { ToolDefinition } from './types';
import { MessageIntent } from './messageIntent';
import type { TaskState } from './taskTracker';
import { extractFilenamesFromPrompt } from './taskCompletion';
import { isFileFullyRead, isRangeFullyRead } from '../tools/fileReadChunks';

export type ExecutionPhase = 'explore' | 'implement';

const IMPLEMENT_PHASE_READ_TOOLS = new Set(['read_file', 'search_files']);
const READ_TOOL_NAMES = new Set(['read_file', 'list_files', 'search_files']);
const WRITE_TOOL_NAMES = new Set<string>(WRITE_TOOLS);
const IMPLEMENT_TOOL_NAMES = new Set<string>(IMPLEMENT_TOOLS);

/** Máximo de linhas por leitura na fase implementação (trecho novo ou reverificação) */
const MAX_IMPLEMENT_READ_SPAN = 350;
const MAX_VERIFY_READ_SPAN = 30;

/** Leituras totais (inclui chunks) antes de forçar implementação */
const MAX_TOTAL_READS = 20;
/** Iterações seguidas só lendo, sem escrever */
const MAX_CONSECUTIVE_READ_ITERATIONS = 4;

export function createInitialPhase(): ExecutionPhase {
  return 'explore';
}

export function userRequiresEdits(state: TaskState, toolsMode: string): boolean {
  return toolsMode === 'agent' && state.intent === 'project_write';
}

export function updateExecutionPhase(state: TaskState, toolsMode: string): void {
  if (!userRequiresEdits(state, toolsMode)) {
    state.phase = 'explore';
    return;
  }

  if (state.filesChanged.length > 0) {
    return;
  }

  const readLoop = state.consecutiveReadIterations >= MAX_CONSECUTIVE_READ_ITERATIONS;
  const readBudget = state.totalReads >= MAX_TOTAL_READS;

  if (state.forceImplement || readLoop || readBudget) {
    state.phase = 'implement';
  } else {
    state.phase = 'explore';
  }
}

export function filterToolsForPhase(
  tools: ToolDefinition[],
  phase: ExecutionPhase,
  intent: MessageIntent,
  toolsMode: string
): ToolDefinition[] {
  if (toolsMode !== 'agent' || intent !== 'project_write' || phase === 'explore') {
    return tools;
  }

  return tools.filter(
    (tool) => IMPLEMENT_TOOL_NAMES.has(tool.name) || IMPLEMENT_PHASE_READ_TOOLS.has(tool.name)
  );
}

export function getToolBlockReason(
  toolName: string,
  args: Record<string, unknown>,
  filePath: string | undefined,
  state: TaskState,
  toolsMode: string,
  intent: MessageIntent
): string | null {
  if (!userRequiresEdits(state, toolsMode) || intent !== 'project_write') {
    return null;
  }

  if (toolName === 'edit_file' && args.action === 'search_replace') {
    return [
      'search_replace desativado — use replace_lines com start_line/end_line do read_file.',
      'Opcional: verify_content com o texto das linhas (sem prefixo N|).',
    ].join(' ');
  }

  if (toolName === 'modify_file') {
    return 'modify_file desativado no modo Agente — use edit_file replace_lines por número de linha.';
  }

  if (state.phase === 'implement' && READ_TOOL_NAMES.has(toolName)) {
    if (isAllowedReadInImplement(toolName, args, filePath, state)) {
      return null;
    }

    const target = pickPrimaryEditTarget(state, state.goal);
    const cov = filePath ? state.fileReadCoverage[filePath] : undefined;
    const covText = cov
      ? `${filePath}: ${Math.max(...cov.ranges.map((r) => r.to), 0)}/${cov.totalLines} linhas`
      : [...state.filesRead].join(', ') || '(nenhum)';
    const hints = buildImplementReadHints(target, filePath, state);

    return [
      'Leitura bloqueada — fase de IMPLEMENTAÇÃO.',
      `Contexto já carregado: ${covText}.`,
      'Permitido: search_files; read_file com start_line+end_line (≤30 reverificar, ≤350 trecho novo); continue_read no arquivo alvo.',
      ...hints,
      target ? `Arquivo alvo: ${target}` : '',
    ].filter(Boolean).join(' ');
  }

  return null;
}

function isAllowedReadInImplement(
  toolName: string,
  args: Record<string, unknown>,
  filePath: string | undefined,
  state: TaskState
): boolean {
  if (toolName === 'search_files') {
    return true;
  }

  if (toolName !== 'read_file' || !filePath) {
    return false;
  }

  if (isNarrowVerificationRead(args)) {
    return true;
  }

  const target = pickPrimaryEditTarget(state, state.goal);
  const isTargetFile = !target || filePath === target || filePath.endsWith(target);

  const continueRead = args.continue_read === true || args.continue_read === 'true';
  if (continueRead && isTargetFile) {
    const cov = state.fileReadCoverage[filePath];
    if (cov && !isFileFullyRead(state.fileReadCoverage, filePath)) {
      return true;
    }
  }

  const start = asLineNumber(args.start_line);
  const end = asLineNumber(args.end_line);
  if (start === undefined || end === undefined || start < 1 || end < start) {
    return false;
  }

  const span = end - start + 1;
  if (span > MAX_IMPLEMENT_READ_SPAN) {
    return false;
  }

  if (!isRangeFullyRead(state.fileReadCoverage, filePath, start, end)) {
    return isTargetFile;
  }

  return span <= MAX_VERIFY_READ_SPAN;
}

function buildImplementReadHints(
  target: string | null,
  filePath: string | undefined,
  state: TaskState
): string[] {
  const hints: string[] = [
    'Fluxo: search_files → read_file start_line/end_line → edit_file replace_lines.',
  ];

  const path = filePath ?? target;
  if (!path) {
    return hints;
  }

  const cov = state.fileReadCoverage[path];
  if (cov && !isFileFullyRead(state.fileReadCoverage, path)) {
    const next = Math.max(...cov.ranges.map((r) => r.to), 0) + 1;
    const end = Math.min(cov.totalLines, next + MAX_IMPLEMENT_READ_SPAN - 1);
    hints.push(`Próximo trecho não lido: read_file path="${path}" start_line=${next} end_line=${end}`);
  }

  return hints;
}

function isNarrowVerificationRead(args: Record<string, unknown>): boolean {
  const start = asLineNumber(args.start_line);
  const end = asLineNumber(args.end_line);
  if (start === undefined || end === undefined || start < 1 || end < start) {
    return false;
  }
  return end - start + 1 <= MAX_VERIFY_READ_SPAN;
}

function asLineNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isFinite(n) ? n : undefined;
}

export function buildEditRecoveryHint(args: Record<string, unknown>, errorOutput: string): string | null {
  const recoverable = errorOutput.includes('verify_content')
    || errorOutput.includes('old_text não encontrado')
    || errorOutput.includes('start_line')
    || errorOutput.includes('além do fim');
  if (!recoverable) {
    return null;
  }

  const path = typeof args.path === 'string' ? args.path : '?';
  const start = asLineNumber(args.start_line);
  const end = asLineNumber(args.end_line);
  const readHint = start && end
    ? `read_file path="${path}" start_line=${Math.max(1, start - 2)} end_line=${end + 2}`
    : `read_file path="${path}" start_line=... end_line=...`;

  return [
    '[Correção — editar por número de linha]',
    errorOutput.slice(0, 900),
    '',
    'Próximo passo:',
    `1. ${readHint} — confirme N| linha`,
    '2. edit_file replace_lines com start_line, end_line, content',
    '3. verify_content = texto EXATO das linhas atuais (sem "N| ")',
    'NÃO use search_replace nem modify_file.',
  ].join('\n');
}

export function pickPrimaryEditTarget(state: TaskState, userPrompt: string): string | null {
  const fromPrompt = extractFilenamesFromPrompt(userPrompt);
  if (fromPrompt.length > 0) {
    return fromPrompt[0].replace(/\\/g, '/');
  }

  const reads = [...state.filesRead];
  if (reads.length === 0) {
    return null;
  }

  const scored = reads.map((file) => {
    const lower = file.toLowerCase();
    let score = 0;
    if (lower.includes('panelhtml')) score += 10;
    if (lower.includes('chatview') || lower.includes('/ui/')) score += 5;
    if (lower.endsWith('.tsx') || lower.endsWith('.ts')) score += 2;
    if (lower.includes('html') || lower.includes('css')) score += 3;
    score += state.fileReadCoverage[file]?.ranges.length ?? 0;
    return { file, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.file ?? reads[reads.length - 1];
}

export function buildImplementPhaseMessage(state: TaskState, userPrompt: string): string {
  const target = pickPrimaryEditTarget(state, userPrompt);
  const reads = [...state.filesRead];

  return [
    '[Implementação obrigatória — o usuário pediu alteração no código]',
    `Pedido: ${state.goal}`,
    reads.length > 0 ? `Contexto já lido: ${reads.join(', ')}` : '',
    target ? `Edite: \`${target}\` com edit_file replace_lines (números do read_file).` : 'Edite com edit_file replace_lines.',
    '',
    'Se não souber a linha: search_files → read_file start_line/end_line (≤350) → edit_file.',
    'Não responda só com instruções manuais.',
  ].filter(Boolean).join('\n');
}

export function buildPhaseContextBlock(state: TaskState, toolsMode: string): string {
  if (!userRequiresEdits(state, toolsMode)) {
    return '';
  }

  if (state.phase === 'implement') {
    const target = pickPrimaryEditTarget(state, state.goal);
    return [
      '',
      '## Implementação pendente (usuário pediu alteração)',
      target ? `Próximo passo: edit_file replace_lines em \`${target}\`` : 'Próximo passo: edit_file replace_lines (por número de linha)',
      'Leitura limitada: search_files + read_file por trecho (não leia o arquivo inteiro).',
    ].join('\n');
  }

  return [
    '',
    '## Exploração (leitura particionada — estilo Cursor)',
    'Arquivos grandes vêm em blocos de ~350 linhas.',
    'Use read_file → continue_read=true ou start_line=N para o próximo trecho.',
    'Leia só o necessário; depois edit_file + test_project.',
  ].join('\n');
}

export function recordReadFile(state: TaskState, filePath: string): void {
  state.totalReads += 1;
  state.filesRead.add(filePath);
  state.fileReadCounts[filePath] = (state.fileReadCounts[filePath] ?? 0) + 1;
}

export function recordReadTool(state: TaskState, toolName: string, filePath: string | undefined): void {
  if (!READ_TOOL_NAMES.has(toolName)) {
    return;
  }
  state.totalReads += 1;
  if (toolName === 'read_file' && filePath) {
    recordReadFile(state, filePath);
  }
}

export function finishToolIteration(
  state: TaskState,
  hadWriteSuccess: boolean,
  hadReadOnlySuccess: boolean
): void {
  if (hadWriteSuccess) {
    state.consecutiveReadIterations = 0;
    state.forceImplement = false;
    return;
  }
  if (hadReadOnlySuccess) {
    state.consecutiveReadIterations += 1;
  }
}
