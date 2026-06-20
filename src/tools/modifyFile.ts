import * as fs from 'fs/promises';
import { applyFileEdit, validateNoFullOverwrite } from './fileEditEngine';
import { normalizeWorkspacePath, resolveWorkspacePath } from './pathUtils';
import { Tool, ToolContext, ToolResult } from './types';

export class ModifyFileTool implements Tool {
  name = 'modify_file';
  description = 'Substitui um trecho exato (old_content → new_content). Preferir edit_file.';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const rawPath = args.path as string;
    const newContent = args.new_content as string;
    const oldContent = args.old_content as string | undefined;

    if (!rawPath || newContent === undefined) {
      return { success: false, output: 'Parâmetros "path" e "new_content" são obrigatórios' };
    }

    const filePath = normalizeWorkspacePath(context.workspaceRoot, rawPath);
    const fullPath = resolveWorkspacePath(context.workspaceRoot, filePath);

    try {
      let currentContent = '';
      try {
        currentContent = await fs.readFile(fullPath, 'utf-8');
      } catch {
        return { success: false, output: `Arquivo não encontrado: ${filePath}. Use create_file para criar.` };
      }

      const blockReason = validateNoFullOverwrite(oldContent, newContent, currentContent.length);
      if (blockReason) {
        return { success: false, output: `${blockReason} Exemplo: edit_file com action search_replace.` };
      }

      if (!oldContent) {
        return {
          success: false,
          output: 'modify_file exige old_content (trecho exato a substituir). Use edit_file para edições por linha.',
        };
      }

      const result = applyFileEdit(currentContent, {
        path: filePath,
        action: 'search_replace',
        old_text: oldContent,
        new_text: newContent,
      });

      if (!result.success) {
        return { success: false, output: result.message };
      }

      if (result.newContent === result.oldContent) {
        return {
          success: true,
          output: `Arquivo ${filePath} já contém o trecho solicitado.`,
          data: { path: filePath, oldContent: currentContent, newContent, action: 'modify', unchanged: true },
        };
      }

      await fs.writeFile(fullPath, result.newContent, 'utf-8');
      return {
        success: true,
        output: `Trecho substituído em ${filePath}`,
        data: { path: filePath, oldContent: result.oldContent, newContent: result.newContent, action: 'modify' },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Erro ao modificar ${filePath}: ${message}` };
    }
  }
}
