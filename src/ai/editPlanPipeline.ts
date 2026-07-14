import * as fs from 'fs/promises';
import { AIProvider, ChatMessage } from './types';
import { extractFilenamesFromPrompt } from './taskCompletion';
import { extractToolCallsFromContent, toToolCalls } from './toolCallParser';
import { formatNumberedLines } from '../tools/fileReadChunks';
import { resolveWorkspacePath } from '../tools/pathUtils';
import {
  clampEditToCitation,
  findCitationForFile,
  formatCitationConstraint,
  parseLineCitations,
  type FileLineCitation,
} from './lineCitations';
import {
  EDIT_RESPONSE_TOKENS,
  PLAN_RESPONSE_TOKENS,
  VERIFY_RESPONSE_TOKENS,
} from './contextBudget';

export type EditPlanItemStatus = 'pending' | 'done' | 'failed' | 'skipped';

export interface EditPlanItem {
  id: string;
  path: string;
  start_line: number;
  end_line: number;
  description: string;
  read_start?: number;
  read_end?: number;
  status: EditPlanItemStatus;
  error?: string;
}

export interface EditPlan {
  analysis: string;
  requirements: string[];
  items: EditPlanItem[];
  verificationRound: number;
}

export interface PlanVerificationResult {
  complete: boolean;
  summary: string;
  missing: string[];
  additionalItems: Array<Omit<EditPlanItem, 'status' | 'error'>>;
}

export interface FileSnippet {
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  numbered: string;
}

const MAX_PLAN_ITEMS = 5;
const MAX_VERIFY_ROUNDS = 1;
const CONTEXT_PADDING = 4;
const MAX_SNIPPET_LINES = 40;

export function inferTargetFiles(goal: string, projectContext?: string): string[] {
  const fromPrompt = extractFilenamesFromPrompt(goal);
  const cited = parseLineCitations(goal).map((c) => c.path);

  const files = [...new Set([...fromPrompt, ...cited].map((f) => f.replace(/\\/g, '/')))];
  if (files.length > 0) {
    return files.slice(0, 5);
  }

  if (/documenta|readme|docs?|manual|instru[cç]/i.test(goal)) {
    return ['README.md'];
  }

  if (/ollama/i.test(goal)) {
    return ['README.md'];
  }

  if (/front|bonito|ui|painel|visual|layout|css|chat|embelez/i.test(goal)) {
    return ['src/ui/panelHtml.ts'];
  }
  if (/agent|edit_file|tool|loop|itera/i.test(goal)) {
    return ['src/ai/agentController.ts'];
  }

  if (projectContext) {
    const important = [...projectContext.matchAll(/^([\w./-]+\.\w{1,10})$/gm)].map((m) => m[1]);
    if (important.length > 0) {
      return important.slice(0, 2);
    }
  }

  return [];
}

export async function discoverTargetFiles(
  workspaceRoot: string,
  goal: string,
  projectContext?: string
): Promise<string[]> {
  const inferred = inferTargetFiles(goal, projectContext);
  const found: string[] = [];

  for (const file of inferred) {
    try {
      await fs.access(resolveWorkspacePath(workspaceRoot, file));
      found.push(file);
    } catch {
      // tenta próximo
    }
  }
  if (found.length > 0) {
    return found;
  }

  if (/documenta|readme|docs?|manual|instru|ollama/i.test(goal)) {
    for (const candidate of ['README.md', 'readme.md', 'docs/README.md', 'CONTRIBUTING.md']) {
      try {
        await fs.access(resolveWorkspacePath(workspaceRoot, candidate));
        return [candidate];
      } catch {
        // próximo
      }
    }
  }

  return [];
}

export async function loadFileSnippets(
  workspaceRoot: string,
  goal: string,
  extraFiles: string[] = [],
  citedRanges?: FileLineCitation[]
): Promise<FileSnippet[]> {
  const discovered = await discoverTargetFiles(workspaceRoot, goal);
  const files = [...new Set([...discovered, ...extraFiles])];
  const snippets: FileSnippet[] = [];
  const allCitations = citedRanges?.length ? citedRanges : parseLineCitations(goal);

  for (const file of files) {
    const fullPath = resolveWorkspacePath(workspaceRoot, file);
    let content: string;
    try {
      content = await fs.readFile(fullPath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    const total = lines.length;

    const citeMatch = findCitationForFile(allCitations, file)
      ?? allCitations.find((c) => file.endsWith(c.path.split('/').pop() ?? ''));

    let from = 1;
    let to = Math.min(MAX_SNIPPET_LINES, total);

    if (citeMatch) {
      from = citeMatch.startLine;
      to = citeMatch.endLine;
    } else {
      const atMatch = [...goal.matchAll(/@([^\s@:]+):(\d+)(?:-(\d+))?/g)].find(
        (m) => m[1].replace(/\\/g, '/') === file || file.endsWith(m[1])
      );
      if (atMatch) {
        const start = parseInt(atMatch[2], 10);
        const end = atMatch[3] ? parseInt(atMatch[3], 10) : start;
        from = Math.max(1, start - CONTEXT_PADDING);
        to = Math.min(total, end + CONTEXT_PADDING);
      } else if (/ollama|pull|serve/i.test(goal) && /\.md$/i.test(file)) {
        const anchor = lines.findIndex((l) => /ollama/i.test(l));
        if (anchor >= 0) {
          from = Math.max(1, anchor - 4);
          to = Math.min(total, anchor + 20);
        }
      } else if (/documenta/i.test(goal) && /\.md$/i.test(file)) {
        to = Math.min(total, 80);
      } else if (total > MAX_SNIPPET_LINES) {
        to = MAX_SNIPPET_LINES;
      }
    }

    const slice = lines.slice(from - 1, to);
    snippets.push({
      path: file,
      startLine: from,
      endLine: to,
      totalLines: total,
      numbered: formatNumberedLines(slice, from),
    });
  }

  return snippets;
}

export async function loadItemContext(
  workspaceRoot: string,
  item: EditPlanItem
): Promise<{ numbered: string; totalLines: number; from: number; to: number }> {
  const fullPath = resolveWorkspacePath(workspaceRoot, item.path);
  const content = await fs.readFile(fullPath, 'utf-8');
  const lines = content.split('\n');
  const total = lines.length;

  const from = Math.max(1, (item.read_start ?? item.start_line - CONTEXT_PADDING));
  const to = Math.min(total, (item.read_end ?? item.end_line + CONTEXT_PADDING));
  const slice = lines.slice(from - 1, to);
  return {
    numbered: formatNumberedLines(slice, from),
    totalLines: total,
    from,
    to,
  };
}

function extractJsonObject(text: string): unknown | null {
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [block?.[1]?.trim(), text.trim()].filter(Boolean) as string[];

  for (const raw of candidates) {
    try {
      return JSON.parse(raw);
    } catch {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(raw.slice(start, end + 1));
        } catch {
          // próximo candidato
        }
      }
    }
  }
  return null;
}

function normalizePlanItem(raw: Record<string, unknown>, index: number): EditPlanItem | null {
  const path = String(raw.path ?? raw.file ?? '').replace(/\\/g, '/');
  const start = asInt(raw.start_line ?? raw.startLine);
  const end = asInt(raw.end_line ?? raw.endLine);
  const description = String(raw.description ?? raw.change ?? raw.task ?? '').trim();

  if (!path || !start || !end || !description) {
    return null;
  }

  return {
    id: String(raw.id ?? `item-${index + 1}`),
    path,
    start_line: Math.min(start, end),
    end_line: Math.max(start, end),
    description,
    read_start: asInt(raw.read_start ?? raw.readStart),
    read_end: asInt(raw.read_end ?? raw.readEnd),
    status: 'pending',
  };
}

export function parseEditPlan(content: string): EditPlan | null {
  const parsed = extractJsonObject(content);
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  const rawItems = Array.isArray(obj.items) ? obj.items : [];
  const items: EditPlanItem[] = [];

  for (let i = 0; i < rawItems.length && items.length < MAX_PLAN_ITEMS; i++) {
    const item = rawItems[i];
    if (item && typeof item === 'object') {
      const normalized = normalizePlanItem(item as Record<string, unknown>, i);
      if (normalized) {
        items.push(normalized);
      }
    }
  }

  if (items.length === 0) {
    return null;
  }

  const requirements = Array.isArray(obj.requirements)
    ? obj.requirements.map(String).filter(Boolean)
    : [];

  return {
    analysis: String(obj.analysis ?? obj.summary ?? '').trim(),
    requirements,
    items,
    verificationRound: 0,
  };
}

export function formatPlanForDisplay(plan: EditPlan): string {
  const lines = [
    '## Plano de alterações',
    '',
    plan.analysis ? `**Análise:** ${plan.analysis}` : '',
    plan.requirements.length > 0
      ? `**Requisitos:**\n${plan.requirements.map((r) => `- ${r}`).join('\n')}`
      : '',
    '',
    `**${plan.items.length} alteração(ões) planejada(s):**`,
    ...plan.items.map(
      (item, i) =>
        `${i + 1}. \`${item.path}:${item.start_line}-${item.end_line}\` — ${item.description}`
    ),
  ];
  return lines.filter(Boolean).join('\n');
}

export function formatPlanProgress(plan: EditPlan): string {
  const done = plan.items.filter((i) => i.status === 'done').length;
  const failed = plan.items.filter((i) => i.status === 'failed').length;
  const pending = plan.items.filter((i) => i.status === 'pending').length;
  return `Plano: ${done} concluída(s), ${pending} pendente(s), ${failed} falha(s)`;
}

export function getNextPendingItem(plan: EditPlan): EditPlanItem | undefined {
  return plan.items.find((i) => i.status === 'pending');
}

export function buildPlanContextBlock(plan: EditPlan | undefined): string {
  if (!plan) {
    return '';
  }
  const pending = plan.items.filter((i) => i.status === 'pending');
  const done = plan.items.filter((i) => i.status === 'done');
  return [
    '',
    '## Plano de edição em andamento',
    plan.analysis ? `Análise: ${plan.analysis}` : '',
    done.length > 0 ? `Concluídas: ${done.map((i) => `${i.path}:${i.start_line}-${i.end_line}`).join(', ')}` : '',
    pending.length > 0 ? `Pendentes: ${pending.map((i) => `${i.path} — ${i.description}`).join('; ')}` : '',
    formatPlanProgress(plan),
  ].filter(Boolean).join('\n');
}

export async function generateEditPlan(
  provider: AIProvider,
  model: string,
  goal: string,
  projectContext: string,
  codeIndexSummary: string,
  snippets: FileSnippet[],
  citedRanges?: FileLineCitation[],
  signal?: AbortSignal
): Promise<EditPlan | null> {
  const citations = citedRanges?.length ? citedRanges : parseLineCitations(goal);
  const citeBlock = formatCitationConstraint(citations);
  const snippetBlock = snippets.length > 0
    ? snippets.map(
      (s) => `### ${s.path} (linhas ${s.startLine}-${s.endLine})\n${s.numbered}`
    ).join('\n\n')
    : '(Nenhum trecho pré-carregado — estime linhas com base no índice do projeto)';

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'Você é um planejador de edições de código.',
        'Analise o pedido e produza um plano com VÁRIAS alterações pequenas e independentes.',
        'Cada item = um trecho específico (linhas X–Y) em um arquivo.',
        'NÃO tente resolver tudo em um único item — divida por local e responsabilidade.',
        'Responda SOMENTE com JSON válido (sem markdown extra):',
        '{',
        '  "analysis": "resumo do que o pedido exige",',
        '  "requirements": ["requisito 1", "requisito 2"],',
        '  "items": [',
        '    { "id": "1", "path": "src/arquivo.ts", "start_line": 10, "end_line": 15,',
        '      "description": "o que mudar neste trecho", "read_start": 5, "read_end": 25 }',
        '  ]',
        '}',
        `Máximo ${MAX_PLAN_ITEMS} items. Intervalos de no máximo ~40 linhas por item.`,
        citeBlock
          ? 'Se o usuário citou trechos com linhas, TODOS os items devem ficar DENTRO desses intervalos — nunca edite outras linhas do arquivo.'
          : '',
      ].filter(Boolean).join('\n'),
    },
    {
      role: 'user',
      content: [
        `Pedido: ${goal}`,
        citeBlock,
        '',
        '## Projeto',
        projectContext || '(sem contexto)',
        '',
        codeIndexSummary ? `## Índice de código\n${codeIndexSummary}` : '',
        '',
        '## Trechos atuais',
        snippetBlock,
      ].filter(Boolean).join('\n'),
    },
  ];

  const response = await provider.chat(messages, {
    model,
    temperature: 0,
    maxResponseTokens: PLAN_RESPONSE_TOKENS,
    signal,
  });

  const plan = parseEditPlan(response.content);
  return plan ? clampPlanToCitations(plan, citations) : null;
}

function clampPlanToCitations(plan: EditPlan, citations: FileLineCitation[]): EditPlan {
  if (!citations.length) {
    return plan;
  }
  for (const item of plan.items) {
    const cite = findCitationForFile(citations, item.path);
    if (!cite) {
      continue;
    }
    if (item.start_line < cite.startLine || item.end_line > cite.endLine) {
      item.start_line = cite.startLine;
      item.end_line = cite.endLine;
      item.description = `${item.description} (restrito ao trecho citado ${cite.startLine}-${cite.endLine})`;
    }
  }
  return plan;
}

export async function generateEditForPlanItem(
  provider: AIProvider,
  model: string,
  goal: string,
  item: EditPlanItem,
  numberedContext: string,
  completedItems: EditPlanItem[],
  citedRanges?: FileLineCitation[],
  signal?: AbortSignal
): Promise<Record<string, unknown> | null> {
  const citeBlock = formatCitationConstraint(citedRanges);
  const doneSummary = completedItems
    .filter((i) => i.status === 'done')
    .map((i) => `- ${i.path}:${i.start_line}-${i.end_line} ✓`)
    .join('\n');

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'Você gera UMA edição cirúrgica por vez.',
        'Responda SOMENTE com JSON:',
        '{"name":"edit_file","arguments":{"path":"...","action":"replace_lines","start_line":N,"end_line":M,"content":"..."}}',
        'content usa \\n para quebras. Edite APENAS o intervalo deste item.',
        citeBlock ? 'Respeite o trecho citado pelo usuário — não altere linhas fora dele.' : '',
      ].filter(Boolean).join('\n'),
    },
    {
      role: 'user',
      content: [
        `Pedido geral: ${goal}`,
        citeBlock,
        '',
        `Alteração atual (${item.id}): ${item.description}`,
        `Arquivo: ${item.path}`,
        `Substituir linhas ${item.start_line}–${item.end_line}`,
        doneSummary ? `\nJá aplicadas:\n${doneSummary}` : '',
        '',
        'Trecho com numeração:',
        numberedContext,
      ].filter(Boolean).join('\n'),
    },
  ];

  const response = await provider.chat(messages, {
    model,
    temperature: 0,
    maxResponseTokens: EDIT_RESPONSE_TOKENS,
    signal,
  });

  let toolCall = response.toolCalls?.[0];
  if (!toolCall) {
    const extracted = extractToolCallsFromContent(response.content);
    if (extracted?.[0]) {
      toolCall = toToolCalls(extracted)[0];
    }
  }

  if (!toolCall || toolCall.name !== 'edit_file') {
    const fromJson = extractJsonContent(response.content);
    if (fromJson) {
      return {
        path: item.path,
        action: 'replace_lines',
        start_line: item.start_line,
        end_line: item.end_line,
        content: fromJson,
      };
    }
    const plan = parseEditPlan(response.content);
    if (plan?.items[0]) {
      return {
        path: plan.items[0].path,
        action: 'replace_lines',
        start_line: plan.items[0].start_line,
        end_line: plan.items[0].end_line,
        content: '',
      };
    }
    return null;
  }

  const args = { ...toolCall.arguments } as Record<string, unknown>;
  args.path = args.path ?? item.path;
  args.action = 'replace_lines';
  args.start_line = args.start_line ?? item.start_line;
  args.end_line = args.end_line ?? item.end_line;

  const clamped = clampEditToCitation(
    String(args.path),
    args.start_line,
    args.end_line,
    citedRanges
  );
  if (clamped) {
    args.start_line = clamped.start_line;
    args.end_line = clamped.end_line;
  }

  return args;
}

function extractJsonContent(text: string): string | null {
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [block?.[1]?.trim(), text.trim()].filter(Boolean) as string[];
  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.content === 'string' && parsed.content.trim()) {
        return parsed.content;
      }
    } catch {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
          if (typeof parsed.content === 'string' && parsed.content.trim()) {
            return parsed.content;
          }
        } catch {
          // próximo
        }
      }
    }
  }
  return null;
}

export function parseVerificationResult(content: string): PlanVerificationResult {
  const parsed = extractJsonObject(content);
  const fallback: PlanVerificationResult = {
    complete: false,
    summary: content.trim().slice(0, 500),
    missing: [],
    additionalItems: [],
  };

  if (!parsed || typeof parsed !== 'object') {
    return fallback;
  }

  const obj = parsed as Record<string, unknown>;
  const additionalItems: PlanVerificationResult['additionalItems'] = [];

  if (Array.isArray(obj.additional_items)) {
    for (let i = 0; i < obj.additional_items.length && additionalItems.length < MAX_PLAN_ITEMS; i++) {
      const raw = obj.additional_items[i];
      if (raw && typeof raw === 'object') {
        const item = normalizePlanItem(raw as Record<string, unknown>, i);
        if (item) {
          const { status: _s, error: _e, ...rest } = item;
          additionalItems.push(rest);
        }
      }
    }
  }

  const missing = Array.isArray(obj.missing)
    ? obj.missing.map(String).filter(Boolean)
    : [];

  return {
    complete: obj.complete === true || obj.satisfied === true,
    summary: String(obj.summary ?? obj.analysis ?? '').trim(),
    missing,
    additionalItems,
  };
}

export async function verifyEditPlan(
  provider: AIProvider,
  model: string,
  goal: string,
  plan: EditPlan,
  changedFiles: string[],
  signal?: AbortSignal
): Promise<PlanVerificationResult> {
  const itemReport = plan.items.map((item) => {
    const status = item.status === 'done' ? '✓' : item.status === 'failed' ? '✗' : '○';
    return `${status} ${item.path}:${item.start_line}-${item.end_line} — ${item.description}${item.error ? ` (${item.error})` : ''}`;
  }).join('\n');

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'Você verifica se um plano de edições atende ao pedido original.',
        'Responda SOMENTE com JSON:',
        '{',
        '  "complete": true/false,',
        '  "summary": "o que foi feito e o que falta",',
        '  "missing": ["requisito ainda não atendido"],',
        '  "additional_items": [',
        '    { "id": "extra-1", "path": "...", "start_line": N, "end_line": M, "description": "..." }',
        '  ]',
        '}',
        'additional_items só se complete=false e houver trechos específicos faltando.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Pedido original: ${goal}`,
        '',
        `Requisitos planejados: ${plan.requirements.join('; ') || '(não listados)'}`,
        '',
        'Itens do plano:',
        itemReport,
        '',
        `Arquivos alterados nesta sessão: ${changedFiles.join(', ') || '(nenhum)'}`,
        '',
        'O pedido foi totalmente atendido? Falta algum trecho ou requisito?',
      ].join('\n'),
    },
  ];

  const response = await provider.chat(messages, {
    model,
    temperature: 0,
    maxResponseTokens: VERIFY_RESPONSE_TOKENS,
    signal,
  });

  return parseVerificationResult(response.content);
}

export function appendItemsToPlan(plan: EditPlan, items: Array<Omit<EditPlanItem, 'status' | 'error'>>): void {
  const baseId = plan.items.length;
  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    plan.items.push({
      ...raw,
      id: raw.id || `extra-${baseId + i + 1}`,
      status: 'pending',
    });
  }
}

export function canRunVerificationRound(plan: EditPlan): boolean {
  return plan.verificationRound < MAX_VERIFY_ROUNDS;
}

function findMarkdownCodeBlock(lines: string[], anchorLine: number): { start: number; end: number } {
  let start = anchorLine;
  let end = anchorLine;
  for (let i = anchorLine; i >= 0; i--) {
    if (lines[i].trim().startsWith('```')) {
      start = i;
      break;
    }
  }
  for (let i = anchorLine; i < lines.length; i++) {
    if (lines[i].trim() === '```' && i > start) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** Plano sem IA quando o pedido e o arquivo permitem inferência direta */
export async function buildHeuristicPlan(
  workspaceRoot: string,
  goal: string,
  citedRanges?: FileLineCitation[]
): Promise<EditPlan | null> {
  const citations = citedRanges?.length ? citedRanges : parseLineCitations(goal);

  if (citations.length > 0) {
    const items: EditPlanItem[] = [];
    for (let i = 0; i < citations.length; i++) {
      const cite = citations[i];
      let path = cite.path;
      try {
        await fs.access(resolveWorkspacePath(workspaceRoot, path));
      } catch {
        const discovered = await discoverTargetFiles(workspaceRoot, goal);
        const match = discovered.find((f) => findCitationForFile([cite], f));
        if (!match) {
          continue;
        }
        path = match;
      }
      items.push({
        id: `cite-${i + 1}`,
        path,
        start_line: cite.startLine,
        end_line: cite.endLine,
        description: `Atualizar trecho citado (${cite.startLine}-${cite.endLine}) conforme pedido`,
        read_start: Math.max(1, cite.startLine - CONTEXT_PADDING),
        read_end: cite.endLine + CONTEXT_PADDING,
        status: 'pending',
      });
    }
    if (items.length > 0) {
      return {
        analysis: 'Plano baseado no trecho citado pelo usuário — edite somente esse intervalo.',
        requirements: ['Atualizar o trecho citado conforme pedido'],
        items,
        verificationRound: 0,
      };
    }
  }

  const files = await discoverTargetFiles(workspaceRoot, goal);
  if (files.length === 0) {
    return null;
  }

  const items: EditPlanItem[] = [];
  const requirements: string[] = [];

  if (/documenta/i.test(goal)) {
    requirements.push('Atualizar documentação do projeto');
  }
  if (/ollama/i.test(goal)) {
    requirements.push('Ajustar instruções do Ollama na documentação');
  }

  for (const file of files) {
    const fullPath = resolveWorkspacePath(workspaceRoot, file);
    let content: string;
    try {
      content = await fs.readFile(fullPath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    const pullLines = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /ollama\s+pull/i.test(line));

    const wantsServe = /serve|troque.*pull|pull.*serve|substitu.*pull/i.test(goal);

    if (pullLines.length > 0 && wantsServe) {
      requirements.push('Trocar ollama pull por ollama serve');

      const block = findMarkdownCodeBlock(lines, pullLines[0].index);
      items.push({
        id: 'ollama-code-block',
        path: file,
        start_line: block.start + 1,
        end_line: block.end + 1,
        description: 'Substituir bloco de instalação: ollama pull → ollama serve',
        status: 'pending',
      });

      const prereqIdx = lines.findIndex((l) => /modelo.*instalado|pré-requisito/i.test(l));
      if (prereqIdx >= 0) {
        items.push({
          id: 'ollama-prereq-text',
          path: file,
          start_line: prereqIdx + 1,
          end_line: prereqIdx + 1,
          description: 'Atualizar texto dos pré-requisitos do Ollama',
          status: 'pending',
        });
      }
    } else if (/documenta/i.test(goal) && /\.md$/i.test(file) && citations.length === 0) {
      items.push({
        id: 'doc-update',
        path: file,
        start_line: 1,
        end_line: Math.min(60, lines.length),
        description: 'Atualizar documentação conforme pedido',
        status: 'pending',
      });
    }
  }

  if (items.length === 0) {
    return null;
  }

  return {
    analysis: 'Plano inferido automaticamente a partir do pedido e dos arquivos do projeto.',
    requirements,
    items,
    verificationRound: 0,
  };
}

/** Edição determinística para padrões conhecidos (ex.: ollama pull → serve) */
export async function buildDeterministicEditArgs(
  workspaceRoot: string,
  item: EditPlanItem,
  goal: string
): Promise<Record<string, unknown> | null> {
  const fullPath = resolveWorkspacePath(workspaceRoot, item.path);
  let content: string;
  try {
    content = await fs.readFile(fullPath, 'utf-8');
  } catch {
    return null;
  }

  const lines = content.split('\n');
  const wantsServe = /serve|troque.*pull|pull.*serve|substitu.*pull/i.test(goal);

  if (item.id === 'ollama-code-block' && wantsServe) {
    const slice = lines.slice(item.start_line - 1, item.end_line);
    if (slice.some((l) => /ollama\s+pull/i.test(l)) || slice.some((l) => /```/.test(l))) {
      return {
        path: item.path,
        action: 'replace_lines',
        start_line: item.start_line,
        end_line: item.end_line,
        content: ['```bash', 'ollama serve', '```'].join('\n'),
      };
    }
  }

  if (item.id === 'ollama-prereq-text' && wantsServe) {
    const line = lines[item.start_line - 1] ?? '';
    if (/modelo/i.test(line)) {
      return {
        path: item.path,
        action: 'replace_lines',
        start_line: item.start_line,
        end_line: item.end_line,
        content: '3. Inicie o Ollama (`ollama serve` em um terminal)',
      };
    }
  }

  if (item.start_line === item.end_line && wantsServe) {
    const line = lines[item.start_line - 1] ?? '';
    if (/ollama\s+pull/i.test(line)) {
      return {
        path: item.path,
        action: 'replace_lines',
        start_line: item.start_line,
        end_line: item.end_line,
        content: line.replace(/ollama\s+pull\s+\S+/, 'ollama serve'),
      };
    }
  }

  return null;
}

export function isDocumentationOnlyChanges(changedFiles: string[]): boolean {
  return changedFiles.length > 0 && changedFiles.every((f) => /\.(md|mdx|txt)$/i.test(f));
}

function asInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
