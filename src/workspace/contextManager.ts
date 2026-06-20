import * as fs from 'fs/promises';
import * as path from 'path';
import { FileIndexer, ProjectMap } from './fileIndexer';

export interface DependenciesInfo {
  type: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export interface CodeIndexEntry {
  path: string;
  language: string;
  exports: string[];
  imports: string[];
  functions: string[];
  classes: string[];
}

export class ContextManager {
  private contextDir: string = '';
  private projectMap: ProjectMap | null = null;
  private indexer = new FileIndexer();

  async initialize(workspaceRoot: string): Promise<void> {
    this.contextDir = path.join(workspaceRoot, '.ai-context');
    await fs.mkdir(this.contextDir, { recursive: true });
  }

  async indexProject(workspaceRoot: string): Promise<ProjectMap> {
    this.projectMap = await this.indexer.index(workspaceRoot);

    await fs.writeFile(
      path.join(this.contextDir, 'project-map.json'),
      JSON.stringify(this.projectMap, null, 2),
      'utf-8'
    );

    const deps = await this.extractDependencies(workspaceRoot);
    await fs.writeFile(
      path.join(this.contextDir, 'dependencies.json'),
      JSON.stringify(deps, null, 2),
      'utf-8'
    );

    const codeIndex = await this.buildCodeIndex(workspaceRoot, this.projectMap);
    await fs.writeFile(
      path.join(this.contextDir, 'code-index.json'),
      JSON.stringify(codeIndex, null, 2),
      'utf-8'
    );

    return this.projectMap;
  }

  async getProjectContext(workspaceRoot: string): Promise<string> {
    if (!this.projectMap) {
      try {
        const content = await fs.readFile(
          path.join(this.contextDir, 'project-map.json'),
          'utf-8'
        );
        this.projectMap = JSON.parse(content);
      } catch {
        this.projectMap = await this.indexProject(workspaceRoot);
      }
    }

    const map = this.projectMap!;
    const langSummary = Object.entries(map.languages)
      .map(([lang, count]) => `${lang}: ${count}`)
      .join(', ');

    const importantFiles = map.files
      .filter((f) => this.isImportantFile(f.path))
      .map((f) => f.path)
      .slice(0, 30);

    return [
      `Raiz: ${map.root}`,
      `Arquivos: ${map.totalFiles}`,
      `Linguagens: ${langSummary}`,
      '',
      'Estrutura:',
      map.structure,
      '',
      'Arquivos importantes:',
      importantFiles.join('\n'),
    ].join('\n');
  }

  private isImportantFile(filePath: string): boolean {
    const patterns = [
      /^package\.json$/, /^tsconfig/, /^README/, /\/index\./,
      /\/main\./, /\/app\./, /\/server\./, /\/extension\./,
      /\.config\./, /\/routes\//, /\/api\//, /\/src\//,
    ];
    return patterns.some((p) => p.test(filePath));
  }

  private async extractDependencies(workspaceRoot: string): Promise<DependenciesInfo | null> {
    const pkgPath = path.join(workspaceRoot, 'package.json');
    try {
      const content = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      return {
        type: 'npm',
        dependencies: pkg.dependencies ?? {},
        devDependencies: pkg.devDependencies ?? {},
      };
    } catch {
      return null;
    }
  }

  private async buildCodeIndex(
    workspaceRoot: string,
    projectMap: ProjectMap
  ): Promise<CodeIndexEntry[]> {
    const index: CodeIndexEntry[] = [];
    const codeFiles = projectMap.files.filter((f) =>
      ['TypeScript', 'TypeScript React', 'JavaScript', 'JavaScript React', 'Python'].includes(f.language)
    );

    for (const file of codeFiles.slice(0, 100)) {
      try {
        const content = await fs.readFile(path.join(workspaceRoot, file.path), 'utf-8');
        index.push({
          path: file.path,
          language: file.language,
          exports: this.extractPattern(content, /export\s+(?:default\s+)?(?:function|class|const|interface|type)\s+(\w+)/g),
          imports: this.extractPattern(content, /import\s+.*?from\s+['"]([^'"]+)['"]/g),
          functions: this.extractPattern(content, /(?:function|const|async function)\s+(\w+)/g),
          classes: this.extractPattern(content, /class\s+(\w+)/g),
        });
      } catch { /* skip */ }
    }

    return index;
  }

  private extractPattern(content: string, regex: RegExp): string[] {
    const results: string[] = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
      results.push(match[1]);
    }
    return [...new Set(results)];
  }
}
