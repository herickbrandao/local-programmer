import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { AgentController } from '../ai/agentController';
import { AgentEvent } from '../ai/types';
import { buildModelOptions } from '../config/modelSettings';
import {
  ExtensionSettings,
  getExtensionSettings,
  OperationMode,
  updateExtensionSettings,
} from '../config/settings';
import { createDiffContentUri } from '../editor/diffManager';
import { CodeModifier } from '../editor/codeModifier';
import { RollbackManager } from '../history/rollbackManager';
import { SnapshotManager } from '../history/snapshotManager';
import { expandCitations, formatFileCitation } from '../ai/citationResolver';
import { ChatSession, ChatSessionManager, createUiMessageId, UiMessage } from './chatSessionManager';
import { getPanelHtml } from './panelHtml';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'localProgrammer.chatView';
  private webviewView?: vscode.WebviewView;
  private agent: AgentController;
  private sessionManager: ChatSessionManager;
  private snapshotManager = new SnapshotManager();
  private rollbackManager?: RollbackManager;
  private currentSession?: ChatSession;
  private uiMessages: UiMessage[] = [];
  private models: string[] = [];
  private webviewInitialized = false;
  private loading?: Promise<void>;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {
    this.agent = new AgentController();
    this.agent.setEventHandler((event) => this.handleAgentEvent(event));
    this.sessionManager = new ChatSessionManager(context);
  }

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(async (message) => {
      try {
        switch (message.type) {
          case 'ready':
          case 'refresh_models':
            await this.initializeAndLoad();
            break;
          case 'get_settings':
            await this.sendSettings();
            break;
          case 'save_settings':
            await this.saveSettings(
              message.settings as Partial<ExtensionSettings>,
              message.silent === true
            );
            break;
          case 'test_connection':
            await this.testConnection(message.settings as Partial<ExtensionSettings>);
            break;
          case 'send':
            await this.onSend(message.text, message.model, message.operationMode);
            break;
          case 'new_chat':
            await this.onNewChat();
            break;
          case 'switch_chat':
            await this.onSwitchChat(message.sessionId as string);
            break;
          case 'delete_chat':
            await this.onDeleteChat(message.sessionId as string);
            break;
          case 'compare_file':
            await this.onCompareFile(message.data);
            break;
          case 'restore_file':
            await this.onRestoreFile(message.data);
            break;
          case 'index':
            await this.onIndex();
            break;
          case 'pick_file_citation':
            await this.pickFileCitation();
            break;
          case 'insert_editor_citation':
            await this.insertEditorCitation();
            break;
          case 'open_citation':
            await this.openCitation(
              message.path as string,
              message.startLine as number | undefined,
              message.endLine as number | undefined
            );
            break;
          case 'get_token_stats':
            this.postMessage({ type: 'token_stats', stats: this.agent.getTokenStats() });
            break;
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.postMessage({ type: 'error', content: errorMessage });
      }
    });

    webviewView.webview.html = getPanelHtml();
    void this.initializeAndLoad();

    webviewView.onDidChangeVisibility(() => {
      // Não recarregar selects ao focar — evita reverter modelo/modo escolhido pelo usuário
    });
  }

  private async initializeAndLoad(): Promise<void> {
    if (this.loading) {
      return this.loading;
    }

    this.loading = this.doInitializeAndLoad().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }

  private async doInitializeAndLoad(): Promise<void> {
    await this.agent.initializeWorkspace();
    const folders = vscode.workspace.workspaceFolders;
    const wsRoot = folders?.[0]?.uri.fsPath;
    this.sessionManager.updateWorkspace(wsRoot);

    if (wsRoot) {
      await this.snapshotManager.initialize(wsRoot);
      this.rollbackManager = new RollbackManager(this.snapshotManager, wsRoot);
    }

    this.currentSession = await this.sessionManager.getOrCreateActiveSession();
    this.uiMessages = [...this.currentSession.uiMessages];
    this.agent.loadConversation(this.currentSession.agentMessages);

    await this.loadModels();
    this.postMessage({
      type: 'load_session',
      session: this.currentSession,
      sessions: await this.sessionManager.listSessions(),
      uiMessages: this.uiMessages,
    });
  }

  private async loadModels(): Promise<void> {
    try {
      const hasWorkspace = await this.agent.initializeWorkspace();
      this.models = await this.agent.getModels();
      const settings = getExtensionSettings();
      const ollamaAvailable = await this.agent.isOllamaAvailable();
      const modelOptions = buildModelOptions(this.models, settings.model);

      this.postMessage({
        type: 'init',
        models: this.models,
        modelOptions,
        currentModel: settings.model,
        mode: settings.permissionMode,
        operationMode: settings.operationMode,
        ollamaAvailable,
        hasWorkspace,
        settings,
        sessions: await this.sessionManager.listSessions(),
        activeSessionId: this.currentSession?.id ?? '',
        initial: !this.webviewInitialized,
      });
      this.webviewInitialized = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const settings = getExtensionSettings();
      this.postMessage({
        type: 'init',
        models: [],
        modelOptions: buildModelOptions([], settings.model),
        currentModel: settings.model,
        mode: 'smart',
        ollamaAvailable: false,
        hasWorkspace: false,
        settings,
        error: message,
      });
    }
  }

  private async persistSession(): Promise<void> {
    if (!this.currentSession) {
      return;
    }
    this.currentSession.uiMessages = [...this.uiMessages];
    this.currentSession.agentMessages = this.agent.getConversation();
    await this.sessionManager.saveSession(this.currentSession);
  }

  private pushUiMessage(msg: UiMessage): void {
    this.uiMessages.push(msg);
    void this.persistSession();
  }

  private async onNewChat(): Promise<void> {
    this.agent.resetTokenStats();
    this.currentSession = await this.sessionManager.createSession();
    this.uiMessages = [...this.currentSession.uiMessages];
    this.agent.clearHistory();
    this.postMessage({
      type: 'load_session',
      session: this.currentSession,
      sessions: await this.sessionManager.listSessions(),
      uiMessages: this.uiMessages,
    });
  }

  private async onSwitchChat(sessionId: string): Promise<void> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) {
      return;
    }
    await this.sessionManager.setActiveSessionId(sessionId);
    this.currentSession = session;
    this.uiMessages = [...session.uiMessages];
    this.agent.loadConversation(session.agentMessages);
    this.postMessage({
      type: 'load_session',
      session,
      sessions: await this.sessionManager.listSessions(),
      uiMessages: this.uiMessages,
    });
  }

  private async onDeleteChat(sessionId: string): Promise<void> {
    if (!sessionId) {
      this.postMessage({ type: 'error', content: 'Nenhuma conversa selecionada para excluir.' });
      return;
    }

    const session = await this.sessionManager.getSession(sessionId);
    const title = session?.title ?? 'esta conversa';
    const confirm = await vscode.window.showWarningMessage(
      `Excluir "${title}"? Esta ação não pode ser desfeita.`,
      { modal: true },
      'Excluir'
    );
    if (confirm !== 'Excluir') {
      return;
    }

    const deleted = await this.sessionManager.deleteSession(sessionId);
    if (!deleted) {
      this.postMessage({ type: 'error', content: 'Não foi possível excluir a conversa.' });
      return;
    }

    const sessions = await this.sessionManager.listSessions();
    if (this.currentSession?.id === sessionId) {
      if (sessions.length > 0) {
        await this.onSwitchChat(sessions[0].id);
      } else {
        await this.onNewChat();
      }
    } else {
      this.postMessage({ type: 'sessions_updated', sessions, activeSessionId: this.currentSession?.id ?? '' });
    }
  }

  private async onCompareFile(data: {
    file: string;
    oldContent: string;
    newContent: string;
  }): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    let newContent = data.newContent ?? '';
    let oldContent = data.oldContent ?? '';

    if (folders) {
      const fullPath = path.join(folders[0].uri.fsPath, data.file);
      try {
        newContent = await fs.readFile(fullPath, 'utf-8');
      } catch {
        // mantém conteúdo armazenado no card
      }
    }

    const oldUri = createDiffContentUri('local-programmer-old', data.file, oldContent);
    const newUri = createDiffContentUri('local-programmer-new', data.file, newContent);
    await vscode.commands.executeCommand('vscode.diff', oldUri, newUri, `${data.file} (IA)`);
  }

  private async onRestoreFile(data: {
    file: string;
    oldContent?: string;
    versionId?: string | null;
  }): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `Restaurar "${data.file}" para a versão anterior?`,
      { modal: true },
      'Restaurar'
    );
    if (confirm !== 'Restaurar') {
      return;
    }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      vscode.window.showWarningMessage('Abra um workspace primeiro.');
      return;
    }

    if (data.versionId && this.rollbackManager) {
      await this.rollbackManager.restoreFile(data.versionId, data.file);
    } else {
      const modifier = new CodeModifier();
      await modifier.revertChange(folders[0].uri.fsPath, data.file, data.oldContent ?? '');
      vscode.window.showInformationMessage(`Arquivo restaurado: ${data.file}`);
    }

    this.pushUiMessage({
      kind: 'system',
      content: `↩ Arquivo restaurado: ${data.file}`,
    });
    this.postMessage({ type: 'ui_message', message: this.uiMessages[this.uiMessages.length - 1] });
  }

  private async sendSettings(): Promise<void> {
    const settings = getExtensionSettings();
    this.models = await this.agent.getModels();
    this.postMessage({
      type: 'settings',
      settings,
      modelOptions: buildModelOptions(this.models, settings.model),
      currentModel: settings.model,
    });
  }

  private async saveSettings(partial: Partial<ExtensionSettings>, silent = false): Promise<void> {
    await updateExtensionSettings(partial);
    await this.agent.initializeWorkspace();
    this.models = await this.agent.getModels();
    const settings = getExtensionSettings();
    this.postMessage({
      type: 'settings_saved',
      settings,
      modelOptions: buildModelOptions(this.models, settings.model),
      currentModel: settings.model,
      operationMode: settings.operationMode,
      ollamaAvailable: await this.agent.isOllamaAvailable(),
      hasWorkspace: !!vscode.workspace.workspaceFolders?.length,
      silent,
    });
  }

  private async testConnection(partial: Partial<ExtensionSettings>): Promise<void> {
    const result = await this.agent.testConnection({
      ollamaUrl: partial.ollamaUrl,
      connectionTimeoutMs: partial.connectionTimeoutMs,
    });
    await this.agent.initializeWorkspace();
    this.postMessage({
      type: 'test_result',
      ok: result.ok,
      message: result.message,
      models: result.models,
      modelOptions: buildModelOptions(result.models ?? [], getExtensionSettings().model),
    });
  }

  insertCitation(text: string): void {
    this.postMessage({ type: 'insert_citation', text });
  }

  async pickFileCitation(): Promise<void> {
    await this.onPickFileCitation();
  }

  async insertEditorCitation(): Promise<void> {
    await this.onInsertEditorCitation();
  }

  private async onPickFileCitation(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      vscode.window.showWarningMessage('Abra um workspace para citar arquivos.');
      return;
    }

    const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 500);
    const picked = await vscode.window.showQuickPick(
      files.map((f) => ({
        label: vscode.workspace.asRelativePath(f),
        uri: f,
      })),
      { placeHolder: 'Selecione um arquivo para citar' }
    );
    if (!picked) {
      return;
    }

    const rel = picked.label.replace(/\\/g, '/');
    const editor = vscode.window.activeTextEditor;
    let citation = formatFileCitation(rel);
    if (editor && editor.document.uri.fsPath === picked.uri.fsPath && !editor.selection.isEmpty) {
      const start = editor.selection.start.line + 1;
      const end = editor.selection.end.line + 1;
      citation = formatFileCitation(rel, start, end !== start ? end : undefined);
    }

    this.insertCitation(citation + ' ');
  }

  private async onInsertEditorCitation(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const folders = vscode.workspace.workspaceFolders;
    if (!editor || !folders) {
      return;
    }

    const rel = vscode.workspace.asRelativePath(editor.document.uri).replace(/\\/g, '/');
    const start = editor.selection.start.line + 1;
    const end = editor.selection.end.line + 1;
    const citation = editor.selection.isEmpty
      ? formatFileCitation(rel)
      : formatFileCitation(rel, start, end !== start ? end : undefined);

    this.insertCitation(citation + ' ');
  }

  private async openCitation(
    filePath: string,
    startLine?: number,
    endLine?: number
  ): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      vscode.window.showWarningMessage('Abra um workspace para abrir arquivos citados.');
      return;
    }

    const normalized = filePath.replace(/\\/g, '/');
    const uri = vscode.Uri.file(path.join(folders[0].uri.fsPath, normalized));

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, { preview: false });

      if (startLine && startLine > 0) {
        const fromLine = Math.max(0, startLine - 1);
        const toLine = Math.min(doc.lineCount - 1, (endLine ?? startLine) - 1);
        const from = new vscode.Position(fromLine, 0);
        const to = new vscode.Position(toLine, doc.lineAt(toLine).text.length);
        const range = new vscode.Range(from, to);
        editor.selection = new vscode.Selection(from, to);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      }
    } catch {
      vscode.window.showWarningMessage(`Arquivo não encontrado: ${normalized}`);
    }
  }

  private async onSend(text: string, model?: string, operationMode?: OperationMode): Promise<void> {
    if (!text.trim()) {
      return;
    }

    try {
      if (model) {
        await updateExtensionSettings({ model });
      }
      if (operationMode) {
        await updateExtensionSettings({ operationMode });
      }

      const isFirstUserMessage =
        this.uiMessages.filter((m) => m.kind === 'user').length === 0;

      if (this.currentSession && isFirstUserMessage) {
        this.currentSession.title = this.sessionManager.deriveTitle(text);
      }

      const userMsg: UiMessage = {
        id: createUiMessageId(),
        kind: 'user',
        content: text,
      };
      this.pushUiMessage(userMsg);
      this.postMessage({ type: 'ui_message', message: userMsg });

      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const expandedPrompt = await expandCitations(text, {
        workspaceRoot: wsRoot,
        uiMessages: this.uiMessages,
      });

      if (isFirstUserMessage) {
        this.postMessage({
          type: 'sessions_updated',
          sessions: await this.sessionManager.listSessions(),
        });
      }

      await this.agent.sendMessage(expandedPrompt, operationMode, text);
      await this.persistSession();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.postMessage({ type: 'error', content: message });
    }
  }

  private async onIndex(): Promise<void> {
    try {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders) {
        this.postMessage({ type: 'error', content: 'Abra uma pasta de projeto antes de indexar.' });
        return;
      }
      const map = await this.agent.getContextManager().indexProject(folders[0].uri.fsPath);
      const msg: UiMessage = { kind: 'system', content: `Projeto indexado: ${map.totalFiles} arquivos` };
      this.pushUiMessage(msg);
      this.postMessage({ type: 'ui_message', message: msg });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.postMessage({ type: 'error', content: message });
    }
  }

  private handleAgentEvent(event: AgentEvent): void {
    if (event.type === 'file_changed') {
      const data = event.data as { persisted?: boolean; file?: string; versionId?: string };
      if (data?.persisted) {
        const existing = this.uiMessages.find(
          (m) => m.kind === 'file_change' && m.data?.file === data.file
        );
        if (existing?.data) {
          existing.data.versionId = data.versionId;
          existing.data.persisted = true;
          void this.persistSession();
          this.postMessage({ type: 'update_file_change', data: existing.data });
        }
      } else if (this.shouldPersistEvent(event)) {
        const uiMsg = this.agentEventToUiMessage(event);
        if (uiMsg) {
          this.pushUiMessage(uiMsg);
          this.postMessage({ type: 'ui_message', message: uiMsg });
        }
      }
    } else if (this.shouldPersistEvent(event)) {
      const uiMsg = this.agentEventToUiMessage(event);
      if (uiMsg) {
        this.pushUiMessage(uiMsg);
        this.postMessage({ type: 'ui_message', message: uiMsg });
      }
    }

    this.postMessage({ type: 'agent_event', event, settings: getExtensionSettings() });

    if (event.type === 'token_usage') {
      this.postMessage({ type: 'token_stats', stats: event.data });
    }
  }

  private shouldPersistEvent(event: AgentEvent): boolean {
    const settings = getExtensionSettings();
    if (event.type === 'thinking' && !settings.showThinking) {
      return false;
    }
    if (event.type === 'tool_call' && !settings.showToolCalls) {
      return false;
    }
    if (event.type === 'tool_result' && !settings.showToolResults) {
      return false;
    }
    return event.type !== 'done' && event.type !== 'permission';
  }

  private agentEventToUiMessage(event: AgentEvent): UiMessage | null {
    switch (event.type) {
      case 'message':
        return event.data && (event.data as { role?: string }).role === 'assistant'
          ? { id: createUiMessageId(), kind: 'assistant', content: event.content }
          : null;
      case 'thinking':
        return { kind: 'system', content: event.content };
      case 'tool_call':
        return { kind: 'tool', content: '🔧 ' + event.content };
      case 'tool_result': {
        const ok = (event.data as { success?: boolean })?.success;
        return { kind: 'tool', content: (ok ? '✓ ' : '✗ ') + event.content };
      }
      case 'file_changed':
        return {
          kind: 'file_change',
          content: event.content,
          data: event.data as Record<string, unknown>,
        };
      case 'checkpoint':
        return { kind: 'system', content: '💾 ' + event.content };
      case 'error':
        return { kind: 'error', content: '❌ ' + event.content };
      default:
        return null;
    }
  }

  private postMessage(message: unknown): void {
    this.webviewView?.webview.postMessage(message);
  }
}
