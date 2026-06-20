import { ToolCall } from './types';

const FILE_CONTENT_TOOLS = new Set(['create_file', 'modify_file', 'edit_file']);
const KNOWN_TOOLS = new Set([
  'read_file', 'edit_file', 'modify_file', 'create_file', 'delete_file',
  'run_command', 'test_project', 'list_files', 'search_files',
]);

interface RawToolEntry {
  name?: string;
  arguments?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  function?: {
    name?: string;
    arguments?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
  };
}

function getToolArgs(entry: RawToolEntry): Record<string, unknown> {
  return entry.arguments
    ?? entry.parameters
    ?? entry.function?.arguments
    ?? entry.function?.parameters
    ?? {};
}

function getToolName(entry: RawToolEntry): string {
  return entry.name ?? entry.function?.name ?? '';
}

export function extractToolCallsFromParsed(
  parsed: unknown
): Array<{ name: string; arguments: Record<string, unknown> }> | null {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  if (Array.isArray(obj.tool_calls)) {
    const calls = (obj.tool_calls as RawToolEntry[])
      .map((tc) => ({ name: getToolName(tc), arguments: getToolArgs(tc) }))
      .filter((tc) => tc.name && KNOWN_TOOLS.has(tc.name));
    return calls.length > 0 ? calls : null;
  }

  if (typeof obj.name === 'string' && KNOWN_TOOLS.has(obj.name)) {
    const args = (obj.arguments ?? obj.parameters) as Record<string, unknown> | undefined;
    if (args && typeof args === 'object') {
      return [{ name: obj.name, arguments: args }];
    }
  }

  if (Array.isArray(parsed)) {
    const calls = (parsed as RawToolEntry[])
      .map((tc) => ({ name: getToolName(tc), arguments: getToolArgs(tc) }))
      .filter((tc) => tc.name && KNOWN_TOOLS.has(tc.name));
    return calls.length > 0 ? calls : null;
  }

  return null;
}

export function extractToolCallsFromContent(content: string): Array<{ name: string; arguments: Record<string, unknown> }> | null {
  const candidates: string[] = [];

  const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    candidates.push(jsonBlockMatch[1].trim());
  }

  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    candidates.push(trimmed);
  }

  const inlineJson = content.match(
    /\{[\s\S]*?"name"\s*:\s*"(?:read_file|edit_file|modify_file|create_file|delete_file|run_command|test_project|list_files|search_files)"[\s\S]*?\}/
  );
  if (inlineJson) {
    candidates.push(inlineJson[0]);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const calls = extractToolCallsFromParsed(parsed);
      if (calls) {
        return calls;
      }
    } catch {
      for (const toolName of KNOWN_TOOLS) {
        const repaired = repairFileToolJson(toolName, candidate);
        if (repaired && typeof repaired.path === 'string') {
          return [{ name: toolName, arguments: repaired }];
        }
      }
    }
  }

  return null;
}

export function toToolCalls(
  raw: Array<{ name: string; arguments: Record<string, unknown> }>
): ToolCall[] {
  return raw.map((tc, i) => ({
    id: `call_${Date.now()}_${i}`,
    name: tc.name,
    arguments: parseToolArguments(tc.name, tc.arguments),
  }));
}

export function parseToolArguments(
  toolName: string,
  raw: string | Record<string, unknown>
): Record<string, unknown> {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return {};
    }

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (!isSuspiciousFileArgs(toolName, parsed)) {
        return parsed;
      }
      const repaired = repairFileToolJson(toolName, trimmed);
      if (repaired) {
        return repaired;
      }
    } catch {
      const repaired = repairFileToolJson(toolName, trimmed);
      if (repaired) {
        return repaired;
      }
    }
    return {};
  }

  if (typeof raw === 'object' && raw !== null) {
    if (!isSuspiciousFileArgs(toolName, raw)) {
      return raw;
    }
    const repaired = repairFileToolJson(toolName, JSON.stringify(raw));
    return repaired ?? raw;
  }

  return {};
}

export function isSuspiciousFileArgs(
  toolName: string,
  args: Record<string, unknown>
): boolean {
  if (!FILE_CONTENT_TOOLS.has(toolName)) {
    return false;
  }

  const path = args.path;
  if (typeof path !== 'string' || !path.trim()) {
    return true;
  }

  if (toolName === 'edit_file') {
    const action = args.action as string | undefined;
    if (!action) {
      return true;
    }
    switch (action) {
      case 'search_replace':
        return typeof args.old_text !== 'string' || typeof args.new_text !== 'string'
          || isSuspiciousEditText(args.old_text as string)
          || isSuspiciousEditText(args.new_text as string);
      case 'replace_lines':
      case 'insert_lines':
        return typeof args.content !== 'string' || isSuspiciousEditText(args.content as string);
      case 'delete_lines':
        return typeof args.start_line !== 'number';
      default:
        return true;
    }
  }

  const contentKey = toolName === 'modify_file' ? 'new_content' : 'content';
  const content = args[contentKey];

  if (typeof content !== 'string') {
    return true;
  }

  if (content.length === 0 && toolName === 'create_file') {
    return false;
  }

  if (toolName === 'modify_file' && typeof args.old_content !== 'string') {
    return true;
  }

  return isSuspiciousEditText(content);
}

function isSuspiciousEditText(content: string): boolean {
  if (/^print\($|^console\.log\($|^echo\s+$/.test(content.trim())) {
    return true;
  }
  if (content.includes('print(') && !content.includes(')')) {
    return true;
  }
  return false;
}

export function repairFileToolJson(
  toolName: string,
  raw: string
): Record<string, unknown> | null {
  if (!FILE_CONTENT_TOOLS.has(toolName)) {
    return null;
  }

  const pathMatch = raw.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!pathMatch) {
    return null;
  }

  const path = unescapeJsonString(pathMatch[1]);
  const contentKey = toolName === 'modify_file' ? 'new_content' : 'content';

  // path antes de content: {"path":"x.py","content":"..."}
  const pathFirst = raw.match(
    new RegExp(`"path"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"\\s*,\\s*"${contentKey}"\\s*:\\s*"([\\s\\S]*)"$`)
  );
  if (pathFirst) {
    const content = unescapeJsonString(pathFirst[2].replace(/"\s*}\s*$/, ''));
    if (content && !isSuspiciousContent(content)) {
      return { path, [contentKey]: content };
    }
  }

  // content antes de path: {"content":"...","path":"x.py"}
  const contentFirst = raw.match(
    new RegExp(`"${contentKey}"\\s*:\\s*"([\\s\\S]*?)\\s*,\\s*"path"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`)
  );
  if (contentFirst) {
    const content = unescapeJsonString(contentFirst[1]);
    if (content && !isSuspiciousContent(content)) {
      return { [contentKey]: content, path: unescapeJsonString(contentFirst[2]) };
    }
  }

  // Aspas internas quebraram o JSON — extrai entre "content":" e ","path"
  const brokenContentFirst = raw.match(
    new RegExp(`"${contentKey}"\\s*:\\s*"([\\s\\S]+)","path"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`)
  );
  if (brokenContentFirst) {
    // Pega tudo até a última ocorrência de ","path":" — conteúdo pode ter aspas no meio
    const aggressive = raw.match(
      new RegExp(`"${contentKey}"\\s*:\\s*"([\\s\\S]*)","path"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`)
    );
    if (aggressive) {
      let content = aggressive[1];
      // Remove fragmento truncado no final se houver aspas soltas no fim
      content = content.replace(/"\s*$/, '');
      content = unescapeJsonString(content);
      if (content && !isSuspiciousContent(content)) {
        return { [contentKey]: content, path: unescapeJsonString(aggressive[2]) };
      }
    }
  }

  // JSON inválido por aspas internas: extrai tudo entre "content":" e a última ","path"
  const contentStart = raw.search(new RegExp(`"${contentKey}"\\s*:\\s*"`));
  const pathDelimiter = '","path"';
  const pathDelimiterIdx = raw.lastIndexOf(pathDelimiter);
  if (contentStart !== -1 && pathDelimiterIdx !== -1) {
    const colonMatch = raw.slice(contentStart).match(new RegExp(`^"${contentKey}"\\s*:\\s*"`));
    if (colonMatch) {
      const start = contentStart + colonMatch[0].length;
      if (start < pathDelimiterIdx) {
        const content = unescapeJsonString(raw.slice(start, pathDelimiterIdx));
        if (content && !isSuspiciousContent(content)) {
          return { [contentKey]: content, path };
        }
      }
    }
  }

  return null;
}

function isSuspiciousContent(content: string): boolean {
  if (/^print\($|^console\.log\($/.test(content.trim())) {
    return true;
  }
  if (content.includes('print(') && !content.includes(')')) {
    return true;
  }
  return false;
}

function unescapeJsonString(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

export function extractCodeBlock(text: string, preferredLang?: string): string | null {
  if (!text) {
    return null;
  }

  const blocks: Array<{ lang: string; code: string }> = [];
  const regex = /```(\w*)\r?\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({ lang: match[1].toLowerCase(), code: match[2].replace(/\s+$/, '') });
  }

  if (blocks.length === 0) {
    return null;
  }

  if (preferredLang) {
    const preferred = blocks.find((b) => b.lang === preferredLang);
    if (preferred) {
      return preferred.code;
    }
  }

  const exts: Record<string, string> = {
    py: 'python', ts: 'typescript', js: 'javascript', tsx: 'typescript', jsx: 'javascript',
  };
  if (preferredLang && exts[preferredLang]) {
    const byExt = blocks.find((b) => b.lang === exts[preferredLang]);
    if (byExt) {
      return byExt.code;
    }
  }

  return blocks[0].code;
}

export function inferLangFromPath(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    py: 'python', ts: 'typescript', js: 'javascript', tsx: 'typescript',
    jsx: 'javascript', rs: 'rust', go: 'go', java: 'java',
  };
  return ext ? map[ext] : undefined;
}

export function normalizeToolArguments(
  toolName: string,
  rawArgs: string | Record<string, unknown>,
  assistantContent?: string
): { args: Record<string, unknown>; recovered: boolean; error?: string } {
  let args = parseToolArguments(toolName, rawArgs);

  if (toolName === 'edit_file' && isSuspiciousFileArgs(toolName, args)) {
    const path = typeof args.path === 'string' ? args.path : undefined;
    const action = args.action as string | undefined;
    const fromBlock = extractCodeBlock(assistantContent ?? '', path ? inferLangFromPath(path) : undefined);

    if (fromBlock && path && action === 'replace_lines') {
      args = { ...args, path, action, content: fromBlock };
      return { args, recovered: true };
    }

    if (path && action === 'search_replace' && typeof args.old_text === 'string') {
      return {
        args,
        recovered: false,
        error: 'JSON truncado no new_text. Envie old_text/new_text curtos ou use replace_lines com start_line/end_line.',
      };
    }
  }

  if (FILE_CONTENT_TOOLS.has(toolName) && isSuspiciousFileArgs(toolName, args)) {
    const path = typeof args.path === 'string' ? args.path : undefined;
    const contentKey = toolName === 'modify_file' ? 'new_content' : 'content';
    const lang = path ? inferLangFromPath(path) : undefined;
    const fromBlock = extractCodeBlock(assistantContent ?? '', lang);

    if (fromBlock && path) {
      args = { ...args, path, [contentKey]: fromBlock };
      return { args, recovered: true };
    }

    if (toolName === 'edit_file') {
      return {
        args,
        recovered: false,
        error: 'edit_file inválido. Preferir replace_lines com start_line/end_line/content para arquivos HTML/TS.',
      };
    }

    return {
      args,
      recovered: false,
      error: `Conteúdo do arquivo inválido ou truncado (aspas não escapadas no JSON). `
        + `Use edit_file com replace_lines ou search_replace com trechos curtos.`,
    };
  }

  return { args, recovered: false };
}
