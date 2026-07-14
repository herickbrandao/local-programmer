import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from './glob';
import { Tool, ToolContext, ToolResult } from './types';

const SEARCH_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.ai-history/**',
  '**/.ai-context/**',
  '**/out/**',
  '**/dist/**',
  '**/coverage/**',
  '**/*.min.js',
  '**/*.map',
  '**/package-lock.json',
];

const CODE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.cs', '.rb',
  '.php', '.vue', '.svelte', '.css', '.scss',
  '.html', '.md', '.json', '.yml', '.yaml',
]);

const MAX_FILES_SCAN = 150;
const MAX_FILE_BYTES = 512_000;
const MAX_RESULTS = 40;
const EARLY_STOP_RESULTS = 40;

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
        ignore: SEARCH_IGNORE,
      });

      const relative = files
        .map((f) => path.relative(context.workspaceRoot, f).replace(/\\/g, '/'))
        .sort()
        .slice(0, 300);

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

function normalizeSearchPattern(filePattern: string): string {
  const pattern = filePattern.trim().replace(/\\/g, '/');
  if (!pattern || pattern === '**/*') {
    return '**/*.{ts,tsx,js,jsx,py,md,json,css,html}';
  }
  if (pattern.includes('/')) {
    return pattern.startsWith('**/') ? pattern : `**/${pattern}`;
  }
  if (pattern.startsWith('**')) {
    return pattern;
  }
  return `**/${pattern}`;
}

function prefersCodeFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return CODE_EXT.has(ext);
}

export class SearchFilesTool implements Tool {
  name = 'search_files';
  description = 'Busca texto nos arquivos (padrão: fontes de código)';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const rawQuery = args.query as string;
    const filePattern = (args.file_pattern as string) ?? '**/*';

    if (!rawQuery) {
      return { success: false, output: 'Parâmetro "query" é obrigatório' };
    }

    const queries = buildSearchQueries(rawQuery);

    try {
      const searchPattern = path
        .join(context.workspaceRoot, normalizeSearchPattern(filePattern))
        .replace(/\\/g, '/');
      const files = await glob(searchPattern, { ignore: SEARCH_IGNORE });

      const ranked = files
        .filter((f) => prefersCodeFile(f) || filePattern !== '**/*')
        .slice(0, MAX_FILES_SCAN);

      const results: string[] = [];

      for (const file of ranked) {
        if (results.length >= EARLY_STOP_RESULTS) {
          break;
        }
        try {
          const stat = await fs.stat(file);
          if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
            continue;
          }
          const content = await fs.readFile(file, 'utf-8');
          const lines = content.split('\n');
          const rel = path.relative(context.workspaceRoot, file).replace(/\\/g, '/');
          for (let i = 0; i < lines.length; i++) {
            const lineLower = lines[i].toLowerCase();
            if (queries.some((q) => lineLower.includes(q))) {
              results.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
              if (results.length >= EARLY_STOP_RESULTS) {
                break;
              }
            }
          }
        } catch { /* skip binary/unreadable */ }
      }

      if (results.length === 0) {
        return {
          success: true,
          output: `Nenhum resultado para "${rawQuery}". `
            + 'Dica: cite @arquivo:linhas ou use read_file no arquivo alvo.',
        };
      }

      const output = results.slice(0, MAX_RESULTS).join('\n');
      return {
        success: true,
        output: `${results.length} resultado(s):\n${output}`,
        data: { results },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Erro na busca: ${message}` };
    }
  }
}

function buildSearchQueries(rawQuery: string): string[] {
  const q = rawQuery.trim().toLowerCase();
  const variants = new Set<string>([q]);
  variants.add(q.replace(/\s*\{\s*$/, '').trim());
  variants.add(q.replace(/^\./, '').replace(/\s*\{$/, '').trim());
  if (q.includes('.') && !q.startsWith('.')) {
    variants.add(`.${q.replace(/\s*\{$/, '').trim()}`);
  }
  return [...variants].filter((v) => v.length >= 2);
}
