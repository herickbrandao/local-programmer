import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { VersionManifest } from '../ai/types';
import { SnapshotManager } from './snapshotManager';

export class RollbackManager {
  constructor(
    private snapshotManager: SnapshotManager,
    private workspaceRoot: string
  ) {}

  async rollbackLast(): Promise<boolean> {
    const versions = await this.snapshotManager.listVersions();
    if (versions.length === 0) {
      vscode.window.showWarningMessage('Nenhuma versão para reverter.');
      return false;
    }

    const lastVersion = versions[versions.length - 1];
    return this.restoreVersion(lastVersion.id);
  }

  async restoreVersion(versionId: string): Promise<boolean> {
    const manifest = await this.snapshotManager.getVersion(versionId);
    if (!manifest) {
      vscode.window.showErrorMessage(`Versão não encontrada: ${versionId}`);
      return false;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Restaurar projeto para ${versionId} (${manifest.date})?`,
      { modal: true },
      'Restaurar'
    );

    if (confirm !== 'Restaurar') {
      return false;
    }

    for (const change of manifest.changes) {
      const targetPath = path.join(this.workspaceRoot, change.file);

      if (change.oldContent) {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, change.oldContent, 'utf-8');
      } else {
        try {
          await fs.unlink(targetPath);
        } catch { /* file may not exist */ }
      }
    }

    vscode.window.showInformationMessage(`Projeto restaurado para ${versionId}`);
    return true;
  }

  async restoreFile(versionId: string, filePath: string): Promise<boolean> {
    const content = await this.snapshotManager.getVersionFile(versionId, filePath, 'before');
    if (content === null) {
      vscode.window.showErrorMessage(`Arquivo não encontrado na versão ${versionId}: ${filePath}`);
      return false;
    }

    const targetPath = path.join(this.workspaceRoot, filePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, 'utf-8');

    vscode.window.showInformationMessage(`Arquivo restaurado: ${filePath} (${versionId})`);
    return true;
  }

  async compareVersions(
    versionA: string,
    versionB: string
  ): Promise<void> {
    const manifestA = await this.snapshotManager.getVersion(versionA);
    const manifestB = await this.snapshotManager.getVersion(versionB);

    if (!manifestA || !manifestB) {
      vscode.window.showErrorMessage('Uma ou ambas versões não foram encontradas.');
      return;
    }

    const allFiles = new Set<string>();
    manifestA.changes.forEach((c) => allFiles.add(c.file));
    manifestB.changes.forEach((c) => allFiles.add(c.file));

    for (const file of allFiles) {
      const contentA = await this.snapshotManager.getVersionFile(versionA, file, 'after')
        ?? await this.snapshotManager.getVersionFile(versionA, file, 'before')
        ?? '';
      const contentB = await this.snapshotManager.getVersionFile(versionB, file, 'after')
        ?? await this.snapshotManager.getVersionFile(versionB, file, 'before')
        ?? '';

      if (contentA !== contentB) {
        const uriA = vscode.Uri.parse(`local-programmer-diff:${versionA}/${file}`).with({
          scheme: 'local-programmer-diff',
          path: `/${versionA}/${file}`,
          query: Buffer.from(contentA).toString('base64'),
        });
        const uriB = vscode.Uri.parse(`local-programmer-diff:${versionB}/${file}`).with({
          scheme: 'local-programmer-diff',
          path: `/${versionB}/${file}`,
          query: Buffer.from(contentB).toString('base64'),
        });

        await vscode.commands.executeCommand(
          'vscode.diff',
          uriA,
          uriB,
          `${file}: ${versionA} ↔ ${versionB}`
        );
      }
    }
  }

  async promptRestoreVersion(): Promise<void> {
    const versions = await this.snapshotManager.listVersions();
    if (versions.length === 0) {
      vscode.window.showWarningMessage('Nenhuma versão disponível.');
      return;
    }

    const items = versions.map((v: VersionManifest) => ({
      label: v.id,
      description: new Date(v.date).toLocaleString('pt-BR'),
      detail: v.prompt.substring(0, 80),
      versionId: v.id,
    }));

    const choice = await vscode.window.showQuickPick(items, {
      title: 'Selecione a versão para restaurar',
      placeHolder: 'Escolha uma versão',
    });

    if (choice) {
      await this.restoreVersion(choice.versionId);
    }
  }

  async promptCompareVersions(): Promise<void> {
    const versions = await this.snapshotManager.listVersions();
    if (versions.length < 2) {
      vscode.window.showWarningMessage('É necessário ter pelo menos 2 versões para comparar.');
      return;
    }

    const items = versions.map((v: VersionManifest) => ({
      label: v.id,
      description: new Date(v.date).toLocaleString('pt-BR'),
      versionId: v.id,
    }));

    const versionA = await vscode.window.showQuickPick(items, {
      title: 'Versão A (base)',
      placeHolder: 'Selecione a primeira versão',
    });
    if (!versionA) {
      return;
    }

    const versionB = await vscode.window.showQuickPick(items, {
      title: 'Versão B (comparação)',
      placeHolder: 'Selecione a segunda versão',
    });
    if (!versionB) {
      return;
    }

    await this.compareVersions(versionA.versionId, versionB.versionId);
  }

  async promptRestoreFile(): Promise<void> {
    const versions = await this.snapshotManager.listVersions();
    if (versions.length === 0) {
      vscode.window.showWarningMessage('Nenhuma versão disponível.');
      return;
    }

    const lastVersion = versions[versions.length - 1];
    const files = lastVersion.changes.map((c) => c.file);

    const fileChoice = await vscode.window.showQuickPick(files, {
      title: 'Selecione o arquivo para restaurar',
    });
    if (!fileChoice) {
      return;
    }

    const versionItems = versions
      .filter((v) => v.changes.some((c) => c.file === fileChoice))
      .map((v) => ({
        label: v.id,
        description: new Date(v.date).toLocaleString('pt-BR'),
        versionId: v.id,
      }));

    const versionChoice = await vscode.window.showQuickPick(versionItems, {
      title: `Restaurar ${fileChoice} de qual versão?`,
    });

    if (versionChoice) {
      await this.restoreFile(versionChoice.versionId, fileChoice);
    }
  }
}
