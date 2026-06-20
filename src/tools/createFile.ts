import * as fs from 'fs/promises';
import * as path from 'path';
import { resolveWorkspacePath, normalizeWorkspacePath } from './pathUtils';
import { Tool, ToolContext, ToolResult } from './types';

export class CreateFileTool implements Tool {
  name = 'create_file';
  description = 'Cria ou sobrescreve um arquivo';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const rawPath = args.path as string;
    const content = args.content as string;

    if (!rawPath || content === undefined) {
      return { success: false, output: 'Parâmetros "path" e "content" são obrigatórios' };
    }

    const filePath = normalizeWorkspacePath(context.workspaceRoot, rawPath);
    const fullPath = resolveWorkspacePath(context.workspaceRoot, filePath);

    try {
      let oldContent = '';
      let existed = false;

      try {
        oldContent = await fs.readFile(fullPath, 'utf-8');
        existed = true;
      } catch { /* novo arquivo */ }

      if (existed && oldContent.split('\n').length > 40) {
        return {
          success: false,
          output: `Arquivo ${filePath} já existe (${oldContent.split('\n').length} linhas). Use edit_file para alterações parciais.`,
        };
      }
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');

      const action = existed ? 'modify' : 'create';
      const verb = existed ? 'atualizado' : 'criado';

      return {
        success: true,
        output: `Arquivo ${verb}: ${filePath}`,
        data: { path: filePath, oldContent, newContent: content, content, action },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Erro ao salvar ${filePath}: ${message}` };
    }
  }
}
