import * as fs from 'fs/promises';
import * as path from 'path';

export class CodeModifier {
  async applyChange(
    workspaceRoot: string,
    filePath: string,
    newContent: string
  ): Promise<{ oldContent: string; newContent: string }> {
    const fullPath = path.join(workspaceRoot, filePath);
    let oldContent = '';

    try {
      oldContent = await fs.readFile(fullPath, 'utf-8');
    } catch { /* new file */ }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, newContent, 'utf-8');

    return { oldContent, newContent };
  }

  async revertChange(
    workspaceRoot: string,
    filePath: string,
    oldContent: string
  ): Promise<void> {
    const fullPath = path.join(workspaceRoot, filePath);

    if (oldContent) {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, oldContent, 'utf-8');
    } else {
      try {
        await fs.unlink(fullPath);
      } catch { /* already gone */ }
    }
  }
}
