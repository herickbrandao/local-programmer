import { AIProvider } from './types';
import { TaskState } from './taskTracker';
import { ContextManager } from '../workspace/contextManager';
import { ToolResult } from '../tools/types';
import { PendingChange, FileChange } from './types';
import { recordReadRange } from '../tools/fileReadChunks';
import { normalizeToolArgs } from '../tools/pathUtils';
import { coerceImplementPhaseRead } from './executionPhase';
import {
  EditPlan,
  appendItemsToPlan,
  buildDeterministicEditArgs,
  buildHeuristicPlan,
  canRunVerificationRound,
  formatPlanForDisplay,
  formatPlanProgress,
  generateEditForPlanItem,
  generateEditPlan,
  getNextPendingItem,
  isDocumentationOnlyChanges,
  loadFileSnippets,
  loadItemContext,
  verifyEditPlan,
} from './editPlanPipeline';

export interface PlanRunnerDeps {
  provider: AIProvider;
  model: string;
  workspaceRoot: string;
  contextManager: ContextManager;
  emitThinking: (content: string) => void;
  emitMessage: (content: string) => void;
  executeEdit: (
    args: Record<string, unknown>,
    taskState: TaskState,
    pendingChanges: PendingChange[],
    sessionChanges: FileChange[]
  ) => Promise<ToolResult>;
  runCompileCheck: () => Promise<{ ok: boolean; output: string }>;
}

export interface PlanRunnerResult {
  handled: boolean;
  success: boolean;
  plan?: EditPlan;
  changesCount: number;
  message: string;
}

export async function runPlanDrivenPipeline(
  goal: string,
  taskState: TaskState,
  projectContext: string,
  pendingChanges: PendingChange[],
  sessionChanges: FileChange[],
  deps: PlanRunnerDeps
): Promise<PlanRunnerResult> {
  const initialChanges = sessionChanges.length;

  deps.emitThinking('Analisando pedido e montando plano de alterações...');

  const codeIndexSummary = await deps.contextManager.getCodeIndexSummary(deps.workspaceRoot);
  const snippets = await loadFileSnippets(
    deps.workspaceRoot,
    goal,
    [],
    taskState.citedRanges
  );

  for (const snippet of snippets) {
    taskState.filesRead.add(snippet.path);
    recordReadRange(
      taskState.fileReadCoverage,
      snippet.path,
      snippet.startLine,
      snippet.endLine,
      snippet.totalLines
    );
  }

  let plan: EditPlan | null = null;

  if (taskState.citedRanges?.length) {
    plan = await buildHeuristicPlan(deps.workspaceRoot, goal, taskState.citedRanges);
    if (plan) {
      deps.emitThinking('Plano baseado no trecho citado (@arquivo:linhas).');
    }
  }

  if (!plan) {
    plan = await generateEditPlan(
      deps.provider,
      deps.model,
      goal,
      projectContext,
      codeIndexSummary,
      snippets,
      taskState.citedRanges
    );
  }

  if (!plan || plan.items.length === 0) {
    plan = await buildHeuristicPlan(deps.workspaceRoot, goal, taskState.citedRanges);
    if (plan) {
      deps.emitThinking('Plano inferido automaticamente (documentação / padrões conhecidos).');
    }
  }

  if (!plan || plan.items.length === 0) {
    return {
      handled: false,
      success: false,
      changesCount: 0,
      message: 'Não foi possível gerar plano estruturado — usando modo agente padrão.',
    };
  }

  taskState.editPlan = plan;
  taskState.planPhase = 'executing';

  const planDisplay = formatPlanForDisplay(plan);
  deps.emitMessage(planDisplay);

  let compileOk = true;
  let compileOutput = '';

  while (true) {
    const item = getNextPendingItem(plan);
    if (!item) {
      break;
    }

    const itemIndex = plan.items.filter((i) => i.status !== 'pending').length + 1;
    deps.emitThinking(
      `Aplicando ${itemIndex}/${plan.items.length}: ${item.path}:${item.start_line}-${item.end_line} — ${item.description}`
    );

    try {
      const ctx = await loadItemContext(deps.workspaceRoot, item);
      recordReadRange(
        taskState.fileReadCoverage,
        item.path,
        ctx.from,
        ctx.to,
        ctx.totalLines
      );
      taskState.filesRead.add(item.path);

      let editArgs = await buildDeterministicEditArgs(deps.workspaceRoot, item, goal);
      if (!editArgs) {
        editArgs = await generateEditForPlanItem(
          deps.provider,
          deps.model,
          goal,
          item,
          ctx.numbered,
          plan.items,
          taskState.citedRanges
        );
      }

      if (!editArgs || !editArgs.content) {
        item.status = 'failed';
        item.error = 'Modelo não gerou edit_file válido';
        continue;
      }

      const normalized = coerceImplementPhaseRead(
        normalizeToolArgs(deps.workspaceRoot, editArgs),
        taskState,
        'implement'
      );

      const result = await deps.executeEdit(
        normalized,
        taskState,
        pendingChanges,
        sessionChanges
      );

      if (result.success) {
        item.status = 'done';
        taskState.filesChanged = sessionChanges.map((c) => c.file);
      } else {
        item.status = 'failed';
        item.error = result.output.slice(0, 200);
      }
    } catch (err) {
      item.status = 'failed';
      item.error = err instanceof Error ? err.message : String(err);
    }
  }

  const applied = plan.items.filter((i) => i.status === 'done').length;
  const failed = plan.items.filter((i) => i.status === 'failed').length;

  if (applied === 0) {
    taskState.planPhase = 'failed';
    return {
      handled: true,
      success: false,
      plan,
      changesCount: sessionChanges.length - initialChanges,
      message: `Plano criado, mas nenhuma alteração foi aplicada (${failed} falha(s)).`,
    };
  }

  taskState.planPhase = 'verifying';

  const heuristicPlan = plan.analysis.includes('inferido automaticamente');
  const allItemsDone = plan.items.every((i) => i.status === 'done');

  if (heuristicPlan && allItemsDone) {
    deps.emitMessage('**Verificação:** documentação atualizada conforme plano automático.');
  } else {
    deps.emitThinking('Verificando se o pedido foi atendido...');

    while (canRunVerificationRound(plan)) {
    const verification = await verifyEditPlan(
      deps.provider,
      deps.model,
      goal,
      plan,
      sessionChanges.map((c) => c.file)
    );

    plan.verificationRound += 1;

    if (verification.complete) {
      deps.emitMessage(`**Verificação:** ${verification.summary || 'Pedido atendido.'}`);
      break;
    }

    deps.emitMessage(
      [
        `**Verificação (rodada ${plan.verificationRound}):** ${verification.summary}`,
        verification.missing.length > 0
          ? `**Pendências:** ${verification.missing.join('; ')}`
          : '',
      ].filter(Boolean).join('\n')
    );

    if (verification.additionalItems.length === 0) {
      break;
    }

    appendItemsToPlan(plan, verification.additionalItems);
    deps.emitThinking(
      `Complementando plano com ${verification.additionalItems.length} alteração(ões)...`
    );

    while (true) {
      const extra = getNextPendingItem(plan);
      if (!extra) {
        break;
      }

      deps.emitThinking(`Complemento: ${extra.path}:${extra.start_line} — ${extra.description}`);

      try {
        const ctx = await loadItemContext(deps.workspaceRoot, extra);
        let editArgs = await buildDeterministicEditArgs(deps.workspaceRoot, extra, goal);
        if (!editArgs) {
          editArgs = await generateEditForPlanItem(
            deps.provider,
            deps.model,
            goal,
            extra,
            ctx.numbered,
            plan.items,
            taskState.citedRanges
          );
        }

        if (!editArgs?.content) {
          extra.status = 'failed';
          extra.error = 'Sem edit_file';
          continue;
        }

        const normalized = coerceImplementPhaseRead(
          normalizeToolArgs(deps.workspaceRoot, editArgs),
          taskState,
          'implement'
        );

        const result = await deps.executeEdit(
          normalized,
          taskState,
          pendingChanges,
          sessionChanges
        );

        extra.status = result.success ? 'done' : 'failed';
        if (!result.success) {
          extra.error = result.output.slice(0, 200);
        }
      } catch (err) {
        extra.status = 'failed';
        extra.error = err instanceof Error ? err.message : String(err);
      }
    }
    }
  }

  deps.emitThinking('Validando alterações...');
  const changedFiles = sessionChanges.map((c) => c.file);
  if (isDocumentationOnlyChanges(changedFiles)) {
    compileOk = true;
    compileOutput = 'Somente documentação — compilação ignorada';
  } else {
    const compile = await deps.runCompileCheck();
    compileOk = compile.ok;
    compileOutput = compile.output;
  }

  taskState.planPhase = compileOk ? 'complete' : 'complete_with_warnings';
  taskState.filesChanged = sessionChanges.map((c) => c.file);

  const finalDone = plan.items.filter((i) => i.status === 'done').length;
  const finalFailed = plan.items.filter((i) => i.status === 'failed').length;

  const message = [
    '## Alterações concluídas (plano em etapas)',
    '',
    formatPlanProgress(plan),
    `**Aplicadas:** ${finalDone} | **Falhas:** ${finalFailed}`,
    compileOk ? '**Compilação:** OK' : `**Compilação:** falhou — ${compileOutput.slice(0, 300)}`,
    '',
    'Revise os diffs nos cards de arquivo alterado.',
  ].join('\n');

  deps.emitMessage(message);

  return {
    handled: true,
    success: finalDone > 0 && compileOk,
    plan,
    changesCount: sessionChanges.length - initialChanges,
    message,
  };
}
