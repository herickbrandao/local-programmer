export interface ToolResult {
  success: boolean;
  output: string;
  data?: unknown;
}

import { FileReadCoverageMap } from './fileReadChunks';

export interface ToolContext {
  workspaceRoot: string;
  fileReadCoverage?: FileReadCoverageMap;
}

export interface Tool {
  name: string;
  description: string;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}
