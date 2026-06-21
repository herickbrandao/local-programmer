export const DEFAULT_CHUNK_LINES = 350;
export const LARGE_FILE_THRESHOLD = 120;

export interface LineRange {
  from: number;
  to: number;
}

export interface FileReadCoverageEntry {
  totalLines: number;
  ranges: LineRange[];
}

export type FileReadCoverageMap = Record<string, FileReadCoverageEntry>;

export function normalizeRelPath(filePath: string): string {
  return filePath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

export function getCoverageEntry(
  coverage: FileReadCoverageMap,
  filePath: string
): FileReadCoverageEntry | undefined {
  const norm = normalizeRelPath(filePath).toLowerCase();
  const direct = coverage[normalizeRelPath(filePath)];
  if (direct) {
    return direct;
  }
  for (const [key, entry] of Object.entries(coverage)) {
    const keyNorm = normalizeRelPath(key).toLowerCase();
    if (keyNorm === norm || keyNorm.endsWith(`/${norm}`) || norm.endsWith(`/${keyNorm}`)) {
      return entry;
    }
  }
  return undefined;
}

export function getNextUnreadRange(
  coverage: FileReadCoverageMap,
  filePath: string,
  maxSpan = DEFAULT_CHUNK_LINES
): { start: number; end: number } | null {
  const entry = getCoverageEntry(coverage, filePath);
  if (!entry || entry.ranges.length === 0) {
    return null;
  }
  if (isFileFullyRead(coverage, filePath)) {
    return null;
  }
  const next = Math.max(...entry.ranges.map((r) => r.to), 0) + 1;
  if (next > entry.totalLines) {
    return null;
  }
  return {
    start: next,
    end: Math.min(entry.totalLines, next + maxSpan - 1),
  };
}

export function resolveReadRange(
  totalLines: number,
  startLine?: number,
  endLine?: number,
  continueRead?: boolean,
  coverage?: FileReadCoverageEntry,
  chunkSize = DEFAULT_CHUNK_LINES
): { from: number; to: number; hasMore: boolean; nextStart: number | null } {
  if (continueRead && coverage && coverage.ranges.length > 0) {
    const lastEnd = Math.max(...coverage.ranges.map((r) => r.to));
    const from = lastEnd + 1;
    if (from > totalLines) {
      return { from: totalLines, to: totalLines, hasMore: false, nextStart: null };
    }
    const to = Math.min(totalLines, from + chunkSize - 1);
    return {
      from,
      to,
      hasMore: to < totalLines,
      nextStart: to < totalLines ? to + 1 : null,
    };
  }

  if (startLine !== undefined || endLine !== undefined) {
    const from = clamp(startLine ?? 1, 1, totalLines);
    const to = clamp(endLine ?? startLine ?? from + chunkSize - 1, from, totalLines);
    return {
      from,
      to,
      hasMore: to < totalLines,
      nextStart: to < totalLines ? to + 1 : null,
    };
  }

  if (totalLines <= LARGE_FILE_THRESHOLD) {
    return { from: 1, to: totalLines, hasMore: false, nextStart: null };
  }

  const to = Math.min(totalLines, chunkSize);
  return {
    from: 1,
    to,
    hasMore: to < totalLines,
    nextStart: to < totalLines ? to + 1 : null,
  };
}

export function formatNumberedLines(lines: string[], fromLine: number): string {
  return lines.map((line, i) => `${fromLine + i}| ${line}`).join('\n');
}

export function buildReadOutput(
  filePath: string,
  numberedBody: string,
  from: number,
  to: number,
  totalLines: number,
  hasMore: boolean,
  nextStart: number | null,
  continueRead?: boolean
): string {
  const header = `Arquivo: ${filePath} · linhas ${from}-${to} de ${totalLines}`;
  const parts = [header, '', numberedBody];

  if (hasMore && nextStart !== null) {
    parts.push(
      '',
      `--- Há mais conteúdo (${totalLines - to} linhas restantes) ---`,
      `Próximo trecho: read_file path="${filePath}" start_line=${nextStart}`,
      `Ou: read_file path="${filePath}" continue_read=true`
    );
  } else if (continueRead && from > to) {
    parts.push('', '--- Arquivo já lido por completo nesta sessão ---');
  } else if (!hasMore && totalLines > LARGE_FILE_THRESHOLD) {
    parts.push('', '--- Fim do arquivo ---');
  }

  return parts.join('\n');
}

export function recordReadRange(
  coverage: FileReadCoverageMap,
  filePath: string,
  from: number,
  to: number,
  totalLines: number
): void {
  const key = normalizeRelPath(filePath);
  const existing = getCoverageEntry(coverage, filePath) ?? coverage[key] ?? { totalLines, ranges: [] };
  existing.totalLines = totalLines;
  existing.ranges.push({ from, to });
  existing.ranges.sort((a, b) => a.from - b.from);
  coverage[key] = existing;
}

export function isRangeFullyRead(
  coverage: FileReadCoverageMap,
  filePath: string,
  from: number,
  to: number
): boolean {
  const entry = getCoverageEntry(coverage, filePath);
  if (!entry) {
    return false;
  }
  return entry.ranges.some((r) => r.from <= from && r.to >= to);
}

export function isFileFullyRead(coverage: FileReadCoverageMap, filePath: string): boolean {
  const entry = getCoverageEntry(coverage, filePath);
  if (!entry || entry.ranges.length === 0) {
    return false;
  }
  const maxEnd = Math.max(...entry.ranges.map((r) => r.to));
  return maxEnd >= entry.totalLines;
}

export function formatCoverageSummary(coverage: FileReadCoverageMap): string[] {
  const lines: string[] = [];
  for (const [file, entry] of Object.entries(coverage)) {
    const merged = mergeRanges(entry.ranges);
    const parts = merged.map((r) => `${r.from}-${r.to}`).join(', ');
    const maxEnd = merged.length > 0 ? Math.max(...merged.map((r) => r.to)) : 0;
    const complete = maxEnd >= entry.totalLines ? ' ✓ completo' : ` (${entry.totalLines - maxEnd} linhas não lidas)`;
    lines.push(`- ${file}: linhas ${parts} / ${entry.totalLines}${complete}`);
  }
  return lines;
}

export function mergeRanges(ranges: LineRange[]): LineRange[] {
  if (ranges.length === 0) {
    return [];
  }
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged: LineRange[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.from <= last.to + 1) {
      last.to = Math.max(last.to, cur.to);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
