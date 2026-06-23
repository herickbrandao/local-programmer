import { normalizeRelPath } from '../tools/fileReadChunks';

export interface FileLineCitation {
  path: string;
  startLine: number;
  endLine: number;
  /** Texto original (@path:97-123 ou path:97-123) */
  raw: string;
}

const AT_CITATION = /@([^\s@:]+):(\d+)(?:-(\d+))?/g;
const PLAIN_CITATION = /(?:^|[\s\n])([\w./\\-]+\.\w{1,12}):(\d+)(?:-(\d+))?(?=\s|$|[,.!?])/gm;
const BLOCK_CITATION = /--- Citação:\s*@([^\s:]+):(\d+)(?:-(\d+))?/g;

function pathsMatch(a: string, b: string): boolean {
  const na = normalizeRelPath(a).toLowerCase();
  const nb = normalizeRelPath(b).toLowerCase();
  return na === nb || na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`);
}

function pushCitation(
  list: FileLineCitation[],
  seen: Set<string>,
  path: string,
  start: number,
  end: number,
  raw: string
): void {
  const normalized = normalizeRelPath(path.replace(/\\/g, '/'));
  const key = `${normalized}:${start}-${end}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  list.push({
    path: normalized,
    startLine: Math.min(start, end),
    endLine: Math.max(start, end),
    raw,
  });
}

/** Extrai citações com intervalo de linhas do pedido (com ou sem @) */
export function parseLineCitations(text: string): FileLineCitation[] {
  const list: FileLineCitation[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(AT_CITATION)) {
    if (match[1].startsWith('msg:')) {
      continue;
    }
    const start = parseInt(match[2], 10);
    const end = match[3] ? parseInt(match[3], 10) : start;
    pushCitation(list, seen, match[1], start, end, match[0]);
  }

  for (const match of text.matchAll(BLOCK_CITATION)) {
    const start = parseInt(match[2], 10);
    const end = match[3] ? parseInt(match[3], 10) : start;
    pushCitation(list, seen, match[1], start, end, `@${match[1]}:${match[2]}${match[3] ? `-${match[3]}` : ''}`);
  }

  for (const match of text.matchAll(PLAIN_CITATION)) {
    const start = parseInt(match[2], 10);
    const end = match[3] ? parseInt(match[3], 10) : start;
    pushCitation(list, seen, match[1], start, end, `${match[1]}:${match[2]}${match[3] ? `-${match[3]}` : ''}`);
  }

  return list;
}

export function findCitationForFile(
  citations: FileLineCitation[] | undefined,
  filePath: string
): FileLineCitation | undefined {
  if (!citations?.length) {
    return undefined;
  }
  return citations.find((c) => pathsMatch(c.path, filePath));
}

export function getPrimaryCitation(citations: FileLineCitation[] | undefined): FileLineCitation | undefined {
  return citations?.[0];
}

export function formatCitationConstraint(citations: FileLineCitation[] | undefined): string {
  if (!citations?.length) {
    return '';
  }
  return [
    'TRECHO OBRIGATÓRIO (citado pelo usuário — NÃO edite outras linhas):',
    ...citations.map((c) => `- ${c.path}:${c.startLine}-${c.endLine}`),
  ].join('\n');
}

export function clampEditToCitation(
  filePath: string,
  startLine: unknown,
  endLine: unknown,
  citations: FileLineCitation[] | undefined
): { start_line: number; end_line: number; clamped: boolean } | null {
  const cite = findCitationForFile(citations, filePath);
  if (!cite) {
    return null;
  }
  const start = typeof startLine === 'number' ? startLine : parseInt(String(startLine ?? ''), 10);
  const end = typeof endLine === 'number' ? endLine : parseInt(String(endLine ?? ''), 10);
  const outOfRange = !Number.isFinite(start) || !Number.isFinite(end)
    || start < cite.startLine || end > cite.endLine || start > end;
  if (outOfRange) {
    return {
      start_line: cite.startLine,
      end_line: cite.endLine,
      clamped: true,
    };
  }
  return { start_line: start, end_line: end, clamped: false };
}

export function validateEditWithinCitation(
  filePath: string | undefined,
  args: Record<string, unknown>,
  citations: FileLineCitation[] | undefined
): string | null {
  if (!filePath || !citations?.length) {
    return null;
  }
  const cite = findCitationForFile(citations, filePath);
  if (!cite) {
    return null;
  }
  const start = args.start_line as number | undefined;
  const end = args.end_line as number | undefined;
  if (!start || !end) {
    return `O usuário citou ${cite.path}:${cite.startLine}-${cite.endLine}. Use edit_file replace_lines com start_line=${cite.startLine} e end_line=${cite.endLine}.`;
  }
  if (start < cite.startLine || end > cite.endLine) {
    return `Edição fora do trecho citado. O usuário pediu ${cite.path}:${cite.startLine}-${cite.endLine}, mas você usou ${start}-${end}. Corrija os números de linha.`;
  }
  return null;
}

/** Une citações de displayPrompt, prompt expandido, etc. sem duplicar */
export function mergeLineCitations(...groups: FileLineCitation[][]): FileLineCitation[] {
  const seen = new Set<string>();
  const out: FileLineCitation[] = [];
  for (const group of groups) {
    for (const c of group) {
      const key = `${c.path}:${c.startLine}-${c.endLine}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}
