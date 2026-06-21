import * as vscode from 'vscode';
import { PendingChange } from '../ai/types';

let contentCounter = 0;

export class VirtualDiffContentStore {
  private static contents = new Map<string, string>();

  static set(key: string, content: string): void {
    this.contents.set(key, content);
  }

  static get(key: string): string | undefined {
    return this.contents.get(key);
  }

  static createUri(scheme: string, filePath: string, content: string): vscode.Uri {
    const safeName = filePath.replace(/[^\w.-]/g, '_');
    const key = `${Date.now()}-${++contentCounter}-${safeName}`;
    this.contents.set(key, content);
    return vscode.Uri.from({
      scheme,
      path: `/${key}`,
    });
  }
}

export function createDiffContentUri(
  scheme: 'local-programmer-old' | 'local-programmer-new',
  filePath: string,
  content: string
): vscode.Uri {
  return VirtualDiffContentStore.createUri(scheme, filePath, content);
}

export class DiffManager {
  async showDiff(change: PendingChange): Promise<'accept' | 'reject'> {
    const oldUri = createDiffContentUri('local-programmer-old', change.file, change.oldContent);
    const newUri = createDiffContentUri('local-programmer-new', change.file, change.newContent);

    const title = `${change.file} (IA)`;
    await vscode.commands.executeCommand('vscode.diff', oldUri, newUri, title);

    const choice = await vscode.window.showInformationMessage(
      `Revisar alteração em ${change.file}`,
      'Aceitar',
      'Rejeitar'
    );

    return choice === 'Aceitar' ? 'accept' : 'reject';
  }

  async showBatchDiff(changes: PendingChange[]): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    if (changes.length > 1) {
      const choice = await vscode.window.showInformationMessage(
        `${changes.length} alterações pendentes`,
        'Aceitar todas',
        'Revisar uma a uma',
        'Rejeitar todas'
      );

      if (choice === 'Aceitar todas') {
        changes.forEach((c) => results.set(c.file, true));
        return results;
      }
      if (choice === 'Rejeitar todas') {
        changes.forEach((c) => results.set(c.file, false));
        return results;
      }
    }

    for (const change of changes) {
      const result = await this.showDiff(change);
      results.set(change.file, result === 'accept');
    }

    return results;
  }

  generateUnifiedDiff(oldContent: string, newContent: string, filePath: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const diff: string[] = [`--- ${filePath}`, `+++ ${filePath}`];

    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine === newLine) {
        diff.push(` ${oldLine ?? ''}`);
      } else {
        if (oldLine !== undefined) {
          diff.push(`-${oldLine}`);
        }
        if (newLine !== undefined) {
          diff.push(`+${newLine}`);
        }
      }
    }

    return diff.join('\n');
  }
}

class DiffContentProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    const key = uri.path.replace(/^\//, '');
    return VirtualDiffContentStore.get(key) ?? '';
  }
}

export function registerDiffProviders(context: vscode.ExtensionContext): void {
  const provider = new DiffContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('local-programmer-old', provider),
    vscode.workspace.registerTextDocumentContentProvider('local-programmer-new', provider),
    vscode.workspace.registerTextDocumentContentProvider('local-programmer-diff', provider)
  );
}
