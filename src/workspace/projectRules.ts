import * as fs from 'fs/promises';
import * as path from 'path';

const RULE_CANDIDATES = [
  '.local-programmer/rules.md',
  '.local-programmer/RULES.md',
  '.ai-settings/rules.md',
  'AGENTS.md',
];

/** Carrega regras versionáveis do projeto (estilo Continue rules). */
export async function loadProjectRules(workspaceRoot: string): Promise<string> {
  for (const rel of RULE_CANDIDATES) {
    try {
      const full = path.join(workspaceRoot, rel);
      const content = await fs.readFile(full, 'utf-8');
      const trimmed = content.trim();
      if (trimmed) {
        return [`## Regras do projeto (${rel})`, trimmed].join('\n');
      }
    } catch {
      // próximo candidato
    }
  }
  return '';
}
