import * as fs from 'fs/promises';
import { UiMessage } from '../ui/chatSessionManager';
import { resolveWorkspacePath } from '../tools/pathUtils';

const FILE_CITATION = /@([^\s@]+?)(?::(\d+)(?:-(\d+))?)?(?=\s|$)/g;
const MSG_CITATION = /@msg:([a-zA-Z0-9_-]+)/g;

export interface CitationContext {
  workspaceRoot?: string;
  uiMessages: UiMessage[];
}

export function extractCitationRefs(text: string): { files: string[]; messages: string[] } {
  const files: string[] = [];
  const messages: string[] = [];

  for (const match of text.matchAll(new RegExp(FILE_CITATION.source, 'g'))) {
    if (!match[1].startsWith('msg:')) {
      files.push(match[0]);
    }
  }
  for (const match of text.matchAll(new RegExp(MSG_CITATION.source, 'g'))) {
    messages.push(match[1]);
  }

  return { files, messages };
}

export async function expandCitations(
  text: string,
  ctx: CitationContext
): Promise<string> {
  if (!text.includes('@')) {
    return text;
  }

  let expanded = text;
  const msgBlocks: string[] = [];

  for (const match of [...text.matchAll(new RegExp(MSG_CITATION.source, 'g'))]) {
    const msgId = match[1];
    const uiMsg = ctx.uiMessages.find((m) => m.id === msgId);
    if (uiMsg) {
      msgBlocks.push(
        `--- Citação da mensagem @msg:${msgId} (${uiMsg.kind}) ---\n${uiMsg.content}\n--- Fim citação ---`
      );
    }
  }

  for (const match of [...text.matchAll(new RegExp(FILE_CITATION.source, 'g'))]) {
    const ref = match[1];
    if (ref.startsWith('msg:')) {
      continue;
    }
    const startLine = match[2] ? parseInt(match[2], 10) : undefined;
    const endLine = match[3] ? parseInt(match[3], 10) : startLine;

    if (!ctx.workspaceRoot) {
      continue;
    }

    try {
      const filePath = ref.replace(/\\/g, '/');
      const fullPath = resolveWorkspacePath(ctx.workspaceRoot, filePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');

      let snippet: string;
      if (startLine !== undefined) {
        const from = Math.max(1, startLine);
        const to = Math.min(lines.length, endLine ?? startLine);
        snippet = lines.slice(from - 1, to).map((line, i) => `${from + i}| ${line}`).join('\n');
      } else {
        snippet = lines.map((line, i) => `${i + 1}| ${line}`).join('\n');
      }

      const block = `--- Citação: @${ref}${startLine ? `:${startLine}${endLine && endLine !== startLine ? `-${endLine}` : ''}` : ''} ---\n${snippet}\n--- Fim citação ---`;
      msgBlocks.push(block);
    } catch {
      msgBlocks.push(`--- Citação @${ref}: arquivo não encontrado ---`);
    }
  }

  if (msgBlocks.length > 0) {
    expanded = `${msgBlocks.join('\n\n')}\n\n--- Pedido do usuário ---\n${text}`;
  }

  return expanded;
}

export function formatFileCitation(filePath: string, startLine?: number, endLine?: number): string {
  if (startLine !== undefined) {
    if (endLine !== undefined && endLine !== startLine) {
      return `@${filePath}:${startLine}-${endLine}`;
    }
    return `@${filePath}:${startLine}`;
  }
  return `@${filePath}`;
}

export function formatMessageCitation(msgId: string): string {
  return `@msg:${msgId}`;
}
