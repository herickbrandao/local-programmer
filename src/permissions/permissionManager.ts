import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  ApprovalScope,
  PermissionMode,
  PermissionRequest,
} from '../ai/types';
import {
  DEFAULT_PERMISSION_RULES,
  getFilePermissionKey,
  PermissionRules,
  TOOL_PERMISSION_MAP,
} from './rules';

interface PermissionLogEntry {
  action: string;
  file?: string;
  date: string;
  approved: boolean;
  scope?: ApprovalScope;
}

export class PermissionManager {
  private sessionApprovals = new Set<string>();
  private rules: PermissionRules = { ...DEFAULT_PERMISSION_RULES };
  private settingsDir: string = '';
  private historyDir: string = '';

  async initialize(workspaceRoot: string): Promise<void> {
    this.settingsDir = path.join(workspaceRoot, '.ai-settings');
    this.historyDir = path.join(workspaceRoot, '.ai-history');
    await fs.mkdir(this.settingsDir, { recursive: true });
    await fs.mkdir(this.historyDir, { recursive: true });
    await this.loadRules();
  }

  private async loadRules(): Promise<void> {
    const rulesPath = path.join(this.settingsDir, 'permissions.json');
    try {
      const content = await fs.readFile(rulesPath, 'utf-8');
      this.rules = { ...DEFAULT_PERMISSION_RULES, ...JSON.parse(content) };
    } catch {
      await this.saveRules();
    }
  }

  async saveRules(): Promise<void> {
    const rulesPath = path.join(this.settingsDir, 'permissions.json');
    await fs.writeFile(rulesPath, JSON.stringify(this.rules, null, 2), 'utf-8');
  }

  getMode(): PermissionMode {
    const config = vscode.workspace.getConfiguration('localProgrammer');
    return config.get<PermissionMode>('permissionMode', 'smart');
  }

  private isAutoApproved(permissionKey: string, filePath?: string): boolean {
    if (this.sessionApprovals.has(permissionKey)) {
      return true;
    }
    if (this.rules.autoApprove.includes(permissionKey)) {
      return true;
    }
    if (filePath) {
      const fileKey = getFilePermissionKey(filePath);
      if (fileKey && this.rules.autoApprove.includes(fileKey)) {
        return true;
      }
    }
    return false;
  }

  private requiresApproval(toolName: string, filePath?: string): boolean {
    const mode = this.getMode();

    if (mode === 'auto') {
      return false;
    }

    const permissionKey = TOOL_PERMISSION_MAP[toolName] ?? toolName;

    if (mode === 'smart') {
      const readOnlyTools = ['read_file', 'list_files', 'search_files'];
      if (readOnlyTools.includes(toolName)) {
        return false;
      }
      if (toolName === 'delete_file' || toolName === 'run_command') {
        return true;
      }
      if (this.isAutoApproved(permissionKey, filePath)) {
        return false;
      }
      return true;
    }

    // manual mode
    const readOnlyTools = ['read_file', 'list_files', 'search_files'];
    if (readOnlyTools.includes(toolName)) {
      return false;
    }
    return true;
  }

  async requestPermission(request: PermissionRequest): Promise<boolean> {
    const permissionKey = TOOL_PERMISSION_MAP[request.toolName] ?? request.toolName;

    if (!this.requiresApproval(request.toolName, request.file)) {
      await this.logPermission(request, true, 'once');
      return true;
    }

    if (this.sessionApprovals.has(permissionKey)) {
      await this.logPermission(request, true, 'session');
      return true;
    }

    const choice = await this.showPermissionDialog(request);

    if (choice === 'deny') {
      await this.logPermission(request, false, 'deny');
      return false;
    }

    if (choice === 'session') {
      this.sessionApprovals.add(permissionKey);
      if (request.file) {
        const fileKey = getFilePermissionKey(request.file);
        if (fileKey) {
          this.sessionApprovals.add(fileKey);
        }
      }
    }

    await this.logPermission(request, true, choice ?? 'once');
    return true;
  }

  private async showPermissionDialog(
    request: PermissionRequest
  ): Promise<ApprovalScope | undefined> {
    const items: Array<{ label: string; description?: string; scope: ApprovalScope }> = [
      { label: '$(check) Permitir uma vez', scope: 'once' },
      { label: '$(history) Permitir nesta sessão', scope: 'session' },
      { label: '$(diff) Revisar diff', scope: 'once', description: 'Permitir após revisar' },
      { label: '$(close) Negar', scope: 'deny' },
    ];

    const detail = [
      request.description,
      request.file ? `Arquivo: ${request.file}` : '',
      request.details ?? '',
    ].filter(Boolean).join('\n');

    const choice = await vscode.window.showQuickPick(items, {
      title: `IA deseja: ${request.action}`,
      placeHolder: detail,
      ignoreFocusOut: true,
    });

    return choice?.scope;
  }

  async requestBatchApproval(
    changes: Array<{ file: string; action: string }>
  ): Promise<'all' | 'reject' | 'review'> {
    const fileList = changes.map((c) => `✓ ${c.file} (${c.action})`).join('\n');

    const items = [
      { label: '$(check-all) Permitir todas', value: 'all' as const },
      { label: '$(diff) Revisar todas', value: 'review' as const },
      { label: '$(close-all) Rejeitar todas', value: 'reject' as const },
    ];

    const choice = await vscode.window.showQuickPick(items, {
      title: `${changes.length} mudanças encontradas`,
      placeHolder: fileList,
      ignoreFocusOut: true,
    });

    return choice?.value ?? 'reject';
  }

  private async logPermission(
    request: PermissionRequest,
    approved: boolean,
    scope: ApprovalScope
  ): Promise<void> {
    const entry: PermissionLogEntry = {
      action: request.action,
      file: request.file,
      date: new Date().toISOString(),
      approved,
      scope,
    };

    const logPath = path.join(this.historyDir, 'permissions.log');
    const line = JSON.stringify(entry) + '\n';

    try {
      await fs.appendFile(logPath, line, 'utf-8');
    } catch { /* non-critical */ }
  }

  clearSession(): void {
    this.sessionApprovals.clear();
  }
}
