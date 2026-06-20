import * as path from 'path';

export function normalizeWorkspacePath(workspaceRoot: string, filePath: string): string {
  let normalized = filePath.trim().replace(/\\/g, '/');
  const root = workspaceRoot.replace(/\\/g, '/');

  if (normalized.startsWith(root)) {
    normalized = normalized.slice(root.length).replace(/^\//, '');
  }

  if (/^[a-zA-Z]:\//.test(normalized)) {
    const relative = path.relative(workspaceRoot, normalized.replace(/\//g, path.sep));
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.replace(/\\/g, '/');
    }
    return path.basename(normalized);
  }

  return normalized.replace(/^\.\//, '');
}

export function resolveWorkspacePath(workspaceRoot: string, filePath: string): string {
  const relative = normalizeWorkspacePath(workspaceRoot, filePath);
  return path.join(workspaceRoot, relative);
}

export function normalizeToolArgs(
  workspaceRoot: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  const normalized = { ...args };

  if (typeof normalized.path === 'string') {
    normalized.path = normalizeWorkspacePath(workspaceRoot, normalized.path);
  }

  if (typeof normalized.cwd === 'string') {
    normalized.cwd = normalizeWorkspacePath(workspaceRoot, normalized.cwd);
  }

  return normalized;
}
