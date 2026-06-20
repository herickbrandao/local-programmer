export type EditAction = 'search_replace' | 'replace_lines' | 'insert_lines' | 'delete_lines';

export interface EditFileInput {
  path: string;
  action: EditAction;
  old_text?: string;
  new_text?: string;
  start_line?: number;
  end_line?: number;
  after_line?: number;
  content?: string;
  /** Texto esperado nas linhas start–end (sem prefixo N|). Falha com preview numerado se não bater. */
  verify_content?: string;
}

export interface EditFileResult {
  success: boolean;
  message: string;
  oldContent: string;
  newContent: string;
  linesChanged?: { from: number; to: number };
}

function splitLines(content: string): string[] {
  return content.split('\n');
}

function joinLines(lines: string[]): string {
  return lines.join('\n');
}

function formatNumberedSlice(lines: string[], from: number, to: number): string {
  const start = Math.max(1, from);
  const end = Math.min(lines.length, to);
  if (start > end || lines.length === 0) {
    return '(arquivo vazio ou intervalo inválido)';
  }
  return lines
    .slice(start - 1, end)
    .map((line, index) => `${start + index}| ${line}`)
    .join('\n');
}

function sliceText(lines: string[], from: number, to: number): string {
  return joinLines(lines.slice(from - 1, to));
}

function contentMatches(actual: string, expected: string): boolean {
  if (actual === expected) {
    return true;
  }
  const normalize = (text: string) => text.split('\n').map((line) => line.trimEnd()).join('\n');
  return normalize(actual) === normalize(expected);
}

function verifyLinesOrError(
  lines: string[],
  from: number,
  to: number,
  verifyContent: string | undefined
): { ok: true } | { ok: false; message: string } {
  if (verifyContent === undefined) {
    return { ok: true };
  }
  const actual = sliceText(lines, from, to);
  if (contentMatches(actual, verifyContent)) {
    return { ok: true };
  }
  return {
    ok: false,
    message: [
      `verify_content não confere com linhas ${from}-${to}.`,
      'Conteúdo atual no arquivo:',
      formatNumberedSlice(lines, from, to),
      '',
      'Reler com read_file (start_line/end_line) e repetir edit_file com números corretos.',
    ].join('\n'),
  };
}

function findUniqueMatch(haystack: string, needle: string): { index: number } | { error: string } {
  if (!needle) {
    return { error: 'old_text não pode ser vazio em search_replace' };
  }

  const first = haystack.indexOf(needle);
  if (first === -1) {
    return { error: 'old_text não encontrado no arquivo. Copie o trecho EXATO de read_file (incluindo espaços).' };
  }

  const second = haystack.indexOf(needle, first + needle.length);
  if (second !== -1) {
    const before = haystack.slice(0, second);
    const line = before.split('\n').length;
    return { error: `old_text aparece mais de uma vez (2ª ocorrência ~linha ${line}). Use replace_lines ou inclua mais contexto.` };
  }

  return { index: first };
}

export function applyFileEdit(currentContent: string, input: EditFileInput): EditFileResult {
  const lines = splitLines(currentContent);

  switch (input.action) {
    case 'search_replace': {
      if (input.old_text === undefined || input.new_text === undefined) {
        return {
          success: false,
          message: 'search_replace exige old_text e new_text',
          oldContent: currentContent,
          newContent: currentContent,
        };
      }

      const match = findUniqueMatch(currentContent, input.old_text);
      if ('error' in match) {
        return { success: false, message: match.error, oldContent: currentContent, newContent: currentContent };
      }

      const newContent = currentContent.slice(0, match.index)
        + input.new_text
        + currentContent.slice(match.index + input.old_text.length);

      const fromLine = currentContent.slice(0, match.index).split('\n').length;
      const toLine = fromLine + input.old_text.split('\n').length - 1;

      return {
        success: true,
        message: `Substituição aplicada (linhas ~${fromLine}-${toLine})`,
        oldContent: currentContent,
        newContent,
        linesChanged: { from: fromLine, to: toLine },
      };
    }

    case 'replace_lines': {
      const start = input.start_line;
      const end = input.end_line ?? input.start_line;
      if (start === undefined || end === undefined) {
        return {
          success: false,
          message: 'replace_lines exige start_line e end_line (números do read_file, ex: 118| ...)',
          oldContent: currentContent,
          newContent: currentContent,
        };
      }
      if (contentMissing(input.content)) {
        return {
          success: false,
          message: 'replace_lines exige content (pode ser string vazia para limpar linhas)',
          oldContent: currentContent,
          newContent: currentContent,
        };
      }

      if (start < 1 || end < 1) {
        return {
          success: false,
          message: 'start_line e end_line devem ser >= 1 (numeração do read_file)',
          oldContent: currentContent,
          newContent: currentContent,
        };
      }

      if (start > lines.length) {
        const previewFrom = Math.max(1, lines.length - 4);
        return {
          success: false,
          message: [
            `start_line ${start} além do fim — arquivo tem ${lines.length} linha(s).`,
            previewFrom <= lines.length ? 'Final do arquivo:' : '',
            previewFrom <= lines.length ? formatNumberedSlice(lines, previewFrom, lines.length) : '',
          ].filter(Boolean).join('\n'),
          oldContent: currentContent,
          newContent: currentContent,
        };
      }

      const from = Math.min(start, lines.length);
      const to = Math.min(end, lines.length);
      if (from > to) {
        return { success: false, message: 'start_line não pode ser maior que end_line', oldContent: currentContent, newContent: currentContent };
      }

      const verify = verifyLinesOrError(lines, from, to, input.verify_content);
      if (!verify.ok) {
        return { success: false, message: verify.message, oldContent: currentContent, newContent: currentContent };
      }

      const before = formatNumberedSlice(lines, from, to);
      const replacement = splitLines(input.content ?? '');
      const newLines = [...lines.slice(0, from - 1), ...replacement, ...lines.slice(to)];
      return {
        success: true,
        message: [
          `Linhas ${from}-${to} substituídas (${replacement.length} linha(s) novas).`,
          'Antes:',
          before,
        ].join('\n'),
        oldContent: currentContent,
        newContent: joinLines(newLines),
        linesChanged: { from, to },
      };
    }

    case 'insert_lines': {
      const after = input.after_line;
      if (after === undefined) {
        return {
          success: false,
          message: 'insert_lines exige after_line (0 = início do arquivo)',
          oldContent: currentContent,
          newContent: currentContent,
        };
      }
      if (contentMissing(input.content)) {
        return {
          success: false,
          message: 'insert_lines exige content',
          oldContent: currentContent,
          newContent: currentContent,
        };
      }

      const insertAt = clampLine(after + 1, lines.length + 1) - 1;
      const insertLines = splitLines(input.content ?? '');
      const newLines = [...lines.slice(0, insertAt), ...insertLines, ...lines.slice(insertAt)];
      return {
        success: true,
        message: `${insertLines.length} linha(s) inserida(s) após linha ${after}`,
        oldContent: currentContent,
        newContent: joinLines(newLines),
        linesChanged: { from: after + 1, to: after + insertLines.length },
      };
    }

    case 'delete_lines': {
      const start = input.start_line;
      const end = input.end_line ?? input.start_line;
      if (start === undefined || end === undefined) {
        return {
          success: false,
          message: 'delete_lines exige start_line e end_line',
          oldContent: currentContent,
          newContent: currentContent,
        };
      }

      if (start < 1 || start > lines.length) {
        return {
          success: false,
          message: `start_line ${start} inválida — arquivo tem ${lines.length} linha(s).`,
          oldContent: currentContent,
          newContent: currentContent,
        };
      }

      const from = Math.min(start, lines.length);
      const to = Math.min(end, lines.length);
      if (from > to) {
        return { success: false, message: 'start_line não pode ser maior que end_line', oldContent: currentContent, newContent: currentContent };
      }

      const verify = verifyLinesOrError(lines, from, to, input.verify_content);
      if (!verify.ok) {
        return { success: false, message: verify.message, oldContent: currentContent, newContent: currentContent };
      }

      const removed = formatNumberedSlice(lines, from, to);
      const newLines = [...lines.slice(0, from - 1), ...lines.slice(to)];
      return {
        success: true,
        message: `Linhas ${from}-${to} removidas:\n${removed}`,
        oldContent: currentContent,
        newContent: joinLines(newLines),
        linesChanged: { from, to },
      };
    }

    default:
      return {
        success: false,
        message: `Ação desconhecida: ${input.action as string}`,
        oldContent: currentContent,
        newContent: currentContent,
      };
  }
}

function contentMissing(content: string | undefined): boolean {
  return content === undefined;
}

function clampLine(line: number, max: number): number {
  if (line < 1) {
    return 1;
  }
  if (line > max) {
    return max;
  }
  return line;
}

export function validateNoFullOverwrite(
  oldContent: string | undefined,
  newContent: string | undefined,
  currentFileLength: number
): string | null {
  if (oldContent) {
    return null;
  }
  if (newContent === undefined) {
    return null;
  }
  if (currentFileLength > 80 && newContent.length >= currentFileLength * 0.85) {
    return 'Substituição do arquivo inteiro bloqueada. Use edit_file (search_replace ou replace_lines) para alterações cirúrgicas.';
  }
  return null;
}
