interface TreeNode {
  name: string;
  isFile: boolean;
  children: TreeNode[];
}

function insertPath(root: TreeNode, parts: string[]): void {
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isFile = i === parts.length - 1;
    let child = current.children.find((c) => c.name === part);
    if (!child) {
      child = { name: part, isFile, children: [] };
      current.children.push(child);
    } else if (isFile) {
      child.isFile = true;
    }
    current = child;
  }
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isFile !== b.isFile) {
      return a.isFile ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });
}

function renderChildren(nodes: TreeNode[], prefix: string): string[] {
  const lines: string[] = [];
  const sorted = sortNodes(nodes);

  for (let i = 0; i < sorted.length; i++) {
    const node = sorted[i];
    const isLast = i === sorted.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const nextPrefix = prefix + (isLast ? '    ' : '│   ');

    if (node.isFile && node.children.length === 0) {
      lines.push(`${prefix}${connector}${node.name}`);
    } else {
      lines.push(`${prefix}${connector}${node.name}/`);
      lines.push(...renderChildren(node.children, nextPrefix));
    }
  }

  return lines;
}

/** Gera árvore estilo README (src/ na primeira linha, ├── / └── nos filhos) */
export function buildMarkdownDirectoryTree(rootDir: string, relativePaths: string[]): string {
  const normalizedRoot = rootDir.replace(/\\/g, '/').replace(/\/$/, '');
  const prefix = `${normalizedRoot}/`;

  const filtered = relativePaths
    .map((p) => p.replace(/\\/g, '/'))
    .filter((p) => p === normalizedRoot || p.startsWith(prefix))
    .map((p) => (p === normalizedRoot ? '' : p.slice(prefix.length)))
    .filter(Boolean);

  const virtualRoot: TreeNode = { name: normalizedRoot, isFile: false, children: [] };
  for (const rel of filtered) {
    insertPath(virtualRoot, rel.split('/'));
  }

  return [`${normalizedRoot}/`, ...renderChildren(virtualRoot.children, '')].join('\n');
}

export function detectTreeRootFromLines(lines: string[]): string {
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[\w./-]+\/$/.test(trimmed) && !trimmed.includes('├──') && !trimmed.includes('└──')) {
      return trimmed.replace(/\/$/, '');
    }
  }
  return 'src';
}

export function looksLikeDirectoryTree(lines: string[]): boolean {
  const text = lines.join('\n');
  return /[├└│]──/.test(text) || /^[\w.-]+\/$/m.test(text);
}
