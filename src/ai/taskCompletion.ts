import { FileChange } from './types';

export function isSimpleWriteRequest(prompt: string): boolean {
  return /cri(e|ar)\s+(um\s+)?arquivo|create\s+(a\s+)?file|escrev(a|e)\s+(no|em|o)\s+arquivo/i.test(prompt);
}

export function extractFilenamesFromPrompt(prompt: string): string[] {
  const quoted = [...prompt.matchAll(/["']([^"']+\.\w{1,10})["']/g)].map((m) => m[1]);
  const inline = [...prompt.matchAll(/\b([\w.-]+\.\w{1,10})\b/g)].map((m) => m[1]);
  return [...new Set([...quoted, ...inline])];
}

export function extractContentFromPrompt(prompt: string): string | null {
  const patterns = [
    /conte[úu]do\s+["']?([^"'\n]+?)["']?(?:\s*$|\s+com|\s+no|\s+em)/i,
    /conte[úu]do\s+["']?(\S+)["']?\s*$/i,
    /content\s+["']?(\S+)["']?/i,
    /com\s+["']?(\S+)["']?\s*$/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function matchesTarget(filePath: string, target: string): boolean {
  return filePath === target
    || filePath.endsWith(`/${target}`)
    || filePath.endsWith(`\\${target}`);
}

export function checkWriteTaskComplete(
  userPrompt: string,
  changes: FileChange[]
): string | null {
  if (changes.length === 0) {
    return null;
  }

  const targetFiles = extractFilenamesFromPrompt(userPrompt);
  const lastChange = changes[changes.length - 1];
  const intendedContent = extractContentFromPrompt(userPrompt);

  const relevantChange = targetFiles.length > 0
    ? changes.find((c) => targetFiles.some((t) => matchesTarget(c.file, t))) ?? lastChange
    : lastChange;

  if (intendedContent !== null) {
    const actual = relevantChange.newContent.trim();
    if (actual === intendedContent.trim()) {
      return `Pronto! \`${relevantChange.file}\` salvo com o conteúdo "${intendedContent}".`;
    }
  }

  if (isSimpleWriteRequest(userPrompt)) {
    return `Pronto! \`${relevantChange.file}\` salvo com sucesso.`;
  }

  return null;
}
