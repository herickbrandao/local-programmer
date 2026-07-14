import * as vscode from 'vscode';
import { ChatViewProvider } from './ui/chatViewProvider';
import { registerDiffProviders } from './editor/diffManager';
import { SnapshotManager } from './history/snapshotManager';
import { RollbackManager } from './history/rollbackManager';
import { getExtensionSettings, OperationMode, updateExtensionSettings } from './config/settings';

let snapshotManager: SnapshotManager;
let rollbackManager: RollbackManager;
let chatProvider: ChatViewProvider;

const OPERATION_MODES: OperationMode[] = ['chat', 'analyze', 'agent'];

export function activate(context: vscode.ExtensionContext): void {
  chatProvider = new ChatViewProvider(context.extensionUri, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      chatProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  registerDiffProviders(context);

  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    snapshotManager = new SnapshotManager();
    rollbackManager = new RollbackManager(snapshotManager, folders[0].uri.fsPath);
    snapshotManager.initialize(folders[0].uri.fsPath);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('localProgrammer.openChat', () => {
      vscode.commands.executeCommand('localProgrammer.chatView.focus');
    }),

    vscode.commands.registerCommand('localProgrammer.rollbackLast', async () => {
      if (!rollbackManager) {
        vscode.window.showWarningMessage('Abra um workspace primeiro.');
        return;
      }
      await rollbackManager.rollbackLast();
    }),

    vscode.commands.registerCommand('localProgrammer.restoreVersion', async () => {
      if (!rollbackManager) {
        vscode.window.showWarningMessage('Abra um workspace primeiro.');
        return;
      }
      await rollbackManager.promptRestoreVersion();
    }),

    vscode.commands.registerCommand('localProgrammer.restoreFile', async () => {
      if (!rollbackManager) {
        vscode.window.showWarningMessage('Abra um workspace primeiro.');
        return;
      }
      await rollbackManager.promptRestoreFile();
    }),

    vscode.commands.registerCommand('localProgrammer.compareVersions', async () => {
      if (!rollbackManager) {
        vscode.window.showWarningMessage('Abra um workspace primeiro.');
        return;
      }
      await rollbackManager.promptCompareVersions();
    }),

    vscode.commands.registerCommand('localProgrammer.indexProject', async () => {
      const wsFolders = vscode.workspace.workspaceFolders;
      if (!wsFolders) {
        vscode.window.showWarningMessage('Abra um workspace primeiro.');
        return;
      }
      const { ContextManager } = await import('./workspace/contextManager');
      const cm = new ContextManager();
      await cm.initialize(wsFolders[0].uri.fsPath);
      const map = await cm.indexProject(wsFolders[0].uri.fsPath);
      vscode.window.showInformationMessage(
        `Projeto indexado: ${map.totalFiles} arquivos, ${Object.keys(map.languages).length} linguagens`
      );
    }),

    vscode.commands.registerCommand('localProgrammer.citeFile', async () => {
      await vscode.commands.executeCommand('localProgrammer.chatView.focus');
      await chatProvider.pickFileCitation();
    }),

    vscode.commands.registerCommand('localProgrammer.citeInChat', async () => {
      await vscode.commands.executeCommand('localProgrammer.chatView.focus');
      await chatProvider.insertEditorCitation();
    }),

    vscode.commands.registerCommand('localProgrammer.citeOpenFile', async () => {
      await vscode.commands.executeCommand('localProgrammer.chatView.focus');
      await chatProvider.citeActiveEditorFile();
    }),

    vscode.commands.registerCommand('localProgrammer.cycleMode', async () => {
      const current = getExtensionSettings().operationMode;
      const idx = OPERATION_MODES.indexOf(current);
      const next = OPERATION_MODES[(idx + 1) % OPERATION_MODES.length];
      await updateExtensionSettings({ operationMode: next });
      await chatProvider.refreshModeFromSettings();
      const labels: Record<OperationMode, string> = {
        chat: 'Chat',
        analyze: 'Análise',
        agent: 'Agente',
      };
      vscode.window.setStatusBarMessage(`Local Programmer: modo ${labels[next]}`, 2500);
    }),

    vscode.commands.registerCommand('localProgrammer.stopAgent', () => {
      chatProvider.stopAgent();
    })
  );

  vscode.window.registerUriHandler({
    handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
      if (uri.path === '/open') {
        vscode.commands.executeCommand('localProgrammer.openChat');
      }
    },
  });
}

export function deactivate(): void {
  chatProvider?.dispose();
}
