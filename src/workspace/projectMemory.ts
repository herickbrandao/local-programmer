import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { glob } from '../tools/glob';

export interface MemoryFileEntry {
  path: string;
  content: string;
  lines: number;
  bytes: number;
  mtimeMs: number;
}

export interface ProjectMemoryStats {
  files: number;
  bytes: number;
  loadedAt: string;
  root: string;
}

const IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/out/**',
  '**/build/**',
  '**/.ai-history/**',
  '**/.ai-context/**',
  '**/.ai-settings/**',
  '**/coverage/**',
  '**/.next/**',
  '**/__pycache__/**',
  '**/*.min.js',
  '**/*.map',
  '**/package-lock.json',
];

const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.cs', '.rb', '.php',
  '.vue', '.svelte', '.html', '.css', '.scss', '.less',
  '.json', '.md', '.mdx', '.yml', '.yaml', '.toml',
  '.xml', '.svg', '.sql', '.sh', '.bash', '.ps1',
  '.env', '.txt', '.gitignore', '.editorconfig',
]);

const MAX_FILE_BYTES = 400_000;
const MAX_TOTAL_BYTES = 40_000_000;
const MAX_FILES = 2_000;

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isTextCandidate(relPath: string): boolean {
  const base = path.basename(relPath);
  if (base === 'Dockerfile' || base.startsWith('.env')) {
    return true;
  }
  const ext = path.extname(relPath).toLowerCase();
  return TEXT_EXT.has(ext) || ext === '';
}

/**
 * Espelho do projeto em RAM: tools leem daqui (rápido).
 * NÃO injeta o repo inteiro no prompt da IA — só trechos sob demanda.
 */
export class ProjectMemory {
  private root = '';
  private files = new Map<string, MemoryFileEntry>();
  private loadedAt = '';
  private watchers: vscode.FileSystemWatcher[] = [];
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  get stats(): ProjectMemoryStats {
    let bytes = 0;
    for (const f of this.files.values()) {
      bytes += f.bytes;
    }
    return {
      files: this.files.size,
      bytes,
      loadedAt: this.loadedAt,
      root: this.root,
    };
  }

  isReady(): boolean {
    return !!this.root && this.files.size > 0;
  }

  async initialize(workspaceRoot: string): Promise<ProjectMemoryStats> {
    this.disposeWatchers();
    this.root = workspaceRoot;
    await this.reloadAll();
    this.attachWatchers();
    return this.stats;
  }

  async reloadAll(): Promise<ProjectMemoryStats> {
    if (!this.root) {
      return this.stats;
    }

    const searchPattern = path.join(this.root, '**/*').replace(/\\/g, '/');
    const allPaths = await glob(searchPattern, { ignore: IGNORE });
    const next = new Map<string, MemoryFileEntry>();
    let totalBytes = 0;

    for (const abs of allPaths) {
      if (next.size >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) {
        break;
      }
      const rel = normalizeRel(path.relative(this.root, abs));
      if (!rel || rel.startsWith('..') || !isTextCandidate(rel)) {
        continue;
      }
      try {
        const st = await fs.stat(abs);
        if (!st.isFile() || st.size > MAX_FILE_BYTES || st.size === 0) {
          continue;
        }
        const content = await fs.readFile(abs, 'utf-8');
        if (content.includes('\u0000')) {
          continue;
        }
        const bytes = Buffer.byteLength(content, 'utf-8');
        if (totalBytes + bytes > MAX_TOTAL_BYTES) {
          break;
        }
        totalBytes += bytes;
        next.set(rel, {
          path: rel,
          content,
          lines: content.split('\n').length,
          bytes,
          mtimeMs: st.mtimeMs,
        });
      } catch {
        // skip
      }
    }

    this.files = next;
    this.loadedAt = new Date().toISOString();
    return this.stats;
  }

  get(relPath: string): MemoryFileEntry | undefined {
    const key = normalizeRel(relPath);
    return this.files.get(key)
      ?? [...this.files.entries()].find(([k]) => k.endsWith(`/${key}`) || key.endsWith(`/${k}`))?.[1];
  }

  has(relPath: string): boolean {
    return !!this.get(relPath);
  }

  listPaths(): string[] {
    return [...this.files.keys()].sort();
  }

  /** Atualiza após edit_file/create_file do agente */
  setContent(relPath: string, content: string): void {
    const key = normalizeRel(relPath);
    const bytes = Buffer.byteLength(content, 'utf-8');
    this.files.set(key, {
      path: key,
      content,
      lines: content.split('\n').length,
      bytes,
      mtimeMs: Date.now(),
    });
  }

  delete(relPath: string): void {
    this.files.delete(normalizeRel(relPath));
  }

  async refreshFile(relPath: string): Promise<void> {
    if (!this.root) {
      return;
    }
    const key = normalizeRel(relPath);
    const abs = path.join(this.root, key);
    try {
      const st = await fs.stat(abs);
      if (!st.isFile() || st.size > MAX_FILE_BYTES) {
        this.files.delete(key);
        return;
      }
      const content = await fs.readFile(abs, 'utf-8');
      if (content.includes('\u0000')) {
        this.files.delete(key);
        return;
      }
      this.setContent(key, content);
      const entry = this.files.get(key);
      if (entry) {
        entry.mtimeMs = st.mtimeMs;
      }
    } catch {
      this.files.delete(key);
    }
  }

  search(query: string, maxResults = 40): string[] {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [];
    }
    const hits: string[] = [];
    for (const entry of this.files.values()) {
      const lines = entry.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(q)) {
          hits.push(`${entry.path}:${i + 1}: ${lines[i].trim()}`);
          if (hits.length >= maxResults) {
            return hits;
          }
        }
      }
    }
    return hits;
  }

  formatStatus(): string {
    const s = this.stats;
    const mb = (s.bytes / (1024 * 1024)).toFixed(2);
    return `Memória do projeto: ${s.files} arquivos (~${mb} MB) em RAM`;
  }

  dispose(): void {
    this.disposed = true;
    this.disposeWatchers();
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }
    this.files.clear();
  }

  private attachWatchers(): void {
    if (!this.root) {
      return;
    }
    const pattern = new vscode.RelativePattern(this.root, '**/*');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const skipRel = (rel: string) =>
      !rel
      || rel.startsWith('..')
      || !isTextCandidate(rel)
      || /(^|\/)(node_modules|\.git|dist|out|build|\.ai-history|\.ai-context|\.ai-settings|coverage)(\/|$)/.test(rel);

    const schedule = (uri: vscode.Uri) => {
      if (this.disposed) {
        return;
      }
      const rel = normalizeRel(path.relative(this.root, uri.fsPath));
      if (skipRel(rel)) {
        return;
      }
      void this.refreshFile(rel);
    };

    watcher.onDidChange(schedule);
    watcher.onDidCreate(schedule);
    watcher.onDidDelete((uri) => {
      const rel = normalizeRel(path.relative(this.root, uri.fsPath));
      this.delete(rel);
    });

    this.watchers.push(watcher);

    // Debounced full reload when many files change (ex.: git checkout)
    const bulk = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.root, '{package.json,tsconfig.json}')
    );
    bulk.onDidChange(() => this.scheduleFullReload());
    this.watchers.push(bulk);
  }

  private scheduleFullReload(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }
    this.reloadTimer = setTimeout(() => {
      void this.reloadAll();
    }, 800);
  }

  private disposeWatchers(): void {
    for (const w of this.watchers) {
      w.dispose();
    }
    this.watchers = [];
  }
}
