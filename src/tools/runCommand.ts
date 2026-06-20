import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { Tool, ToolContext, ToolResult } from './types';

const execAsync = promisify(exec);

export class RunCommandTool implements Tool {
  name = 'run_command';
  description = 'Executa um comando no terminal';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const command = args.command as string;
    const cwd = (args.cwd as string) ?? context.workspaceRoot;

    if (!command) {
      return { success: false, output: 'Parâmetro "command" é obrigatório' };
    }

    const fullCwd = path.isAbsolute(cwd) ? cwd : path.join(context.workspaceRoot, cwd);

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: fullCwd,
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      return {
        success: true,
        output: output || '(comando executado sem saída)',
        data: { command, cwd: fullCwd, stdout, stderr },
      };
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string; message?: string };
      const output = [
        error.stdout ?? '',
        error.stderr ?? '',
        error.message ?? String(err),
      ].filter(Boolean).join('\n').trim();

      return { success: false, output: `Erro ao executar "${command}":\n${output}` };
    }
  }
}
