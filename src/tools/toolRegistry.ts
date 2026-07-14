import { Tool } from './types';
import { EditFileTool } from './editFile';
import { TestProjectTool } from './testProject';
import { ReadFileTool } from './readFile';
import { ModifyFileTool } from './modifyFile';
import { CreateFileTool } from './createFile';
import { DeleteFileTool } from './deleteFile';
import { RunCommandTool } from './runCommand';
import { ListFilesTool, SearchFilesTool } from './listFiles';
import { ReadFilesTool } from './readFiles';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  constructor() {
    this.register(new ReadFileTool());
    this.register(new ReadFilesTool());
    this.register(new EditFileTool());
    this.register(new ModifyFileTool());
    this.register(new CreateFileTool());
    this.register(new DeleteFileTool());
    this.register(new RunCommandTool());
    this.register(new TestProjectTool());
    this.register(new ListFilesTool());
    this.register(new SearchFilesTool());
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  getNames(): string[] {
    return Array.from(this.tools.keys());
  }
}
