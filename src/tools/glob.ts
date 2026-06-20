import * as fs from 'fs/promises';
import * as path from 'path';

interface GlobOptions {
  ignore?: string[];
}

export async function glob(pattern: string, options?: GlobOptions): Promise<string[]> {
  const results: string[] = [];
  const normalizedPattern = pattern.replace(/\\/g, '/');

  const starIndex = normalizedPattern.indexOf('**');
  if (starIndex === -1) {
    try {
      await fs.access(normalizedPattern);
      return [normalizedPattern];
    } catch {
      return [];
    }
  }

  const baseDir = normalizedPattern.substring(0, starIndex).replace(/\/$/, '') || '.';
  const filePattern = normalizedPattern.substring(starIndex + 2).replace(/^\//, '');

  await walkDir(baseDir, filePattern, results, options?.ignore ?? []);

  return results;
}

async function walkDir(
  dir: string,
  pattern: string,
  results: string[],
  ignore: string[]
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name).replace(/\\/g, '/');

    if (shouldIgnore(fullPath, ignore)) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkDir(fullPath, pattern, results, ignore);
    } else if (entry.isFile()) {
      if (matchesPattern(fullPath, pattern)) {
        results.push(fullPath);
      }
    }
  }
}

function shouldIgnore(filePath: string, ignore: string[]): boolean {
  return ignore.some((pat) => {
    const normalized = pat.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
    return new RegExp(normalized).test(filePath);
  });
}

function matchesPattern(filePath: string, pattern: string): boolean {
  if (!pattern || pattern === '*' || pattern === '**/*') {
    return true;
  }
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');
  return new RegExp(regex + '$').test(filePath) || new RegExp(regex).test(path.basename(filePath));
}
