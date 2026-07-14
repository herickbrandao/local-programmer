export interface ToolResult {
  success: boolean;
  output: string;
  data?: unknown;
}

import { FileReadCoverageMap } from './fileReadChunks';
import type { ProjectMemory } from '../workspace/projectMemory';

export interface ToolContext {
  workspaceRoot: string;
  fileReadCoverage?: FileReadCoverageMap;
  /** Espelho do projeto em RAM — leitura/busca sem ir ao disco */
  projectMemory?: ProjectMemory;
}

export interface Tool {
  name: string;
  description: string;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}
