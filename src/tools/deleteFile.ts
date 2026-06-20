import * as fs from 'fs/promises';
import { normalizeWorkspacePath, resolveWorkspacePath } from './pathUtils';
import { Tool, ToolContext, ToolResult } from './types';

export class DeleteFileTool implements Tool {
  name = 'delete_file';
  description = 'Exclui um arquivo';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const rawPath = args.path as string;
    if (!rawPath) {
      return { success: false, output: 'Parâmetro "path" é obrigatório' };
    }

    const filePath = normalizeWorkspacePath(context.workspaceRoot, rawPath);
    const fullPath = resolveWorkspacePath(context.workspaceRoot, filePath);

    try {
      let oldContent = '';
      try {
        oldContent = await fs.readFile(fullPath, 'utf-8');
      } catch {
        return { success: false, output: `Arquivo não encontrado: ${filePath}` };
      }

      await fs.unlink(fullPath);

      return {
        success: true,
        output: `Arquivo excluído: ${filePath}`,
        data: { path: filePath, oldContent, newContent: '', action: 'delete' },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Erro ao excluir ${filePath}: ${message}` };
    }
  }
}
