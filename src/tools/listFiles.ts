import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from './glob';
import { Tool, ToolContext, ToolResult } from './types';

export class ListFilesTool implements Tool {
  name = 'list_files';
  description = 'Lista arquivos do projeto';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const basePath = (args.path as string) ?? '.';
    const pattern = (args.pattern as string) ?? '**/*';
    const fullPath = path.join(context.workspaceRoot, basePath);

    try {
      const searchPattern = path.join(fullPath, pattern).replace(/\\/g, '/');
      const files = await glob(searchPattern, {
        ignore: ['**/node_modules/**', '**/.git/**', '**/.ai-history/**', '**/.ai-context/**', '**/out/**', '**/dist/**'],
      });

      const relative = files
        .map((f) => path.relative(context.workspaceRoot, f).replace(/\\/g, '/'))
        .sort();

      return {
        success: true,
        output: `${relative.length} arquivos encontrados:\n${relative.join('\n')}`,
        data: { files: relative },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Erro ao listar arquivos: ${message}` };
    }
  }
}

export class SearchFilesTool implements Tool {
  name = 'search_files';
  description = 'Busca texto nos arquivos';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const query = args.query as string;
    const filePattern = (args.file_pattern as string) ?? '**/*';

    if (!query) {
      return { success: false, output: 'Parâmetro "query" é obrigatório' };
    }

    try {
      const searchPattern = path.join(context.workspaceRoot, filePattern).replace(/\\/g, '/');
      const files = await glob(searchPattern, {
        ignore: ['**/node_modules/**', '**/.git/**', '**/.ai-history/**'],
      });

      const results: string[] = [];

      for (const file of files.slice(0, 200)) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          const lines = content.split('\n');
          lines.forEach((line, i) => {
            if (line.toLowerCase().includes(query.toLowerCase())) {
              const rel = path.relative(context.workspaceRoot, file).replace(/\\/g, '/');
              results.push(`${rel}:${i + 1}: ${line.trim()}`);
            }
          });
        } catch { /* skip binary/unreadable */ }
      }

      if (results.length === 0) {
        return { success: true, output: `Nenhum resultado para "${query}"` };
      }

      const output = results.slice(0, 50).join('\n');
      const suffix = results.length > 50 ? `\n... e mais ${results.length - 50} resultados` : '';

      return {
        success: true,
        output: `${results.length} resultados:\n${output}${suffix}`,
        data: { results },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Erro na busca: ${message}` };
    }
  }
}
