import * as vscode from 'vscode';

export type PermissionMode = 'manual' | 'smart' | 'auto';
export type OperationMode = 'chat' | 'analyze' | 'agent';

export const READ_ONLY_TOOLS = ['read_file', 'list_files', 'search_files'] as const;
export const WRITE_TOOLS = ['edit_file', 'modify_file', 'create_file', 'delete_file'] as const;
export const RUN_TOOLS = ['run_command', 'test_project'] as const;
export const IMPLEMENT_TOOLS = [...WRITE_TOOLS, 'test_project'] as const;

export interface ExtensionSettings {
  ollamaUrl: string;
  model: string;
  permissionMode: PermissionMode;
  operationMode: OperationMode;
  maxAgentIterations: number;
  maxResponseTokens: number;
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
  temperature: number;
  showThinking: boolean;
  showToolCalls: boolean;
  showToolResults: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  ollamaUrl: 'http://localhost:11434',
  model: 'qwen2.5-coder:7b',
  permissionMode: 'smart',
  operationMode: 'chat',
  maxAgentIterations: 20,
  maxResponseTokens: 16384,
  connectionTimeoutMs: 30000,
  requestTimeoutMs: 300000,
  temperature: 0.2,
  showThinking: true,
  showToolCalls: true,
  showToolResults: true,
};

export function getExtensionSettings(): ExtensionSettings {
  const config = vscode.workspace.getConfiguration('localProgrammer');
  const modelInspect = config.inspect<string>('model');
  const model = modelInspect?.globalValue
    ?? modelInspect?.workspaceValue
    ?? config.get<string>('model', DEFAULT_SETTINGS.model);

  return {
    ollamaUrl: config.get<string>('ollamaUrl', DEFAULT_SETTINGS.ollamaUrl),
    model,
    permissionMode: config.get<PermissionMode>('permissionMode', DEFAULT_SETTINGS.permissionMode),
    operationMode: config.get<OperationMode>('operationMode', DEFAULT_SETTINGS.operationMode),
    maxAgentIterations: config.get<number>('maxAgentIterations', DEFAULT_SETTINGS.maxAgentIterations),
    maxResponseTokens: config.get<number>('maxResponseTokens', DEFAULT_SETTINGS.maxResponseTokens),
    connectionTimeoutMs: config.get<number>('connectionTimeoutMs', DEFAULT_SETTINGS.connectionTimeoutMs),
    requestTimeoutMs: config.get<number>('requestTimeoutMs', DEFAULT_SETTINGS.requestTimeoutMs),
    temperature: config.get<number>('temperature', DEFAULT_SETTINGS.temperature),
    showThinking: config.get<boolean>('showThinking', DEFAULT_SETTINGS.showThinking),
    showToolCalls: config.get<boolean>('showToolCalls', DEFAULT_SETTINGS.showToolCalls),
    showToolResults: config.get<boolean>('showToolResults', DEFAULT_SETTINGS.showToolResults),
  };
}

function getConfigTarget(): vscode.ConfigurationTarget {
  return vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

export function updateExtensionSetting(
  key: keyof ExtensionSettings,
  value: ExtensionSettings[keyof ExtensionSettings]
): Thenable<void> {
  const config = vscode.workspace.getConfiguration('localProgrammer');
  return config.update(key, value, getConfigTarget());
}

export async function updateExtensionSettings(
  settings: Partial<ExtensionSettings>
): Promise<void> {
  const config = vscode.workspace.getConfiguration('localProgrammer');
  const target = getConfigTarget();

  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) {
      continue;
    }
    if (key === 'model') {
      await config.update('model', value, vscode.ConfigurationTarget.Global);
    } else {
      await config.update(key, value, target);
    }
  }
}
