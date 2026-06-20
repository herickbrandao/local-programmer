import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from '../tools/glob';

export interface ProjectFile {
  path: string;
  language: string;
  size: number;
  lines: number;
}

export interface ProjectMap {
  root: string;
  indexedAt: string;
  totalFiles: number;
  languages: Record<string, number>;
  files: ProjectFile[];
  structure: string;
}

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript React', js: 'JavaScript', jsx: 'JavaScript React',
  py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', cs: 'C#', cpp: 'C++', c: 'C',
  rb: 'Ruby', php: 'PHP', swift: 'Swift', kt: 'Kotlin', vue: 'Vue', svelte: 'Svelte',
  html: 'HTML', css: 'CSS', scss: 'SCSS', json: 'JSON', yaml: 'YAML', yml: 'YAML',
  md: 'Markdown', sql: 'SQL', sh: 'Shell', ps1: 'PowerShell', dockerfile: 'Docker',
};

const IGNORE_PATTERNS = [
  '**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**', '**/build/**',
  '**/.ai-history/**', '**/.ai-context/**', '**/.ai-settings/**',
  '**/coverage/**', '**/.next/**', '**/__pycache__/**',
];

export class FileIndexer {
  async index(workspaceRoot: string): Promise<ProjectMap> {
    const searchPattern = path.join(workspaceRoot, '**/*').replace(/\\/g, '/');
    const allFiles = await glob(searchPattern, { ignore: IGNORE_PATTERNS });

    const files: ProjectFile[] = [];
    const languages: Record<string, number> = {};

    for (const filePath of allFiles) {
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) {
          continue;
        }

        const rel = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
        const ext = path.extname(filePath).slice(1).toLowerCase();
        const language = LANGUAGE_MAP[ext] ?? (ext.toUpperCase() || 'Unknown');

        let lines = 0;
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          lines = content.split('\n').length;
        } catch { /* binary */ }

        files.push({ path: rel, language, size: stat.size, lines });
        languages[language] = (languages[language] ?? 0) + 1;
      } catch { /* skip */ }
    }

    const structure = this.buildTree(files.map((f) => f.path));

    return {
      root: workspaceRoot,
      indexedAt: new Date().toISOString(),
      totalFiles: files.length,
      languages,
      files,
      structure,
    };
  }

  private buildTree(paths: string[]): string {
    const tree: Record<string, unknown> = {};

    for (const filePath of paths) {
      const parts = filePath.split('/');
      let current = tree;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i === parts.length - 1) {
          (current as Record<string, string>)[part] = 'file';
        } else {
          if (!current[part]) {
            current[part] = {};
          }
          current = current[part] as Record<string, unknown>;
        }
      }
    }

    return this.renderTree(tree, '');
  }

  private renderTree(node: Record<string, unknown>, indent: string): string {
    let result = '';
    const entries = Object.entries(node).sort(([a], [b]) => {
      const aIsDir = typeof node[a] === 'object';
      const bIsDir = typeof node[b] === 'object';
      if (aIsDir && !bIsDir) { return -1; }
      if (!aIsDir && bIsDir) { return 1; }
      return a.localeCompare(b);
    });

    for (const [name, value] of entries) {
      if (typeof value === 'string') {
        result += `${indent}├── ${name}\n`;
      } else {
        result += `${indent}├── ${name}/\n`;
        result += this.renderTree(value as Record<string, unknown>, indent + '│   ');
      }
    }

    return result;
  }
}
