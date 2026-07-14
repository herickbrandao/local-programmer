import * as fs from 'fs/promises';
import { extractFilenamesFromPrompt } from './taskCompletion';
import { parseLineCitations } from './lineCitations';
import { batchReadFiles } from '../tools/readFiles';
import { resolveWorkspacePath } from '../tools/pathUtils';
import { TaskState } from './taskTracker';
import type { ProjectMemory } from '../workspace/projectMemory';

const PERF_HINT_FILES = [
  'src/ai/agentController.ts',
  'src/ai/contextBudget.ts',
  'src/ai/iterationGuard.ts',
  'src/ai/executionPhase.ts',
  'src/tools/listFiles.ts',
  'src/tools/readFile.ts',
  'src/workspace/contextManager.ts',
];

const UI_HINT_FILES = [
  'src/ui/panelHtml.ts',
  'src/ui/chatViewProvider.ts',
];

const AGENT_HINT_FILES = [
  'src/ai/agentController.ts',
  'src/ai/planDrivenRunner.ts',
  'src/ai/editPlanPipeline.ts',
  'src/ai/promptManager.ts',
];

/** Só quando não há nenhum path explícito/hint — e ainda assim poucos arquivos */
const FALLBACK_SEED_FILES = [
  'package.json',
  'README.md',
  'src/extension.ts',
];

async function fileExists(workspaceRoot: string, rel: string): Promise<boolean> {
  try {
    await fs.access(resolveWorkspacePath(workspaceRoot, rel));
    return true;
  } catch {
    return false;
  }
}

function pathsFromMemory(projectMemory: ProjectMemory | undefined, candidates: string[]): string[] {
  if (!projectMemory?.isReady()) {
    return [];
  }
  const out: string[] = [];
  for (const c of candidates) {
    const hit = projectMemory.get(c);
    if (hit) {
      out.push(hit.path);
    }
  }
  return out;
}

function searchMemoryPaths(projectMemory: ProjectMemory | undefined, goal: string): string[] {
  if (!projectMemory?.isReady()) {
    return [];
  }
  const tokens = goal
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/i)
    .filter((t) => t.length >= 5)
    .slice(0, 5);
  const found = new Set<string>();
  for (const token of tokens) {
    for (const hit of projectMemory.search(token, 6)) {
      const path = hit.split(':')[0];
      if (path && !/\.(md|json|svg)$/i.test(path)) {
        found.add(path);
      }
    }
    if (found.size >= 4) {
      break;
    }
  }
  return [...found];
}

/** Heurística local de alvos — sem chamar o modelo */
export async function inferPrefetchPaths(
  workspaceRoot: string,
  goal: string,
  projectMemory?: ProjectMemory
): Promise<string[]> {
  const cited = parseLineCitations(goal).map((c) => c.path);
  const named = extractFilenamesFromPrompt(goal).map((f) => f.replace(/\\/g, '/'));
  const atPaths = [...goal.matchAll(/@([^\s@:]+)(?::\d+(?:-\d+)?)?/g)]
    .map((m) => m[1].replace(/\\/g, '/'))
    .filter((p) => !p.startsWith('msg:'));

  const hints: string[] = [];
  if (/perform|otimiz|lent|rápid|rapido|veloc|token|itera|loop/i.test(goal)) {
    hints.push(...PERF_HINT_FILES);
  }
  if (/ui|painel|chat|layout|accordion|visual|css/i.test(goal)) {
    hints.push(...UI_HINT_FILES);
  }
  if (/agente|tool|edit_file|plano|pipeline/i.test(goal)) {
    hints.push(...AGENT_HINT_FILES);
  }

  const fromMemorySearch = searchMemoryPaths(projectMemory, goal);
  const primary = [
    ...new Set([...cited, ...named, ...atPaths, ...hints, ...fromMemorySearch]),
  ];

  const candidates =
    primary.length > 0
      ? primary
      : FALLBACK_SEED_FILES;

  const fromRam = pathsFromMemory(projectMemory, candidates);
  if (fromRam.length > 0) {
    return fromRam.slice(0, 4);
  }

  const existing: string[] = [];
  for (const path of candidates.slice(0, 10)) {
    if (await fileExists(workspaceRoot, path)) {
      existing.push(path);
    }
  }
  return existing.slice(0, 4);
}

export interface PrefetchResult {
  applied: boolean;
  paths: string[];
  output: string;
  hasMore: boolean;
}

/**
 * Pré-carrega trechos para o modelo analisar mais rápido.
 * NÃO marca cobertura de leitura no TaskState — evita forceImplement /
 * “arquivo pronto para editar” com só o topo do arquivo.
 */
export async function prefetchProjectContext(
  workspaceRoot: string,
  goal: string,
  _taskState: TaskState,
  projectMemory?: ProjectMemory
): Promise<PrefetchResult> {
  const paths = await inferPrefetchPaths(workspaceRoot, goal, projectMemory);
  if (paths.length === 0) {
    return { applied: false, paths: [], output: '', hasMore: false };
  }

  const result = await batchReadFiles(workspaceRoot, paths, {
    maxLinesPerFile: 100,
    projectMemory,
  });

  const data = result.data as {
    files?: Array<{ hasMore?: boolean }>;
    paths?: string[];
  } | undefined;

  const hasMore = (data?.files ?? []).some((f) => f.hasMore);

  return {
    applied: result.success,
    paths: data?.paths ?? paths,
    output: result.output,
    hasMore,
  };
}

export function formatPrefetchMessage(prefetch: PrefetchResult): string {
  const lines = [
    '[Contexto lido da memória RAM / disco — lote]',
    `Arquivos (trechos iniciais): ${prefetch.paths.join(', ')}`,
    '',
    'Isto é um ADIANTAMENTO parcial — não é o arquivo inteiro.',
    'Use estes trechos para orientar a análise.',
    'Antes de edit_file: se o trecho alvo não estiver abaixo (ou houver “… há mais”),',
    'chame read_files/read_file com start_line/end_line no intervalo certo.',
    'NUNCA invente código que não apareceu nestes trechos ou no retorno das tools.',
  ];
  if (prefetch.hasMore) {
    lines.push('ATENÇÃO: um ou mais arquivos têm mais linhas — continue_read ou start_line=N é obrigatório antes de editar o resto.');
  }
  lines.push('', prefetch.output);
  return lines.join('\n');
}
