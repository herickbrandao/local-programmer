export interface PermissionRules {
  autoApprove: string[];
  requireApproval: string[];
}

export const DEFAULT_PERMISSION_RULES: PermissionRules = {
  autoApprove: [
    'read_file',
    'list_files',
    'search_files',
    'modify_typescript',
    'modify_javascript',
  ],
  requireApproval: [
    'delete_file',
    'terminal_command',
    'run_command',
    'modify_config',
  ],
};

export const TOOL_PERMISSION_MAP: Record<string, string> = {
  read_file: 'read_file',
  list_files: 'read_file',
  search_files: 'read_file',
  edit_file: 'modify_file',
  modify_file: 'modify_file',
  create_file: 'create_file',
  delete_file: 'delete_file',
  run_command: 'terminal_command',
  test_project: 'terminal_command',
};

export function getFilePermissionKey(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext) {
    return null;
  }
  const map: Record<string, string> = {
    ts: 'modify_typescript',
    tsx: 'modify_typescript',
    js: 'modify_javascript',
    jsx: 'modify_javascript',
    json: 'modify_config',
    yaml: 'modify_config',
    yml: 'modify_config',
  };
  return map[ext] ?? null;
}
