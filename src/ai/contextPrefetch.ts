import * as fs from 'fs/promises';
import { extractFilenamesFromPrompt } from './taskCompletion';
import { parseLineCitations } from './lineCitations';
import { batchReadFiles } from '../tools/readFiles';
import { resolveWorkspacePath } from '../tools/pathUtils';
import { FileReadCoverageMap, recordReadRange } from '../tools/fileReadChunks';
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

/** Sempre úteis quando o pedido é genérico (“melhorar o projeto”) */
const DEFAULT_SEED_FILES = [
  'package.json',
  'tsconfig.json',
  'README.md',
  'src/extension.ts',
  'src/ai/agentController.ts',
  'src/ai/promptManager.ts',
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
    .filter((t) => t.length >= 4)
    .slice(0, 6);
  const found = new Set<string>();
  for (const token of tokens) {
    for (const hit of projectMemory.search(token, 8)) {
      const path = hit.split(':')[0];
      if (path) {
        found.add(path);
      }
    }
    if (found.size >= 6) {
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
  if (/perform|otimiz|lent|rápid|rapido|veloc|token|itera|loop|projeto/i.test(goal)) {
    hints.push(...PERF_HINT_FILES);
  }
  if (/ui|painel|chat|layout|accordion|visual|css/i.test(goal)) {
    hints.push(...UI_HINT_FILES);
  }
  if (/agente|tool|edit_file|plano|pipeline/i.test(goal)) {
    hints.push(...AGENT_HINT_FILES);
  }

  const fromMemorySearch = searchMemoryPaths(projectMemory, goal);
  const candidates = [
    ...new Set([
      ...cited,
      ...named,
      ...atPaths,
      ...hints,
      ...fromMemorySearch,
      ...DEFAULT_SEED_FILES,
    ]),
  ];

  const fromRam = pathsFromMemory(projectMemory, candidates);
  if (fromRam.length > 0) {
    return fromRam.slice(0, 6);
  }

  const existing: string[] = [];
  for (const path of candidates.slice(0, 12)) {
    if (await fileExists(workspaceRoot, path)) {
      existing.push(path);
    }
  }
  return existing.slice(0, 6);
}

export interface PrefetchResult {
  applied: boolean;
  paths: string[];
  output: string;
}

/**
 * Pré-carrega trechos no disco em paralelo e registra cobertura —
 * o modelo já recebe contexto sem pedir read_file um a um.
 */
export async function prefetchProjectContext(
  workspaceRoot: string,
  goal: string,
  taskState: TaskState,
  projectMemory?: ProjectMemory
): Promise<PrefetchResult> {
  const paths = await inferPrefetchPaths(workspaceRoot, goal, projectMemory);
  if (paths.length === 0) {
    return { applied: false, paths: [], output: '' };
  }

  const result = await batchReadFiles(workspaceRoot, paths, {
    maxLinesPerFile: 70,
    fileReadCoverage: taskState.fileReadCoverage,
    projectMemory,
  });

  const data = result.data as {
    files?: Array<{ path?: string; startLine?: number; endLine?: number; totalLines?: number }>;
    paths?: string[];
  } | undefined;

  for (const file of data?.files ?? []) {
    if (!file.path || !file.startLine || !file.endLine) {
      continue;
    }
    taskState.filesRead.add(file.path);
    recordReadRange(
      taskState.fileReadCoverage,
      file.path,
      file.startLine,
      file.endLine,
      file.totalLines ?? file.endLine
    );
  }

  return {
    applied: result.success,
    paths: data?.paths ?? paths,
    output: result.output,
  };
}

export function formatPrefetchMessage(prefetch: PrefetchResult): string {
  return [
    '[Contexto lido da memória RAM / disco — lote]',
    `Arquivos: ${prefetch.paths.join(', ')}`,
    '',
    'Estes trechos já foram lidos pelo host. Analise com base neles.',
    'Se precisar de outro arquivo, chame read_files (cai na RAM e, se faltar, no disco).',
    'Só declare falta de acesso se uma leitura específica falhar.',
    '',
    prefetch.output,
  ].join('\n');
}

export type { FileReadCoverageMap };
