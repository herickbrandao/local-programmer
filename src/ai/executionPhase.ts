import { IMPLEMENT_TOOLS, WRITE_TOOLS } from '../config/settings';
import { ToolDefinition } from './types';
import { MessageIntent } from './messageIntent';
import type { TaskState } from './taskTracker';
import { extractFilenamesFromPrompt } from './taskCompletion';
import { isFileFullyRead, getCoverageEntry, getNextUnreadRange } from '../tools/fileReadChunks';
import { FileChange } from './types';
import { validateEditWithinCitation } from './lineCitations';

export type ExecutionPhase = 'explore' | 'implement';

const IMPLEMENT_PHASE_READ_TOOLS = new Set(['read_file', 'read_files', 'search_files']);
const READ_TOOL_NAMES = new Set(['read_file', 'read_files', 'list_files', 'search_files']);
const WRITE_TOOL_NAMES = new Set<string>(WRITE_TOOLS);
const IMPLEMENT_TOOL_NAMES = new Set<string>(IMPLEMENT_TOOLS);

/** Máximo de linhas por leitura na fase implementação (trecho novo ou reverificação) */
const MAX_IMPLEMENT_READ_SPAN = 120;
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

  if (shouldUseEditOnlyTools(state, state.goal)) {
    state.phase = 'implement';
    state.forceImplement = true;
    return;
  }

  if (state.filesChanged.length > 0) {
    const moreEdit = listFilesReadyToEdit(state).length > 0;
    const moreRead = listFilesPendingRead(state, state.goal).length > 0;
    if (!moreEdit && !moreRead) {
      return;
    }
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
  toolsMode: string,
  state?: TaskState
): ToolDefinition[] {
  if (toolsMode !== 'agent' || intent !== 'project_write' || phase === 'explore') {
    return tools;
  }

  if (state && shouldUseEditOnlyTools(state, state.goal)) {
    return tools.filter((tool) => IMPLEMENT_TOOL_NAMES.has(tool.name));
  }

  return tools.filter(
    (tool) => IMPLEMENT_TOOL_NAMES.has(tool.name) || IMPLEMENT_PHASE_READ_TOOLS.has(tool.name)
  );
}

/** Leitura concluída nos arquivos tocados — só edit_file + test_project até editar */
export function shouldUseEditOnlyTools(state: TaskState, userPrompt: string): boolean {
  const ready = listFilesReadyToEdit(state);
  if (ready.length === 0) {
    return false;
  }
  const pendingRead = listFilesPendingRead(state, userPrompt);
  return pendingRead.length === 0;
}

export function buildConcreteEditHint(filePath: string, goal: string): string {
  const lower = filePath.toLowerCase();
  const uiGoal = /bonito|beleza|layout|front-?end|visual|design|moderniz|ui/i.test(goal);
  if (lower.includes('panelhtml') && uiGoal) {
    return [
      'Sugestão concreta (panelHtml.ts):',
      '- edit_file replace_lines start_line=10 end_line=30 — body, font, cores base',
      '- edit_file replace_lines start_line=90 end_line=180 — .chat-container, .message, input, botões',
      '- Variáveis VS Code: var(--vscode-*) — padding, gap, border-radius, box-shadow',
    ].join('\n');
  }
  if (uiGoal && lower.includes('chatview')) {
    return 'Sugestão: edit_file replace_lines nos trechos de UI já lidos neste arquivo.';
  }
  return 'Use edit_file replace_lines com start_line/end_line/content dos trechos N| já lidos.';
}

export function buildMandatoryEditMessage(state: TaskState, userPrompt: string): string {
  const next = pickPrimaryEditTarget(state, userPrompt);
  const ready = listFilesReadyToEdit(state);
  return [
    '[MODO EDITOR — leitura encerrada, implementação obrigatória]',
    `Pedido do usuário: ${state.goal || userPrompt}`,
    next ? `Próximo edit_file: \`${next}\`` : '',
    ready.length > 1 ? `Arquivos aguardando edição: ${ready.join(', ')}` : '',
    buildConcreteEditHint(next ?? '', state.goal || userPrompt),
    '',
    'read_file/read_files e search_files estão DESATIVADOS até salvar alterações.',
    'Chame edit_file replace_lines AGORA. Depois test_project.',
  ].filter(Boolean).join('\n');
}

/** Ainda há leitura ou edição pendente neste pedido (multi-arquivo) */
export function needsMoreFileWork(
  state: TaskState,
  userPrompt: string,
  sessionChanges: FileChange[]
): boolean {
  const changed = new Set(sessionChanges.map((c) => c.file));
  const pendingEdit = listFilesReadyToEdit(state).filter((f) => !changed.has(f));
  if (pendingEdit.length > 0) {
    return true;
  }
  if (listFilesPendingRead(state, userPrompt).length > 0) {
    return true;
  }
  return false;
}

export function buildMultiFileEditContinueMessage(state: TaskState, userPrompt: string): string {
  const pending = listFilesReadyToEdit(state);
  const pendingRead = listFilesPendingRead(state, userPrompt);
  const changed = state.filesChanged;
  return [
    '[Continuar — pedido pode envolver vários arquivos]',
    changed.length > 0 ? `Já alterados: ${changed.join(', ')}` : '',
    pending.length > 0 ? `Próximos edit_file: ${pending.join(', ')}` : '',
    pendingRead.length > 0 ? `Ainda ler (se precisar): ${pendingRead.join(', ')}` : '',
    'Edite cada arquivo relevante com edit_file replace_lines. Depois test_project.',
  ].filter(Boolean).join('\n');
}

/** Arquivos citados no pedido ou já tocados que ainda não foram lidos por completo */
export function listFilesPendingRead(state: TaskState, userPrompt: string): string[] {
  const candidates = new Set<string>([
    ...extractFilenamesFromPrompt(userPrompt).map((f) => f.replace(/\\/g, '/')),
    ...state.filesRead,
  ]);
  return [...candidates].filter((file) => !isFileFullyRead(state.fileReadCoverage, file));
}

/** Arquivos já lidos por completo nesta sessão, ainda sem edit_file */
export function listFilesReadyToEdit(state: TaskState): string[] {
  const changed = new Set(state.filesChanged);
  return [...state.filesRead].filter(
    (file) => isFileFullyRead(state.fileReadCoverage, file) && !changed.has(file)
  );
}

export function buildForceEditAfterReadMessage(state: TaskState, target: string): string {
  const entry = getCoverageEntry(state.fileReadCoverage, target);
  const pending = listFilesPendingRead(state, state.goal);
  const ready = listFilesReadyToEdit(state);
  const isPanelHtml = target.toLowerCase().includes('panelhtml');
  return [
    `[Arquivo \`${target}\` lido por completo (${entry?.totalLines ?? '?'} linhas)]`,
    isPanelHtml
      ? 'CSS/layout: bloco <style> em getPanelHtml() (~linhas 8–400). Use edit_file replace_lines.'
      : 'Use edit_file replace_lines com números N| do read_file.',
    ready.length > 1
      ? `Prontos para editar (já lidos): ${ready.join(', ')}`
      : '',
    pending.length > 0
      ? `Ainda pode ler outros arquivos: ${pending.join(', ')}`
      : 'Todos os arquivos tocados já foram lidos — edite cada um que precisar alterar.',
    'Não reler este arquivo inteiro; reverificação estreita (≤30 linhas) se necessário.',
  ].filter(Boolean).join('\n');
}

export function buildImplementProgressMessage(state: TaskState, userPrompt: string): string {
  const pending = listFilesPendingRead(state, userPrompt);
  const ready = listFilesReadyToEdit(state);
  const reads = [...state.filesRead];

  if (ready.length > 0 && pending.length === 0) {
    return [
      '[Implementação — todos os arquivos lidos]',
      `Pedido: ${state.goal || userPrompt}`,
      `Edite com edit_file: ${ready.join(', ')}`,
      'Depois test_project se aplicável.',
    ].join('\n');
  }

  if (ready.length > 0 && pending.length > 0) {
    return [
      '[Implementação — múltiplos arquivos]',
      `Pedido: ${state.goal || userPrompt}`,
      `Já lidos (edite quando quiser): ${ready.join(', ')}`,
      `Ainda faltam ler: ${pending.join(', ')}`,
      'Pode alternar: edit_file nos lidos OU read_file nos pendentes.',
    ].join('\n');
  }

  return buildImplementPhaseMessage(state, userPrompt);
}

/** Preenche e ajusta start_line/end_line na fase implementação (arquivo alvo) */
export function coerceImplementPhaseRead(
  args: Record<string, unknown>,
  state: TaskState,
  phase: ExecutionPhase
): Record<string, unknown> {
  if (phase !== 'implement') {
    return args;
  }

  const filePath = typeof args.path === 'string' ? args.path : undefined;
  if (!filePath) {
    return args;
  }

  const entry = getCoverageEntry(state.fileReadCoverage, filePath);
  const totalLines = entry?.totalLines;
  const continueRead = args.continue_read === true || args.continue_read === 'true';

  let start = asLineNumber(args.start_line);
  let end = asLineNumber(args.end_line);

  if (continueRead || (start === undefined && end === undefined)) {
    const nextRange = getNextUnreadRange(state.fileReadCoverage, filePath, MAX_IMPLEMENT_READ_SPAN);
    if (nextRange) {
      start = nextRange.start;
      end = nextRange.end;
    }
  }

  if (start !== undefined && end === undefined) {
    end = totalLines
      ? Math.min(start + MAX_IMPLEMENT_READ_SPAN - 1, totalLines)
      : start + MAX_IMPLEMENT_READ_SPAN - 1;
  }

  if (start !== undefined && end !== undefined) {
    if (end < start) {
      end = start;
    }
    const maxEnd = start + MAX_IMPLEMENT_READ_SPAN - 1;
    if (end - start + 1 > MAX_IMPLEMENT_READ_SPAN) {
      end = totalLines ? Math.min(maxEnd, totalLines) : maxEnd;
    }
    if (totalLines && end > totalLines) {
      end = totalLines;
    }
    return { ...args, start_line: start, end_line: end, continue_read: false };
  }

  return args;
}

function pathsMatch(a: string, b: string): boolean {
  const na = a.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  const nb = b.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  return na === nb || na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`);
}

export function getToolBlockReason(
  toolName: string,
  args: Record<string, unknown>,
  filePath: string | undefined,
  state: TaskState,
  toolsMode: string,
  intent: MessageIntent
): string | null {
  if (WRITE_TOOL_NAMES.has(toolName)) {
    if (intent !== 'project_write') {
      return 'Somente leitura — este pedido é investigação/análise, sem alterar arquivos. Use o modo Agente para editar.';
    }
    if (toolsMode === 'analyze') {
      return 'Modo Análise — alterações bloqueadas. Mude para Agente se quiser editar arquivos.';
    }
  }

  if (!userRequiresEdits(state, toolsMode) || intent !== 'project_write') {
    return null;
  }

  if (toolName === 'edit_file' && args.action === 'search_replace') {
    return [
      'search_replace desativado — use replace_lines com start_line/end_line do read_file.',
      'Opcional: verify_content com o texto das linhas (sem prefixo N|).',
    ].join(' ');
  }

  const citeBlock = validateEditWithinCitation(filePath, args, state.citedRanges);
  if (toolName === 'edit_file' && citeBlock) {
    return citeBlock;
  }

  if (toolName === 'modify_file') {
    return 'modify_file desativado no modo Agente — use edit_file replace_lines por número de linha.';
  }

  if (state.phase === 'implement' && READ_TOOL_NAMES.has(toolName)) {
    if (toolName === 'list_files') {
      return 'list_files bloqueado na implementação — use read_file no arquivo alvo ou edit_file.';
    }

    const target = pickPrimaryEditTarget(state, state.goal);

    if (
      (toolName === 'read_file' || toolName === 'read_files')
      && filePath
      && isFileFullyRead(state.fileReadCoverage, filePath)
    ) {
      if (!isNarrowVerificationRead(args)) {
        const pending = listFilesPendingRead(state, state.goal);
        return [
          `read_file bloqueado para \`${filePath}\` — já lido por completo nesta sessão.`,
          'Edite com edit_file replace_lines (releitura estreita ≤30 linhas ainda permitida).',
          pending.length > 0 ? `Outros arquivos pendentes: ${pending.join(', ')}` : '',
        ].filter(Boolean).join(' ');
      }
    }

    if (isAllowedReadInImplement(toolName, args, filePath, state)) {
      return null;
    }

    const cov = filePath ? getCoverageEntry(state.fileReadCoverage, filePath) : undefined;
    const covText = cov && filePath
      ? `${filePath}: ${Math.max(...cov.ranges.map((r) => r.to), 0)}/${cov.totalLines} linhas`
      : [...state.filesRead].join(', ') || '(nenhum)';

    return [
      'Leitura bloqueada — fase de IMPLEMENTAÇÃO.',
      `Contexto: ${covText}.`,
      formatReadArgsSummary(args) ? `Parâmetros: ${formatReadArgsSummary(args)}` : '',
      target ? `Leia só o arquivo alvo: ${target}` : '',
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

  if (!isFileFullyRead(state.fileReadCoverage, filePath)) {
    return true;
  }

  return isNarrowVerificationRead(args);
}

function formatReadArgsSummary(args: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof args.path === 'string') {
    parts.push(`path="${args.path}"`);
  }
  if (args.start_line !== undefined) {
    parts.push(`start_line=${args.start_line}`);
  }
  if (args.end_line !== undefined) {
    parts.push(`end_line=${args.end_line}`);
  }
  if (args.continue_read !== undefined) {
    parts.push(`continue_read=${args.continue_read}`);
  }
  return parts.join(' ');
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
  const cite = state.citedRanges?.[0];
  if (cite) {
    return cite.path;
  }

  const ready = listFilesReadyToEdit(state);
  if (ready.length > 0) {
    return ready[0];
  }

  const pending = listFilesPendingRead(state, userPrompt);
  if (pending.length > 0) {
    return pending[0];
  }

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
  const reads = [...state.filesRead];
  const pending = listFilesPendingRead(state, userPrompt);
  const ready = listFilesReadyToEdit(state);

  return [
    '[Implementação obrigatória — o usuário pediu alteração no código]',
    `Pedido: ${state.goal}`,
    reads.length > 0 ? `Arquivos já tocados: ${reads.join(', ')}` : '',
    ready.length > 0 ? `Prontos para edit_file: ${ready.join(', ')}` : '',
    pending.length > 0 ? `Ainda ler (se necessário): ${pending.join(', ')}` : '',
    'Use edit_file replace_lines nos arquivos lidos; read_file em arquivos novos ou trechos pendentes.',
    'Não responda só com instruções manuais.',
  ].filter(Boolean).join('\n');
}

export function buildPhaseContextBlock(state: TaskState, toolsMode: string): string {
  if (!userRequiresEdits(state, toolsMode)) {
    return '';
  }

  if (state.phase === 'implement') {
    const pending = listFilesPendingRead(state, state.goal);
    const ready = listFilesReadyToEdit(state);
    const editOnly = shouldUseEditOnlyTools(state, state.goal);
    return [
      '',
      '## Implementação pendente (usuário pediu alteração)',
      editOnly
        ? `MODO EDITOR: edit_file em ${ready.join(', ') || 'arquivo lido'} — leitura desativada`
        : ready.length > 0 ? `Editar (já lidos): ${ready.join(', ')}` : 'Próximo passo: edit_file replace_lines',
      pending.length > 0 ? `Ler se faltar contexto: ${pending.join(', ')}` : '',
      editOnly && ready[0] ? buildConcreteEditHint(ready[0], state.goal) : '',
      'Vários arquivos: edite cada um lido. O pedido só termina após alterações reais.',
    ].filter(Boolean).join('\n');
  }

  return [
    '',
    '## Exploração (leitura particionada — estilo Cursor)',
    'Arquivos grandes vêm em blocos de ~120 linhas — cite @arquivo:linhas quando possível.',
    'Vários arquivos: use read_files com paths:[...] numa única chamada.',
    'Leia só o necessário; depois edit_file + test_project.',
  ].join('\n');
}

export function recordReadFile(state: TaskState, filePath: string): void {
  state.totalReads += 1;
  state.filesRead.add(filePath);
  state.fileReadCounts[filePath] = (state.fileReadCounts[filePath] ?? 0) + 1;
}

export function recordReadTool(
  state: TaskState,
  toolName: string,
  filePath: string | undefined,
  batchPaths?: string[]
): void {
  if (!READ_TOOL_NAMES.has(toolName)) {
    return;
  }
  if (toolName === 'read_files' && batchPaths?.length) {
    state.totalReads += 1;
    for (const p of batchPaths) {
      recordReadFile(state, p);
    }
    return;
  }
  state.totalReads += 1;
  if ((toolName === 'read_file' || toolName === 'read_files') && filePath) {
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
