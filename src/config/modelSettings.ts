import * as vscode from 'vscode';
import { DEFAULT_SETTINGS } from './settings';

export function getSavedModel(): string {
  const config = vscode.workspace.getConfiguration('localProgrammer');
  const inspected = config.inspect<string>('model');
  return inspected?.globalValue
    ?? inspected?.workspaceValue
    ?? config.get<string>('model', DEFAULT_SETTINGS.model);
}

export async function saveModel(model: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('localProgrammer');
  await config.update('model', model, vscode.ConfigurationTarget.Global);
}

export function buildModelOptions(
  availableModels: string[],
  savedModel: string
): Array<{ value: string; label: string; inactive: boolean }> {
  const options: Array<{ value: string; label: string; inactive: boolean }> = [];
  const seen = new Set<string>();

  for (const model of availableModels) {
    seen.add(model);
    options.push({
      value: model,
      label: model,
      inactive: false,
    });
  }

  if (savedModel && !seen.has(savedModel)) {
    options.unshift({
      value: savedModel,
      label: `${savedModel} (inativa)`,
      inactive: true,
    });
  }

  return options;
}
