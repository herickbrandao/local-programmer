import * as fs from 'fs/promises';
import {
  buildReadOutput,
  DEFAULT_CHUNK_LINES,
  formatNumberedLines,
  isRangeFullyRead,
  resolveReadRange,
} from './fileReadChunks';
import { normalizeWorkspacePath, resolveWorkspacePath } from './pathUtils';
import { Tool, ToolContext, ToolResult } from './types';
import { ReadFilesTool } from './readFiles';

export class ReadFileTool implements Tool {
  name = 'read_file';
  description =
    'Lê arquivo ou trecho. Para vários arquivos, use paths:["a.ts","b.ts"] (lote) ou a tool read_files.';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    if (Array.isArray(args.paths) && args.paths.length > 0) {
      return new ReadFilesTool().execute(args, context);
    }

    const rawPath = args.path as string;
    if (!rawPath) {
      return { success: false, output: 'Parâmetro "path" (ou paths[]) é obrigatório' };
    }

    const filePath = normalizeWorkspacePath(context.workspaceRoot, rawPath);
    const fullPath = resolveWorkspacePath(context.workspaceRoot, filePath);

    const startLine = asLine(args.start_line);
    const endLine = asLine(args.end_line);
    const continueRead = args.continue_read === true || args.continue_read === 'true';
    const chunkSize = asLine(args.chunk_size) ?? DEFAULT_CHUNK_LINES;

    const fileCoverage = context.fileReadCoverage?.[filePath];

    try {
      const cached = context.projectMemory?.get(filePath);
      const content = cached?.content ?? await fs.readFile(fullPath, 'utf-8');
      const allLines = content.split('\n');
      const totalLines = allLines.length;

      const range = resolveReadRange(
        totalLines,
        startLine,
        endLine,
        continueRead,
        fileCoverage,
        chunkSize
      );

      if (continueRead && range.from > totalLines) {
        return {
          success: true,
          output: `Arquivo ${filePath} (${totalLines} linhas) — já lido por completo nesta sessão.`,
          data: { path: filePath, complete: true, totalLines },
        };
      }

      if (
        startLine !== undefined
        && fileCoverage
        && isRangeFullyRead(context.fileReadCoverage ?? {}, filePath, range.from, range.to)
      ) {
        return {
          success: true,
          output: [
            `Trecho ${range.from}-${range.to} de ${filePath} já foi lido nesta sessão.`,
            range.hasMore && range.nextStart
              ? `Próximo trecho novo: start_line=${range.nextStart} ou continue_read=true`
              : 'Use edit_file se já tiver contexto suficiente.',
          ].join(' '),
          data: { path: filePath, duplicate: true, startLine: range.from, endLine: range.to },
        };
      }

      const slice = allLines.slice(range.from - 1, range.to);
      const numbered = formatNumberedLines(slice, range.from);
      const output = buildReadOutput(
        filePath,
        numbered,
        range.from,
        range.to,
        totalLines,
        range.hasMore,
        range.nextStart,
        continueRead
      );

      return {
        success: true,
        output,
        data: {
          path: filePath,
          content: slice.join('\n'),
          startLine: range.from,
          endLine: range.to,
          totalLines,
          hasMore: range.hasMore,
          nextStart: range.nextStart,
          chunkSize,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Erro ao ler ${filePath}: ${message}` };
    }
  }
}

function asLine(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isFinite(n) ? n : undefined;
}
