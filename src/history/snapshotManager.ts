import * as fs from 'fs/promises';
import * as path from 'path';
import { FileChange, VersionManifest } from '../ai/types';

export class SnapshotManager {
  private historyDir: string = '';
  private versionCounter = 0;

  async initialize(workspaceRoot: string): Promise<void> {
    this.historyDir = path.join(workspaceRoot, '.ai-history');
    await fs.mkdir(this.historyDir, { recursive: true });
    this.versionCounter = await this.getLatestVersionNumber();
  }

  private async getLatestVersionNumber(): Promise<number> {
    try {
      const entries = await fs.readdir(this.historyDir);
      const versions = entries
        .filter((e) => e.startsWith('version_'))
        .map((e) => parseInt(e.replace('version_', ''), 10))
        .filter((n) => !isNaN(n));
      return versions.length > 0 ? Math.max(...versions) : 0;
    } catch {
      return 0;
    }
  }

  private nextVersionId(): string {
    this.versionCounter++;
    return `version_${String(this.versionCounter).padStart(3, '0')}`;
  }

  async createSnapshot(
    workspaceRoot: string,
    model: string,
    prompt: string,
    changes: FileChange[]
  ): Promise<VersionManifest> {
    const versionId = this.nextVersionId();
    const versionDir = path.join(this.historyDir, versionId);
    const beforeDir = path.join(versionDir, 'before');
    const afterDir = path.join(versionDir, 'after');

    await fs.mkdir(beforeDir, { recursive: true });
    await fs.mkdir(afterDir, { recursive: true });

    for (const change of changes) {
      const beforePath = path.join(beforeDir, change.file);
      const afterPath = path.join(afterDir, change.file);

      await fs.mkdir(path.dirname(beforePath), { recursive: true });
      await fs.mkdir(path.dirname(afterPath), { recursive: true });

      if (change.oldContent) {
        await fs.writeFile(beforePath, change.oldContent, 'utf-8');
      }
      if (change.newContent) {
        await fs.writeFile(afterPath, change.newContent, 'utf-8');
      }
    }

    const manifest: VersionManifest = {
      id: versionId,
      date: new Date().toISOString(),
      model,
      prompt,
      changes,
    };

    await fs.writeFile(
      path.join(versionDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8'
    );

    return manifest;
  }

  async listVersions(): Promise<VersionManifest[]> {
    try {
      const entries = await fs.readdir(this.historyDir);
      const versions: VersionManifest[] = [];

      for (const entry of entries) {
        if (!entry.startsWith('version_')) {
          continue;
        }
        const manifestPath = path.join(this.historyDir, entry, 'manifest.json');
        try {
          const content = await fs.readFile(manifestPath, 'utf-8');
          versions.push(JSON.parse(content));
        } catch { /* skip */ }
      }

      return versions.sort((a, b) => a.id.localeCompare(b.id));
    } catch {
      return [];
    }
  }

  async getVersion(versionId: string): Promise<VersionManifest | null> {
    const manifestPath = path.join(this.historyDir, versionId, 'manifest.json');
    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async getVersionFile(
    versionId: string,
    filePath: string,
    state: 'before' | 'after'
  ): Promise<string | null> {
    const fullPath = path.join(this.historyDir, versionId, state, filePath);
    try {
      return await fs.readFile(fullPath, 'utf-8');
    } catch {
      return null;
    }
  }

  getLatestVersionId(): string | null {
    if (this.versionCounter === 0) {
      return null;
    }
    return `version_${String(this.versionCounter).padStart(3, '0')}`;
  }
}
