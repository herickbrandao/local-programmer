import * as fs from 'fs/promises';
import { formatNumberedLines, resolveReadRange } from './fileReadChunks';
import { normalizeWorkspacePath, resolveWorkspacePath } from './pathUtils';
import { Tool, ToolContext, ToolResult } from './types';

const MAX_BATCH_FILES = 8;
const DEFAULT_LINES_PER_FILE = 80;

export interface BatchReadItem {
  path: string;
  start_line?: number;
  end_line?: number;
}

function parseItems(args: Record<string, unknown>): BatchReadItem[] {
  if (Array.isArray(args.files)) {
    return args.files
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
      .map((f) => ({
        path: String(f.path ?? ''),
        start_line: asLine(f.start_line),
        end_line: asLine(f.end_line),
      }))
      .filter((f) => f.path);
  }

  const paths = args.paths;
  if (Array.isArray(paths)) {
    return paths.map((p) => ({ path: String(p) })).filter((f) => f.path);
  }

  if (typeof args.path === 'string' && args.path) {
    return [{
      path: args.path,
      start_line: asLine(args.start_line),
      end_line: asLine(args.end_line),
    }];
  }

  return [];
}

async function readOne(
  item: BatchReadItem,
  context: ToolContext,
  maxLines: number
): Promise<{ path: string; output: string; data?: Record<string, unknown>; ok: boolean }> {
  const filePath = normalizeWorkspacePath(context.workspaceRoot, item.path);
  const fullPath = resolveWorkspacePath(context.workspaceRoot, filePath);

  try {
    const fromRam = context.projectMemory
      ? await context.projectMemory.getFreshContent(filePath)
      : undefined;
    const content = fromRam ?? await fs.readFile(fullPath, 'utf-8');
    const allLines = content.split('\n');
    const totalLines = allLines.length;
    const fileCoverage = context.fileReadCoverage?.[filePath];

    const range = resolveReadRange(
      totalLines,
      item.start_line,
      item.end_line,
      false,
      fileCoverage,
      maxLines
    );

    const slice = allLines.slice(range.from - 1, range.to);
    const numbered = formatNumberedLines(slice, range.from);
    const header = `### ${filePath} (linhas ${range.from}-${range.to}/${totalLines})`;
    const more = range.hasMore && range.nextStart
      ? `\n(… há mais — continue com start_line=${range.nextStart})`
      : '';

    return {
      path: filePath,
      ok: true,
      output: `${header}\n${numbered}${more}`,
      data: {
        path: filePath,
        startLine: range.from,
        endLine: range.to,
        totalLines,
        hasMore: range.hasMore,
        nextStart: range.nextStart,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      path: filePath,
      ok: false,
      output: `### ${filePath}\nErro: ${message}`,
    };
  }
}

/**
 * Lê vários arquivos em paralelo no disco e devolve um único resultado —
 * evita N idas ao modelo (um read_file por arquivo).
 */
export class ReadFilesTool implements Tool {
  name = 'read_files';
  description =
    'Lê VÁRIOS arquivos de uma vez (paralelo). Prefira isto a vários read_file.';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const items = parseItems(args).slice(0, MAX_BATCH_FILES);
    if (items.length === 0) {
      return {
        success: false,
        output: 'Informe paths: ["a.ts","b.ts"] ou files: [{path, start_line?, end_line?}]',
      };
    }

    const maxLines = asLine(args.max_lines_per_file) ?? DEFAULT_LINES_PER_FILE;
    const results = await Promise.all(items.map((item) => readOne(item, context, maxLines)));

    const ok = results.filter((r) => r.ok).length;
    const output = [
      `Leitura em lote: ${ok}/${results.length} arquivo(s)`,
      '',
      ...results.map((r) => r.output),
    ].join('\n\n');

    return {
      success: ok > 0,
      output,
      data: {
        batch: true,
        files: results.map((r) => r.data).filter(Boolean),
        paths: results.filter((r) => r.ok).map((r) => r.path),
      },
    };
  }
}

/** Helper reutilizável (prefetch / merge de read_file) */
export async function batchReadFiles(
  workspaceRoot: string,
  paths: string[],
  options?: {
    maxLinesPerFile?: number;
    fileReadCoverage?: ToolContext['fileReadCoverage'];
    projectMemory?: ToolContext['projectMemory'];
  }
): Promise<ToolResult> {
  const tool = new ReadFilesTool();
  return tool.execute(
    { paths, max_lines_per_file: options?.maxLinesPerFile ?? DEFAULT_LINES_PER_FILE },
    {
      workspaceRoot,
      fileReadCoverage: options?.fileReadCoverage,
      projectMemory: options?.projectMemory,
    }
  );
}

function asLine(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isFinite(n) ? n : undefined;
}
