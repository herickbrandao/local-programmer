import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Tool, ToolContext, ToolResult } from './types';

const execAsync = promisify(exec);

interface PackageScripts {
  test?: string;
  compile?: string;
  build?: string;
  lint?: string;
  [key: string]: string | undefined;
}

export class TestProjectTool implements Tool {
  name = 'test_project';
  description = 'Executa testes/compilação do projeto (npm run compile, test, etc.)';

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const requestedScript = args.script as string | undefined;
    const root = context.workspaceRoot;

    try {
      const pm = await detectPackageManager(root);
      const scripts = await readScripts(root);
      const script = requestedScript ?? pickDefaultScript(scripts);

      if (!script) {
        return {
          success: false,
          output: 'Nenhum script test/compile/build encontrado em package.json. Passe script explícito ou use run_command.',
        };
      }

      if (requestedScript && scripts[requestedScript] === undefined) {
        const available = Object.keys(scripts).join(', ') || '(nenhum)';
        return {
          success: false,
          output: `Script "${requestedScript}" não existe. Disponíveis: ${available}`,
        };
      }

      const command = `${pm} run ${script}`;
      const { stdout, stderr } = await execAsync(command, {
        cwd: root,
        timeout: 180000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      return {
        success: true,
        output: `✓ ${command}\n\n${output || '(sem saída — sucesso)'}`,
        data: { command, script, stdout, stderr },
      };
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string; message?: string };
      const output = [
        error.stdout ?? '',
        error.stderr ?? '',
        error.message ?? String(err),
      ].filter(Boolean).join('\n').trim();

      return {
        success: false,
        output: `Falha ao testar projeto:\n${output}`,
        data: { failed: true },
      };
    }
  }
}

async function detectPackageManager(root: string): Promise<'npm' | 'pnpm' | 'yarn'> {
  try {
    await fs.access(path.join(root, 'pnpm-lock.yaml'));
    return 'pnpm';
  } catch {
    // continue
  }
  try {
    await fs.access(path.join(root, 'yarn.lock'));
    return 'yarn';
  } catch {
    // continue
  }
  return 'npm';
}

async function readScripts(root: string): Promise<PackageScripts> {
  try {
    const raw = await fs.readFile(path.join(root, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as { scripts?: PackageScripts };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

function pickDefaultScript(scripts: PackageScripts): string | null {
  const order = ['compile', 'test', 'build', 'lint'] as const;
  for (const key of order) {
    if (scripts[key]) {
      return key;
    }
  }
  return null;
}
