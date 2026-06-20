import * as fs from 'fs/promises';
import { applyFileEdit, EditAction, EditFileInput } from './fileEditEngine';
import { normalizeWorkspacePath, resolveWorkspacePath } from './pathUtils';
import { Tool, ToolContext, ToolResult } from './types';

export class EditFileTool implements Tool {
  name = 'edit_file';
  description = 'Edita trechos específicos de um arquivo (substituição, linhas, inserção ou remoção)';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const rawPath = args.path as string;
    const action = args.action as EditAction;

    if (!rawPath || !action) {
      return { success: false, output: 'Parâmetros "path" e "action" são obrigatórios' };
    }

    const validActions: EditAction[] = ['search_replace', 'replace_lines', 'insert_lines', 'delete_lines'];
    if (!validActions.includes(action)) {
      return { success: false, output: `action inválida. Use: ${validActions.join(', ')}` };
    }

    const filePath = normalizeWorkspacePath(context.workspaceRoot, rawPath);
    const fullPath = resolveWorkspacePath(context.workspaceRoot, filePath);

    const input: EditFileInput = {
      path: filePath,
      action,
      old_text: args.old_text as string | undefined,
      new_text: args.new_text as string | undefined,
      start_line: asLine(args.start_line),
      end_line: asLine(args.end_line),
      after_line: asLine(args.after_line),
      content: args.content as string | undefined,
      verify_content: args.verify_content as string | undefined,
    };

    try {
      let currentContent = '';
      try {
        currentContent = await fs.readFile(fullPath, 'utf-8');
      } catch {
        return { success: false, output: `Arquivo não encontrado: ${filePath}. Use create_file para arquivos novos.` };
      }

      const result = applyFileEdit(currentContent, input);
      if (!result.success) {
        return { success: false, output: result.message };
      }

      if (result.newContent === result.oldContent) {
        return {
          success: true,
          output: `Nenhuma alteração em ${filePath}`,
          data: { path: filePath, oldContent: result.oldContent, newContent: result.newContent, action: 'modify', unchanged: true },
        };
      }

      await fs.writeFile(fullPath, result.newContent, 'utf-8');
      const range = result.linesChanged
        ? ` (linhas ${result.linesChanged.from}-${result.linesChanged.to})`
        : '';

      return {
        success: true,
        output: `${result.message}${range}: ${filePath}`,
        data: {
          path: filePath,
          oldContent: result.oldContent,
          newContent: result.newContent,
          action: 'modify',
          editAction: action,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Erro ao editar ${filePath}: ${message}` };
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
