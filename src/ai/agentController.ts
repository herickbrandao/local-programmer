import * as vscode from 'vscode';
import { getExtensionSettings, OperationMode } from '../config/settings';
import { OllamaProvider } from './ollamaProvider';
import { ProviderRegistry } from './provider';
import { PromptManager, SystemPromptOptions } from './promptManager';
import { normalizeToolArguments } from './toolCallParser';
import { IterationGuard } from './iterationGuard';
import { checkWriteTaskComplete } from './taskCompletion';
import { MessageIntent, resolveMessageMode } from './messageIntent';
import { classifyIntentWithAI, formatIntentThinking } from './intentClassifier';
import {
  analyzeTaskDecomposition,
  buildMergeMessage,
  buildSubtaskFocusMessage,
  summarizeSessionChanges,
  TaskPlan,
} from './taskDecomposer';
import {
  buildImplementPhaseMessage,
  buildImplementProgressMessage,
  buildEditRecoveryHint,
  buildForceEditAfterReadMessage,
  buildMandatoryEditMessage,
  buildMultiFileEditContinueMessage,
  buildPhaseContextBlock,
  coerceImplementPhaseRead,
  filterToolsForPhase,
  finishToolIteration,
  getToolBlockReason,
  needsMoreFileWork,
  pickPrimaryEditTarget,
  recordReadTool,
  shouldUseEditOnlyTools,
  updateExecutionPhase,
} from './executionPhase';
import {
  buildContinuationMessage,
  buildTaskContextBlock,
  buildTaskIncompleteMessage,
  createTaskState,
  shouldAutoContinue,
  TaskState,
} from './taskTracker';
import { TokenTracker } from './tokenTracker';
import {
  assessResponseQuality,
  buildRefinementPrompt,
  claimsNoProjectAccess,
  isAgentImplementationTask,
  isResponseTruncated,
  synthesizeFinalAnswer,
} from './responseValidator';
import * as fs from 'fs/promises';
import { recordReadRange, isFileFullyRead } from '../tools/fileReadChunks';
import { normalizeToolArgs, resolveWorkspacePath } from '../tools/pathUtils';
import { AIProvider, AgentEvent,
  ChatMessage,
  ChatOptions,
  FileChange,
  PermissionRequest,
  PendingChange,
  ToolCall,
} from './types';
import { ToolRegistry } from '../tools/toolRegistry';
import { ToolContext, ToolResult } from '../tools/types';
import { PermissionManager } from '../permissions/permissionManager';
import { SnapshotManager } from '../history/snapshotManager';
import { DiffManager } from '../editor/diffManager';
import { ContextManager } from '../workspace/contextManager';
import { ProjectMemory } from '../workspace/projectMemory';
import { attemptForcedEdit, buildEditSuccessMessage } from './editorFallback';
import { runPlanDrivenPipeline, PlanRunnerResult } from './planDrivenRunner';
import { mergeLineCitations, parseLineCitations } from './lineCitations';
import { isAbortError } from './ollamaProvider';
import { loadProjectRules } from '../workspace/projectRules';
import {
  CHAT_WITH_TOOLS_TOKENS,
  EDIT_RESPONSE_TOKENS,
  trimChatMessagesForRequest,
} from './contextBudget';
import { formatPrefetchMessage, prefetchProjectContext } from './contextPrefetch';

export class AgentController {
  private promptManager = new PromptManager();
  private toolRegistry = new ToolRegistry();
  private permissionManager = new PermissionManager();
  private snapshotManager = new SnapshotManager();
  private diffManager = new DiffManager();
  private contextManager = new ContextManager();
  private projectMemory = new ProjectMemory();
  private providerRegistry = new ProviderRegistry();
  private messages: ChatMessage[] = [];
  private currentOperationMode: OperationMode = 'chat';
  private isRunning = false;
  private abortController: AbortController | null = null;
  private workspaceRoot = '';
  private lastVersionId: string | null = null;
  private tokenTracker = new TokenTracker();
  private onEvent?: (event: AgentEvent) => void;

  constructor() {
    const settings = getExtensionSettings();
    this.providerRegistry.register(new OllamaProvider(settings.ollamaUrl));
  }

  setEventHandler(handler: (event: AgentEvent) => void): void {
    this.onEvent = handler;
  }

  private emit(event: AgentEvent): void {
    this.onEvent?.(event);
  }

  async initialize(): Promise<void> {
    await this.initializeWorkspace();

    const provider = this.providerRegistry.getActive();
    const available = await provider.isAvailable();
    if (!available) {
      this.emit({
        type: 'error',
        content: 'Ollama não está disponível. Verifique se está rodando em localhost:11434',
      });
    }
  }

  async initializeWorkspace(): Promise<boolean> {
    const settings = getExtensionSettings();
    const ollama = this.providerRegistry.get('ollama') as OllamaProvider | undefined;
    ollama?.updateUrl(settings.ollamaUrl);

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return false;
    }

    this.workspaceRoot = folders[0].uri.fsPath;
    await this.permissionManager.initialize(this.workspaceRoot);
    await this.snapshotManager.initialize(this.workspaceRoot);
    await this.contextManager.initialize(this.workspaceRoot);
    await this.projectMemory.initialize(this.workspaceRoot);
    return true;
  }

  /** Recarrega espelho em RAM (novo chat / início de mensagem) */
  async refreshProjectMemory(forceFull = false): Promise<string> {
    if (!this.workspaceRoot) {
      const ok = await this.initializeWorkspace();
      if (!ok) {
        return 'Sem workspace — memória não carregada.';
      }
    }
    if (forceFull || !this.projectMemory.isReady()) {
      const stats = await this.projectMemory.reloadAll();
      return `Memória atualizada: ${stats.files} arquivos (~${(stats.bytes / (1024 * 1024)).toFixed(2)} MB)`;
    }
    return this.projectMemory.formatStatus();
  }

  getProjectMemory(): ProjectMemory {
    return this.projectMemory;
  }

  dispose(): void {
    this.projectMemory.dispose();
  }

  async getModels(): Promise<string[]> {
    return this.providerRegistry.getActive().listModels();
  }

  async isOllamaAvailable(): Promise<boolean> {
    return this.providerRegistry.getActive().isAvailable();
  }

  async testConnection(overrides?: { ollamaUrl?: string; connectionTimeoutMs?: number }): Promise<{ ok: boolean; message: string; models: string[] }> {
    await this.initializeWorkspace();
    const ollama = this.providerRegistry.get('ollama') as OllamaProvider;
    if (overrides?.ollamaUrl) {
      ollama.updateUrl(overrides.ollamaUrl);
    }
    return ollama.testConnection(overrides?.connectionTimeoutMs);
  }

  stop(): void {
    if (!this.isRunning || !this.abortController) {
      return;
    }
    this.abortController.abort();
    this.emit({ type: 'thinking', content: 'Parando...' });
  }

  isBusy(): boolean {
    return this.isRunning;
  }

  private throwIfAborted(): void {
    if (this.abortController?.signal.aborted) {
      throw Object.assign(new Error('Requisição cancelada'), { name: 'AbortError' });
    }
  }

  private buildChatOptions(overrides: ChatOptions = {}): ChatOptions {
    const settings = getExtensionSettings();
    return {
      model: settings.model,
      temperature: settings.temperature,
      maxResponseTokens: settings.maxResponseTokens,
      signal: this.abortController?.signal,
      ...overrides,
    };
  }

  async sendMessage(
    userPrompt: string,
    operationMode?: OperationMode,
    displayPrompt?: string
  ): Promise<void> {
    if (this.isRunning) {
      this.emit({ type: 'error', content: 'Agente já está processando. Aguarde...' });
      return;
    }

    const mode = operationMode ?? getExtensionSettings().operationMode;
    this.currentOperationMode = mode;

    if (!this.workspaceRoot) {
      await this.initializeWorkspace();
    }

    this.isRunning = true;
    this.abortController = new AbortController();

    try {
      const settings = getExtensionSettings();
      const model = settings.model;
      const provider = this.providerRegistry.getActive();

      this.emit({ type: 'thinking', content: 'Entendendo o pedido...' });
      const classification = await classifyIntentWithAI(
        provider,
        model,
        userPrompt,
        mode,
        this.abortController?.signal
      );
      this.throwIfAborted();

      let allowWriteOverride = false;
      if (mode === 'chat' && classification.intent === 'project_write') {
        allowWriteOverride = await this.confirmWriteAction(userPrompt);
      }
      const resolved = resolveMessageMode(mode, classification.intent, allowWriteOverride);
      const effectiveIntent = resolved.intent;

      const needsWorkspace = resolved.useTools && resolved.toolsMode !== 'chat';
      if (needsWorkspace && !this.workspaceRoot) {
        const initialized = await this.initializeWorkspace();
        if (!initialized) {
          this.emit({
            type: 'error',
            content: mode === 'analyze'
              ? 'Abra uma pasta de projeto para analisar código.'
              : 'Abra uma pasta de projeto antes de editar arquivos.',
          });
          return;
        }
      }

      const maxIterations = resolved.useTools && resolved.toolsMode !== 'chat'
        ? settings.maxAgentIterations
        : 1;

      const useLean =
        effectiveIntent === 'project_write' || resolved.toolsMode === 'agent';
      let projectContext = this.workspaceRoot && resolved.useTools
        ? (useLean
          ? await this.contextManager.getLeanProjectContext(this.workspaceRoot)
          : await this.contextManager.getProjectContext(this.workspaceRoot))
        : undefined;
      if (this.workspaceRoot && resolved.useTools) {
        await this.refreshProjectMemory(false);
        const memStatus = this.projectMemory.formatStatus();
        if (memStatus) {
          projectContext = projectContext
            ? `${projectContext}\n\n## Memória RAM do projeto\n${memStatus}\nAs tools (read_files/read_file) leem daqui primeiro; se o arquivo não estiver na RAM, leem do disco.`
            : `## Memória RAM do projeto\n${memStatus}`;
        }
      }
      if (this.workspaceRoot) {
        const rules = await loadProjectRules(this.workspaceRoot);
        if (rules) {
          const rulesBudget = rules.length > 2000 ? `${rules.slice(0, 2000)}\n…` : rules;
          projectContext = projectContext ? `${projectContext}\n\n${rulesBudget}` : rulesBudget;
        }
      }

      const taskState = createTaskState(displayPrompt ?? userPrompt, effectiveIntent);
      taskState.citedRanges = mergeLineCitations(
        taskState.citedRanges ?? [],
        parseLineCitations(userPrompt)
      );

      let decomposition = await analyzeTaskDecomposition(
        provider,
        model,
        userPrompt,
        effectiveIntent
      );
      if (!resolved.useTools || effectiveIntent === 'conversational') {
        decomposition = { decomposed: false, originalGoal: userPrompt, subtasks: [userPrompt] };
      }

      if (decomposition.decomposed) {
        this.emit({
          type: 'thinking',
          content: `Dividindo a tarefa em ${decomposition.subtasks.length} etapas...`,
        });
      }

      this.refreshSystemPrompt(mode, taskState, projectContext, effectiveIntent, resolved.toolsMode);

      if (mode === 'chat' && classification.intent === 'project_write' && !allowWriteOverride) {
        this.emit({
          type: 'thinking',
          content: 'Modo Chat — analisando o projeto com ferramentas (leitura). Para aplicar alterações, confirme quando solicitado.',
        });
      } else if (resolved.useTools && effectiveIntent !== 'conversational') {
        this.emit({
          type: 'thinking',
          content: formatIntentThinking(classification),
        });
      }

      this.messages.push({ role: 'user', content: userPrompt });

      if (
        this.workspaceRoot
        && resolved.useTools
        && effectiveIntent !== 'conversational'
        && !taskState.citedRanges?.length
      ) {
        this.emit({ type: 'thinking', content: 'Pré-carregando arquivos relevantes em lote...' });
        await this.refreshProjectMemory(false);
        const prefetch = await prefetchProjectContext(
          this.workspaceRoot,
          displayPrompt ?? userPrompt,
          taskState,
          this.projectMemory
        );
        if (prefetch.applied) {
          this.messages.push({
            role: 'user',
            content: formatPrefetchMessage(prefetch),
            internal: true,
          });
          this.emit({
            type: 'thinking',
            content: `Lote pronto: ${prefetch.paths.length} arquivo(s) — ${prefetch.paths.join(', ')}`,
          });
        }
      }

      const pendingChanges: PendingChange[] = [];
      const sessionChanges: FileChange[] = [];
      const iterationGuard = new IterationGuard();
      let stoppedEarly = false;
      let validationAttempts = 0;
      let forceTextOnly = false;
      let accessDenialRetries = 0;
      const partialResponses: string[] = [];
      const maxValidationAttempts = 2;
      const displayQuestion = displayPrompt ?? userPrompt;
      const subtaskCount = decomposition.decomposed ? decomposition.subtasks.length : 1;
      const completedSubtaskNotes: string[] = [];

      for (let subIdx = 0; subIdx < subtaskCount; subIdx++) {
        if (decomposition.decomposed) {
          const plan: TaskPlan = {
            originalGoal: decomposition.originalGoal,
            subtasks: decomposition.subtasks,
            currentIndex: subIdx,
            completedNotes: [...completedSubtaskNotes],
          };
          taskState.taskPlan = plan;
          taskState.continuationCount = 0;

          this.messages.push({
            role: 'user',
            content: buildSubtaskFocusMessage(plan),
            internal: true,
          });

          if (subIdx > 0) {
            this.emit({
              type: 'thinking',
              content: `Etapa ${subIdx + 1}/${subtaskCount}...`,
            });
          }
        }

        validationAttempts = 0;
        forceTextOnly = false;
        partialResponses.length = 0;
        taskState.planPipelineDone = false;

        const subtaskMaxIterations = decomposition.decomposed
          ? Math.max(3, Math.ceil(maxIterations / subtaskCount))
          : maxIterations;

        const subtaskGoal = decomposition.decomposed
          ? decomposition.subtasks[subIdx]
          : userPrompt;

        let skipAgentLoopForSubtask = false;

        if (
          mode === 'agent'
          && resolved.toolsMode === 'agent'
          && effectiveIntent === 'project_write'
        ) {
          const planResult = await this.runPlanDrivenPipeline(
            provider,
            model,
            subtaskGoal,
            taskState,
            projectContext ?? '',
            pendingChanges,
            sessionChanges
          );
          taskState.planPipelineDone = true;
          skipAgentLoopForSubtask = this.handlePlanPipelineResult(
            planResult,
            taskState,
            decomposition.decomposed,
            completedSubtaskNotes
          );
          if (skipAgentLoopForSubtask && !decomposition.decomposed) {
            stoppedEarly = true;
          }
        }

        if (skipAgentLoopForSubtask) {
          continue;
        }

        for (let i = 0; i < subtaskMaxIterations; i++) {
        taskState.iteration = i + 1;
        taskState.filesChanged = sessionChanges.map((c) => c.file);
        this.refreshSystemPrompt(mode, taskState, projectContext, effectiveIntent, resolved.toolsMode);

        if (shouldUseEditOnlyTools(taskState, userPrompt) && !taskState.editorModeAnnounced) {
          taskState.editorModeAnnounced = true;
          this.messages.push({
            role: 'user',
            content: buildMandatoryEditMessage(taskState, userPrompt),
            internal: true,
          });
          this.emit({ type: 'thinking', content: 'Modo editor — implementação obrigatória...' });
        }

        if (resolved.showIterations && resolved.toolsMode !== 'chat') {
          const iterLabel = decomposition.decomposed
            ? `Etapa ${subIdx + 1}/${subtaskCount} · iteração ${i + 1}/${subtaskMaxIterations}...`
            : `Iteração ${i + 1}/${subtaskMaxIterations}...`;
          this.emit({ type: 'thinking', content: iterLabel });
        }

        const toolDefs = forceTextOnly
          ? []
          : resolved.useTools
            ? filterToolsForPhase(
              this.promptManager.getToolDefinitionsForIntent(resolved.toolsMode, effectiveIntent),
              taskState.phase,
              effectiveIntent,
              resolved.toolsMode,
              taskState
            )
            : [];
        forceTextOnly = false;
        const tools = toolDefs;

        this.throwIfAborted();
        const editOnlyMode = shouldUseEditOnlyTools(taskState, userPrompt);
        const streamText = tools.length === 0;
        const requestMessages = trimChatMessagesForRequest(
          this.messages,
          taskState.phase,
          effectiveIntent
        );
        const responseTokens = tools.length > 0
          ? Math.min(settings.maxResponseTokens, CHAT_WITH_TOOLS_TOKENS)
          : settings.maxResponseTokens;
        const response = await provider.chat(
          requestMessages,
          this.buildChatOptions({
            model,
            tools: tools.length > 0 ? tools : undefined,
            requireToolCall: editOnlyMode && tools.length > 0,
            maxResponseTokens: editOnlyMode
              ? Math.min(responseTokens, EDIT_RESPONSE_TOKENS)
              : responseTokens,
            onToken: streamText
              ? (delta) => this.emit({ type: 'stream_delta', content: delta })
              : undefined,
          })
        );

        this.recordTokenUsage(response, model);

        if (response.toolCalls && response.toolCalls.length > 0) {
          if (!resolved.useTools || effectiveIntent === 'conversational') {
            this.messages.push({ role: 'assistant', content: response.content || 'Olá! Como posso ajudar?' });
            this.emit({
              type: 'message',
              content: response.content || 'Olá! Como posso ajudar?',
              data: { role: 'assistant' },
            });
            break;
          }

          this.messages.push({
            role: 'assistant',
            content: response.content || 'Executando ferramentas...',
          });

          let iterationHadSuccess = false;
          let iterationHadWrite = false;
          let iterationHadReadOnly = false;
          let iterationHadBlockedRead = false;
          let lastFullyReadFile: string | undefined;

          const toolCalls = this.coalesceReadToolCalls(response.toolCalls);
          for (const toolCall of toolCalls) {
            if (!this.promptManager.isToolAllowed(resolved.toolsMode, toolCall.name, effectiveIntent)) {
              const blocked = `Ferramenta "${toolCall.name}" requer confirmação ou modo Agente.`;
              this.emit({ type: 'tool_result', content: blocked, data: { success: false } });
              this.messages.push({ role: 'tool', content: blocked, name: toolCall.name, toolCallId: toolCall.id });
              const stop = iterationGuard.recordToolResult(toolCall.name, {}, false, blocked);
              if (stop) {
                this.stopAgentLoop(stop.message);
                stoppedEarly = true;
                break;
              }
              continue;
            }

            const { args, recovered, error: argError } = normalizeToolArguments(
              toolCall.name,
              toolCall.arguments,
              response.content
            );

            if (argError) {
              this.emit({ type: 'tool_result', content: argError, data: { success: false } });
              this.messages.push({ role: 'tool', content: argError, name: toolCall.name, toolCallId: toolCall.id });
              const stop = iterationGuard.recordToolResult(toolCall.name, args, false, argError);
              if (stop) {
                this.stopAgentLoop(stop.message);
                stoppedEarly = true;
                break;
              }
              continue;
            }

            const normalizedArgs = coerceImplementPhaseRead(
              normalizeToolArgs(this.workspaceRoot, args),
              taskState,
              taskState.phase
            );
            const filePath = normalizedArgs.path as string | undefined;

            const blockReason = getToolBlockReason(
              toolCall.name,
              normalizedArgs,
              filePath,
              taskState,
              resolved.toolsMode,
              effectiveIntent
            );
            if (blockReason) {
              if (
                toolCall.name === 'read_file'
                || toolCall.name === 'read_files'
                || toolCall.name === 'search_files'
              ) {
                iterationHadBlockedRead = true;
              }
              this.emit({ type: 'tool_result', content: blockReason, data: { success: false } });
              this.messages.push({
                role: 'tool',
                content: blockReason,
                name: toolCall.name,
                toolCallId: toolCall.id,
              });
              const target = filePath ?? pickPrimaryEditTarget(taskState, userPrompt);
              if (
                target
                && toolCall.name === 'read_file'
                && isFileFullyRead(taskState.fileReadCoverage, target)
              ) {
                this.messages.push({
                  role: 'user',
                  content: buildForceEditAfterReadMessage(taskState, target),
                  internal: true,
                });
              } else {
                const hint = buildEditRecoveryHint(normalizedArgs, blockReason);
                if (hint) {
                  this.messages.push({ role: 'user', content: hint, internal: true });
                }
              }
              const stop = iterationGuard.recordToolResult(toolCall.name, normalizedArgs, false, blockReason);
              if (stop && toolCall.name !== 'read_file') {
                this.stopAgentLoop(stop.message);
                stoppedEarly = true;
                break;
              }
              continue;
            }

            const redundant = iterationGuard.checkRedundantAction(toolCall.name, normalizedArgs);
            if (redundant) {
              if (toolCall.name === 'search_files') {
                this.emit({ type: 'tool_result', content: redundant.message, data: { success: false } });
                this.messages.push({
                  role: 'tool',
                  content: redundant.message,
                  name: toolCall.name,
                  toolCallId: toolCall.id,
                });
                continue;
              }
              this.stopAgentLoop(redundant.message);
              stoppedEarly = true;
              break;
            }

            if (recovered) {
              this.emit({
                type: 'tool_call',
                content: `${toolCall.name} (conteúdo recuperado do bloco de código)`,
                data: toolCall,
              });
            } else {
              this.emit({
                type: 'tool_call',
                content: `${toolCall.name}(${JSON.stringify(normalizedArgs)})`,
                data: toolCall,
              });
            }

            const result = await this.executeToolWithPermission(
              toolCall.name,
              normalizedArgs,
              pendingChanges,
              sessionChanges,
              taskState
            );

            if (result.success) {
              iterationHadSuccess = true;
              const isWrite = ['edit_file', 'modify_file', 'create_file', 'delete_file'].includes(toolCall.name);
              const isRead = ['read_file', 'read_files', 'list_files', 'search_files'].includes(toolCall.name);
              if (isWrite) {
                iterationHadWrite = true;
              } else if (isRead) {
                iterationHadReadOnly = true;
                const batchPaths = (result.data as { paths?: string[] } | undefined)?.paths;
                recordReadTool(taskState, toolCall.name, filePath, batchPaths);
              }

              const data = result.data as { path?: string; newContent?: string; content?: string } | undefined;
              if (data?.path && (toolCall.name === 'create_file' || toolCall.name === 'modify_file' || toolCall.name === 'edit_file')) {
                const written = (data.newContent ?? data.content ?? '') as string;
                iterationGuard.recordSuccessfulWrite(data.path, written);
                taskState.continuationCount = 0;
                taskState.forceImplement = false;
              }
            }

            if (
              result.success
              && (toolCall.name === 'read_file' || toolCall.name === 'read_files')
            ) {
              updateExecutionPhase(taskState, resolved.toolsMode);
              if (filePath && isFileFullyRead(taskState.fileReadCoverage, filePath)) {
                lastFullyReadFile = filePath;
              }
            }

            this.emit({
              type: 'tool_result',
              content: result.output.length > 2500
                ? `${result.output.substring(0, 2500)}\n… (${result.output.length} caracteres — modelo recebeu o trecho completo)`
                : result.output,
              data: { success: result.success },
            });

            this.messages.push({
              role: 'tool',
              content: result.output,
              name: toolCall.name,
              toolCallId: toolCall.id,
            });

            if (!result.success && toolCall.name === 'edit_file') {
              const hint = buildEditRecoveryHint(normalizedArgs, result.output);
              if (hint) {
                this.messages.push({ role: 'user', content: hint, internal: true });
              }
            }

            const stop = iterationGuard.recordToolResult(
              toolCall.name,
              normalizedArgs,
              result.success,
              result.output
            );
            if (stop) {
              this.stopAgentLoop(stop.message);
              stoppedEarly = true;
              break;
            }
          }

          if (stoppedEarly) {
            break;
          }

          updateExecutionPhase(taskState, resolved.toolsMode);
          finishToolIteration(taskState, iterationHadWrite, iterationHadReadOnly);

          if (
            sessionChanges.length === 0
            && taskState.phase === 'implement'
            && iterationHadSuccess
            && !iterationHadWrite
          ) {
            const fileJustFullyRead = lastFullyReadFile;

            this.messages.push({
              role: 'user',
              content: fileJustFullyRead
                ? buildForceEditAfterReadMessage(taskState, fileJustFullyRead)
                : buildImplementProgressMessage(taskState, userPrompt),
              internal: true,
            });
            this.emit({
              type: 'thinking',
              content: fileJustFullyRead
                ? `\`${fileJustFullyRead}\` lido — edite ou leia outro arquivo`
                : 'Aguardando alteração ou próxima leitura...',
            });
          }

          if (
            iterationHadWrite
            && needsMoreFileWork(taskState, userPrompt, sessionChanges)
          ) {
            this.messages.push({
              role: 'user',
              content: buildMultiFileEditContinueMessage(taskState, userPrompt),
              internal: true,
            });
            this.emit({
              type: 'thinking',
              content: 'Continuando edição nos próximos arquivos...',
            });
          }

          const taskDone = checkWriteTaskComplete(userPrompt, sessionChanges);
          if (taskDone && iterationHadSuccess && !needsMoreFileWork(taskState, userPrompt, sessionChanges)) {
            this.stopAgentLoop(taskDone);
            stoppedEarly = true;
            break;
          }

          const iterationStop = iterationGuard.finishIteration(iterationHadSuccess, iterationHadBlockedRead);
          if (iterationStop) {
            if (
              isAgentImplementationTask(effectiveIntent, resolved.toolsMode)
              && sessionChanges.length === 0
            ) {
              const forcedOk = await this.attemptForcedEditAndExecute(
                provider,
                model,
                taskState,
                userPrompt,
                pendingChanges,
                sessionChanges
              );
              if (forcedOk) {
                stoppedEarly = true;
                break;
              }
            }
            this.stopAgentLoop(iterationStop.message);
            stoppedEarly = true;
            break;
          }
        } else {
          if (
            shouldAutoContinue(taskState, resolved.toolsMode, sessionChanges, false, userPrompt)
          ) {
            if (response.content.trim()) {
              this.messages.push({ role: 'assistant', content: response.content });
            }
            taskState.continuationCount += 1;
            updateExecutionPhase(taskState, resolved.toolsMode);
            this.messages.push({
              role: 'user',
              content: buildContinuationMessage(taskState, userPrompt),
              internal: true,
            });
            this.emit({
              type: 'thinking',
              content: `Continuando implementação (${taskState.continuationCount}/25)...`,
            });
            continue;
          }

          const agentWriteTask = isAgentImplementationTask(effectiveIntent, resolved.toolsMode);

          if (agentWriteTask && (sessionChanges.length === 0 || needsMoreFileWork(taskState, userPrompt, sessionChanges))) {
            if (taskState.continuationCount >= 25) {
              const forcedOk = await this.attemptForcedEditAndExecute(
                provider,
                model,
                taskState,
                userPrompt,
                pendingChanges,
                sessionChanges
              );
              if (!forcedOk) {
                this.stopAgentLoop(buildTaskIncompleteMessage(taskState, userPrompt));
              }
              stoppedEarly = true;
              break;
            }
            if (response.content.trim()) {
              this.messages.push({ role: 'assistant', content: response.content });
            }
            taskState.continuationCount += 1;
            taskState.forceImplement = true;
            this.messages.push({
              role: 'user',
              content: sessionChanges.length > 0
                ? buildMultiFileEditContinueMessage(taskState, userPrompt)
                : buildImplementProgressMessage(taskState, userPrompt),
              internal: true,
            });
            this.emit({
              type: 'thinking',
              content: sessionChanges.length > 0
                ? 'Ainda há arquivos para editar...'
                : response.content.trim()
                  ? 'Resposta sem alteração no código — exigindo edit_file...'
                  : `Aguardando edit_file (${taskState.continuationCount}/25)...`,
            });
            continue;
          }

          const generationComplete = response.done !== false
            && response.doneReason !== 'length';

          if (
            resolved.toolsMode !== 'agent'
            && effectiveIntent !== 'conversational'
            && !decomposition.decomposed
            && validationAttempts < maxValidationAttempts
          ) {
            this.emit({
              type: 'thinking',
              content: 'Verificando se a resposta atende ao pedido...',
            });

            const assessment = await assessResponseQuality(
              provider,
              model,
              displayQuestion,
              response.content,
              generationComplete
            );

            if (!assessment.satisfactory) {
              partialResponses.push(response.content);
              validationAttempts += 1;

              if (agentWriteTask) {
                if (response.content.trim()) {
                  this.messages.push({ role: 'assistant', content: response.content });
                }
                this.messages.push({
                  role: 'user',
                  content: validationAttempts >= maxValidationAttempts
                    ? buildContinuationMessage(taskState, userPrompt)
                    : buildRefinementPrompt(assessment.reason, displayQuestion, true),
                  internal: true,
                });
                this.emit({
                  type: 'thinking',
                  content: validationAttempts >= maxValidationAttempts
                    ? 'Continuando implementação no projeto...'
                    : `Ajustando implementação (${validationAttempts}/${maxValidationAttempts})...`,
                });
                continue;
              }

              if (validationAttempts >= maxValidationAttempts) {
                this.emit({
                  type: 'thinking',
                  content: 'Gerando resposta final consolidada...',
                });
                const synthesized = await synthesizeFinalAnswer(
                  provider,
                  model,
                  displayQuestion,
                  partialResponses,
                  settings.maxResponseTokens
                );
                this.messages.push({ role: 'assistant', content: synthesized });
                if (decomposition.decomposed) {
                  completedSubtaskNotes.push(synthesized.slice(0, 600));
                  break;
                }
                this.emit({
                  type: 'message',
                  content: synthesized,
                  data: { role: 'assistant' },
                });
                stoppedEarly = true;
                break;
              }

              this.messages.push({
                role: 'user',
                content: buildRefinementPrompt(assessment.reason, displayQuestion, false),
                internal: true,
              });
              forceTextOnly = true;
              this.emit({
                type: 'thinking',
                content: `Reescrevendo resposta (${validationAttempts}/${maxValidationAttempts})...`,
              });
              continue;
            }
          }

          if (
            !agentWriteTask
            && partialResponses.length > 0
            && isResponseTruncated(response.content)
          ) {
            this.emit({ type: 'thinking', content: 'Gerando resposta final consolidada...' });
            const synthesized = await synthesizeFinalAnswer(
              provider,
              model,
              displayQuestion,
              [...partialResponses, response.content],
              settings.maxResponseTokens
            );
            this.messages.push({ role: 'assistant', content: synthesized });
            if (decomposition.decomposed) {
              completedSubtaskNotes.push(synthesized.slice(0, 600));
              break;
            }
            this.emit({
              type: 'message',
              content: synthesized,
              data: { role: 'assistant' },
            });
            stoppedEarly = true;
            break;
          }

          if (
            resolved.useTools
            && effectiveIntent !== 'conversational'
            && this.workspaceRoot
            && claimsNoProjectAccess(response.content)
            && accessDenialRetries < 1
          ) {
            // Workspace + RAM prontos: a negação foi prematura — injeta leitura real e pede nova resposta
            accessDenialRetries += 1;
            if (response.content.trim()) {
              this.messages.push({ role: 'assistant', content: response.content });
            }
            await this.refreshProjectMemory(false);
            const prefetch = await prefetchProjectContext(
              this.workspaceRoot,
              displayQuestion,
              taskState,
              this.projectMemory
            );
            if (prefetch.applied) {
              this.messages.push({
                role: 'user',
                content: formatPrefetchMessage(prefetch),
                internal: true,
              });
            }
            this.messages.push({
              role: 'user',
              content: [
                '[Leitura do host]',
                `Memória: ${this.projectMemory.formatStatus()}.`,
                prefetch.applied
                  ? 'Trechos acima já foram lidos da RAM/disco. Continue a análise com base neles (caminhos + linhas).'
                  : 'Chame read_files com paths concretos do projeto e analise o retorno.',
                'Só diga falta de acesso se alguma leitura específica falhar.',
              ].join('\n'),
              internal: true,
            });
            forceTextOnly = false;
            this.emit({
              type: 'thinking',
              content: 'Lendo arquivos da memória RAM para continuar a análise...',
            });
            continue;
          }

          if (decomposition.decomposed) {
            const summary = response.content.trim() || '(etapa concluída)';
            completedSubtaskNotes.push(summary.slice(0, 600));
            if (response.content.trim()) {
              this.messages.push({ role: 'assistant', content: response.content });
            }
            break;
          }

          this.messages.push({ role: 'assistant', content: response.content });
          const finalContent = response.content.trim()
            || 'Tarefa encerrada. Revise o projeto ou reformule o pedido.';
          this.emit({
            type: 'message',
            content: finalContent,
            data: { role: 'assistant' },
          });
          stoppedEarly = true;
          break;
        }
        }

        if (stoppedEarly) {
          break;
        }

        if (
          isAgentImplementationTask(effectiveIntent, resolved.toolsMode)
          && sessionChanges.length === 0
        ) {
          const forcedOk = await this.attemptForcedEditAndExecute(
            provider,
            model,
            taskState,
            userPrompt,
            pendingChanges,
            sessionChanges
          );
          if (!forcedOk) {
            this.stopAgentLoop(buildTaskIncompleteMessage(taskState, userPrompt));
          }
          stoppedEarly = true;
          break;
        }

        if (decomposition.decomposed && completedSubtaskNotes.length <= subIdx) {
          completedSubtaskNotes.push('(etapa encerrada pelo limite de iterações)');
        }
      }

      if (decomposition.decomposed && !stoppedEarly && completedSubtaskNotes.length > 0) {
        const finalPlan: TaskPlan = {
          originalGoal: decomposition.originalGoal,
          subtasks: decomposition.subtasks,
          currentIndex: subtaskCount - 1,
          completedNotes: completedSubtaskNotes,
        };
        taskState.taskPlan = finalPlan;
        this.refreshSystemPrompt(mode, taskState, projectContext, effectiveIntent, resolved.toolsMode);

        this.messages.push({
          role: 'user',
          content: buildMergeMessage(
            finalPlan,
            summarizeSessionChanges(sessionChanges.map((c) => c.file))
          ),
          internal: true,
        });

        this.emit({ type: 'thinking', content: 'Integrando etapas...' });

        const mergeResponse = await provider.chat(this.messages, {
          model,
          maxResponseTokens: settings.maxResponseTokens,
        });
        this.recordTokenUsage(mergeResponse, model);

        const mergeText = mergeResponse.content.trim()
          || 'Tarefa concluída em etapas. Revise os arquivos alterados no projeto.';
        this.messages.push({ role: 'assistant', content: mergeText });
        this.emit({
          type: 'message',
          content: mergeText,
          data: { role: 'assistant' },
        });
      }

      if (
        resolved.toolsMode === 'agent'
        && effectiveIntent === 'project_write'
        && mode === 'agent'
        && sessionChanges.length === 0
        && !stoppedEarly
      ) {
        const forcedOk = await this.attemptForcedEditAndExecute(
          provider,
          model,
          taskState,
          userPrompt,
          pendingChanges,
          sessionChanges
        );
        if (!forcedOk) {
          this.stopAgentLoop(buildTaskIncompleteMessage(taskState, userPrompt));
        }
      }

      if (resolved.toolsMode === 'agent' && sessionChanges.length > 0) {
        const mode = this.permissionManager.getMode();

        if (mode !== 'auto' && pendingChanges.length > 0) {
          const approvals = await this.diffManager.showBatchDiff(pendingChanges);

          for (const change of sessionChanges) {
            const approved = approvals.get(change.file) ?? false;
            if (!approved) {
              await this.revertChange(change);
            }
          }

          const approvedChanges = sessionChanges.filter(
            (c) => approvals.get(c.file) !== false
          );

          if (approvedChanges.length > 0) {
            this.emit({
              type: 'thinking',
              content: `Criando checkpoint com ${approvedChanges.length} alterações...`,
            });

            const manifest = await this.snapshotManager.createSnapshot(
              this.workspaceRoot,
              model,
              userPrompt,
              approvedChanges
            );
            this.lastVersionId = manifest.id;
            this.emitVersionedChanges(approvedChanges, manifest.id);
            this.emitCheckpointCard(manifest, approvedChanges, userPrompt);
          }
        } else {
          this.emit({
            type: 'thinking',
            content: `Criando checkpoint: .ai-history/${this.snapshotManager.getLatestVersionId() ?? 'nova versão'}`,
          });

          const manifest = await this.snapshotManager.createSnapshot(
            this.workspaceRoot,
            model,
            userPrompt,
            sessionChanges
          );
          this.lastVersionId = manifest.id;
          this.emitVersionedChanges(sessionChanges, manifest.id);
          this.emitCheckpointCard(manifest, sessionChanges, userPrompt);
        }
      }

      this.emit({ type: 'done', content: 'Concluído' });
    } catch (err) {
      if (isAbortError(err) || this.abortController?.signal.aborted) {
        this.emit({ type: 'cancelled', content: 'Execução interrompida pelo usuário.' });
        this.emit({ type: 'done', content: 'Cancelado' });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        this.emit({ type: 'error', content: message });
      }
    } finally {
      this.isRunning = false;
      this.abortController = null;
    }
  }

  getTokenStats() {
    return this.tokenTracker.getStats();
  }

  resetTokenStats(): void {
    this.tokenTracker.reset();
  }

  private recordTokenUsage(
    response: { tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number } },
    model: string
  ): void {
    let usage = response.tokenUsage;
    if (!usage || usage.totalTokens === 0) {
      usage = this.tokenTracker.estimateFromText(this.messages);
    }
    const stats = this.tokenTracker.record(usage);
    this.emit({
      type: 'token_usage',
      content: `${usage.totalTokens} tokens`,
      data: { ...stats, model },
    });
  }

  private async confirmWriteAction(userPrompt: string): Promise<boolean> {
    const preview = userPrompt.length > 80 ? `${userPrompt.substring(0, 80)}…` : userPrompt;
    const choice = await vscode.window.showInformationMessage(
      `Você pediu alteração em arquivos no modo Chat:\n"${preview}"\n\nDeseja permitir que a IA execute?`,
      { modal: true },
      'Permitir alteração',
      'Só conversar'
    );
    return choice === 'Permitir alteração';
  }

  /** Pipeline: análise → plano N edições → verificação → compile */
  private async runPlanDrivenPipeline(
    provider: AIProvider,
    model: string,
    goal: string,
    taskState: TaskState,
    projectContext: string,
    pendingChanges: PendingChange[],
    sessionChanges: FileChange[]
  ): Promise<PlanRunnerResult> {
    return runPlanDrivenPipeline(goal, taskState, projectContext, pendingChanges, sessionChanges, {
      provider,
      model,
      workspaceRoot: this.workspaceRoot,
      contextManager: this.contextManager,
      signal: this.abortController?.signal,
      emitThinking: (content) => this.emit({ type: 'thinking', content }),
      emitMessage: (content) => {
        this.messages.push({ role: 'assistant', content });
        this.emit({ type: 'message', content, data: { role: 'assistant' } });
      },
      executeEdit: (args, state, pending, changes) =>
        this.executeToolWithPermission('edit_file', args, pending, changes, state),
      runCompileCheck: async () => {
        this.throwIfAborted();
        const tool = this.toolRegistry.get('test_project');
        if (!tool) {
          return { ok: true, output: '' };
        }
        const result = await tool.execute({}, { workspaceRoot: this.workspaceRoot });
        return { ok: result.success, output: result.output };
      },
    });
  }

  /** Retorna true se o loop agente padrão pode ser pulado para este subtask */
  private handlePlanPipelineResult(
    result: PlanRunnerResult,
    taskState: TaskState,
    decomposed: boolean,
    completedSubtaskNotes: string[]
  ): boolean {
    if (!result.handled) {
      return false;
    }

    if (result.changesCount > 0) {
      taskState.filesChanged = [...new Set([
        ...taskState.filesChanged,
        ...(result.plan?.items.filter((i) => i.status === 'done').map((i) => i.path) ?? []),
      ])];
    }

    if (result.changesCount === 0) {
      return false;
    }

    if (decomposed) {
      completedSubtaskNotes.push(result.message.slice(0, 600));
      return true;
    }

    return result.success;
  }

  private stopAgentLoop(message: string): void {
    this.messages.push({ role: 'assistant', content: message });
    this.emit({
      type: 'message',
      content: message,
      data: { role: 'assistant' },
    });
  }

  /** Último recurso: gera e executa edit_file quando o modelo só responde texto */
  private async attemptForcedEditAndExecute(
    provider: AIProvider,
    model: string,
    taskState: TaskState,
    userPrompt: string,
    pendingChanges: PendingChange[],
    sessionChanges: FileChange[]
  ): Promise<boolean> {
    if (
      this.currentOperationMode === 'analyze'
      || taskState.intent !== 'project_write'
    ) {
      return false;
    }

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.emit({
        type: 'thinking',
        content: `Aplicando edição automaticamente (${attempt}/${maxAttempts})...`,
      });

      this.throwIfAborted();
      const forced = await attemptForcedEdit(
        provider,
        model,
        this.workspaceRoot,
        taskState,
        userPrompt,
        attempt,
        this.abortController?.signal
      );

      if (!forced.success || !forced.args) {
        continue;
      }

      const normalizedArgs = coerceImplementPhaseRead(
        normalizeToolArgs(this.workspaceRoot, forced.args),
        taskState,
        'implement'
      );

      this.emit({
        type: 'tool_call',
        content: `edit_file(forced: ${JSON.stringify(normalizedArgs)})`,
        data: { name: 'edit_file', arguments: normalizedArgs },
      });

      const result = await this.executeToolWithPermission(
        'edit_file',
        normalizedArgs,
        pendingChanges,
        sessionChanges,
        taskState
      );

      this.emit({
        type: 'tool_result',
        content: result.output.length > 2500
          ? `${result.output.substring(0, 2500)}\n…`
          : result.output,
        data: { success: result.success },
      });

      if (result.success) {
        const unchanged = (result.data as { unchanged?: boolean } | undefined)?.unchanged;
        if (unchanged) {
          this.messages.push({
            role: 'user',
            content: '[Edição forçada não alterou o arquivo — conteúdo idêntico. Tente abordagem diferente.]',
            internal: true,
          });
          continue;
        }
        taskState.filesChanged = sessionChanges.map((c) => c.file);
        const msg = buildEditSuccessMessage(
          sessionChanges.map((c) => c.file),
          taskState.goal || userPrompt
        );
        this.stopAgentLoop(msg);
        return true;
      }

      this.messages.push({
        role: 'user',
        content: `[Edição forçada falhou — tente linhas diferentes]\n${result.output}`,
        internal: true,
      });
    }

    return false;
  }

  /** Junta vários read_file numa única read_files — 1 ida ao modelo em vez de N */
  private coalesceReadToolCalls(toolCalls: ToolCall[]): ToolCall[] {
    const reads = toolCalls.filter((t) => t.name === 'read_file' || t.name === 'read_files');
    const rest = toolCalls.filter((t) => t.name !== 'read_file' && t.name !== 'read_files');
    if (reads.length <= 1) {
      return toolCalls;
    }

    const paths: string[] = [];
    for (const call of reads) {
      const args = call.arguments ?? {};
      if (Array.isArray(args.paths)) {
        paths.push(...args.paths.map(String));
      } else if (typeof args.path === 'string' && args.path) {
        paths.push(args.path);
      }
      if (Array.isArray(args.files)) {
        for (const f of args.files) {
          if (f && typeof f === 'object' && 'path' in f) {
            paths.push(String((f as { path: string }).path));
          }
        }
      }
    }

    const unique = [...new Set(paths.map((p) => p.replace(/\\/g, '/')).filter(Boolean))];
    if (unique.length === 0) {
      return toolCalls;
    }

    this.emit({
      type: 'thinking',
      content: `Lendo ${unique.length} arquivos em lote (paralelo no disco)...`,
    });

    return [
      {
        id: `batch_read_${Date.now()}`,
        name: 'read_files',
        arguments: { paths: unique, max_lines_per_file: 80 },
      },
      ...rest,
    ];
  }

  private refreshSystemPrompt(
    mode: OperationMode,
    taskState: TaskState,
    projectContext: string | undefined,
    effectiveIntent: MessageIntent,
    toolsMode: OperationMode
  ): void {
    updateExecutionPhase(taskState, toolsMode);
    const phaseContext = buildPhaseContextBlock(taskState, toolsMode);
    this.ensureSystemPrompt(
      mode,
      projectContext,
      buildTaskContextBlock(taskState, phaseContext),
      { intent: effectiveIntent, phase: taskState.phase, toolsMode }
    );
  }

  private ensureSystemPrompt(
    mode: OperationMode,
    projectContext?: string,
    taskContext?: string,
    options?: SystemPromptOptions
  ): void {
    const content = this.promptManager.buildSystemPrompt(mode, projectContext, taskContext, options);
    const existing = this.messages.find((m) => m.role === 'system');
    if (existing) {
      existing.content = content;
    } else {
      this.messages.unshift({ role: 'system', content });
    }
  }

  private async executeToolWithPermission(
    toolName: string,
    args: Record<string, unknown>,
    pendingChanges: PendingChange[],
    sessionChanges: FileChange[],
    taskState?: TaskState
  ): Promise<ToolResult> {
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      return { success: false, output: `Ferramenta desconhecida: ${toolName}` };
    }

    const filePath = (args.path as string) ?? undefined;
    const permissionRequest = this.buildPermissionRequest(toolName, args);

    const approved = await this.permissionManager.requestPermission(permissionRequest);
    if (!approved) {
      return { success: false, output: `Permissão negada para ${toolName}` };
    }

    const context: ToolContext = {
      workspaceRoot: this.workspaceRoot,
      fileReadCoverage: taskState?.fileReadCoverage,
      projectMemory: this.projectMemory,
    };
    const result = await tool.execute(args, context);

    // Mantém RAM sincronizada após escrita do agente
    if (result.success && result.data) {
      const written = result.data as {
        path?: string;
        newContent?: string;
        content?: string;
        action?: string;
      };
      if (written.path && (toolName === 'edit_file' || toolName === 'modify_file' || toolName === 'create_file')) {
        const text = written.newContent ?? written.content;
        if (typeof text === 'string') {
          this.projectMemory.setContent(written.path, text);
        } else {
          void this.projectMemory.refreshFile(written.path);
        }
      }
      if (toolName === 'delete_file' && written.path) {
        this.projectMemory.delete(written.path);
      }
    }

    if (
      (toolName === 'read_file' || toolName === 'read_files')
      && result.success
      && taskState
      && result.data
    ) {
      const readData = result.data as {
        path?: string;
        startLine?: number;
        endLine?: number;
        totalLines?: number;
        duplicate?: boolean;
        batch?: boolean;
        files?: Array<{
          path?: string;
          startLine?: number;
          endLine?: number;
          totalLines?: number;
        }>;
      };

      const ranges = readData.batch && readData.files?.length
        ? readData.files
        : [readData];

      for (const entry of ranges) {
        if (
          entry.path
          && entry.startLine
          && entry.endLine
          && entry.totalLines
          && !readData.duplicate
        ) {
          recordReadRange(
            taskState.fileReadCoverage,
            entry.path,
            entry.startLine,
            entry.endLine,
            entry.totalLines
          );
        }
      }
    }

    if (result.success && result.data) {
      const data = result.data as {
        path?: string;
        oldContent?: string;
        newContent?: string;
        content?: string;
        action?: string;
      };

      if (data.action && data.path) {
        let newContent = data.newContent ?? data.content ?? '';
        const oldContent = data.oldContent ?? '';

        if (data.action === 'modify' || data.action === 'create') {
          try {
            const fullPath = resolveWorkspacePath(this.workspaceRoot, data.path);
            newContent = await fs.readFile(fullPath, 'utf-8');
          } catch {
            // usa conteúdo retornado pela ferramenta
          }
        }

        const change: FileChange = {
          file: data.path,
          oldContent,
          newContent,
        };

        sessionChanges.push(change);

        if (data.action === 'modify' || data.action === 'create') {
          pendingChanges.push({
            file: data.path,
            oldContent: change.oldContent,
            newContent: change.newContent,
          });

          this.emit({
            type: 'file_changed',
            content: data.path,
            data: {
              file: data.path,
              oldContent: change.oldContent,
              newContent: change.newContent,
              versionId: this.lastVersionId,
            },
          });
        }
      }
    }

    return result;
  }

  private buildPermissionRequest(
    toolName: string,
    args: Record<string, unknown>
  ): PermissionRequest {
    const filePath = args.path as string | undefined;
    const command = args.command as string | undefined;

    const actionMap: Record<string, string> = {
      read_file: 'Ler arquivo',
      read_files: 'Ler arquivos (lote)',
      edit_file: 'Editar arquivo (cirúrgico)',
      modify_file: 'Modificar arquivo',
      create_file: 'Criar arquivo',
      delete_file: 'Excluir arquivo',
      run_command: 'Executar comando',
      list_files: 'Listar arquivos',
      search_files: 'Buscar nos arquivos',
    };

    let details = '';
    if (command) {
      details = `Comando: ${command}`;
    } else if (args.content) {
      const content = args.content as string;
      details = `Conteúdo: ${content.substring(0, 200)}...`;
    }

    return {
      action: actionMap[toolName] ?? toolName,
      description: `${actionMap[toolName] ?? toolName}${filePath ? `: ${filePath}` : ''}`,
      file: filePath,
      details,
      toolName,
    };
  }

  private async revertChange(change: FileChange): Promise<void> {
    const { CodeModifier } = await import('../editor/codeModifier');
    const modifier = new CodeModifier();
    await modifier.revertChange(this.workspaceRoot, change.file, change.oldContent);
  }

  clearHistory(): void {
    this.messages = [];
    this.lastVersionId = null;
    this.currentOperationMode = getExtensionSettings().operationMode;
    this.permissionManager.clearSession();
  }

  loadConversation(messages: ChatMessage[]): void {
    this.messages = [...messages];
    this.lastVersionId = null;
    this.permissionManager.clearSession();
  }

  getConversation(): ChatMessage[] {
    return [...this.messages];
  }

  private emitVersionedChanges(changes: FileChange[], versionId: string): void {
    for (const change of changes) {
      this.emit({
        type: 'file_changed',
        content: change.file,
        data: {
          file: change.file,
          oldContent: change.oldContent,
          newContent: change.newContent,
          versionId,
          persisted: true,
        },
      });
    }
  }

  private emitCheckpointCard(
    manifest: { id: string; date: string },
    changes: FileChange[],
    userPrompt: string
  ): void {
    const files = [...new Set(changes.map((c) => c.file))];
    this.emit({
      type: 'checkpoint',
      content: `Checkpoint ${manifest.id}`,
      data: {
        versionId: manifest.id,
        date: manifest.date,
        files,
        prompt: userPrompt.slice(0, 160),
      },
    });
  }

  getSnapshotManager(): SnapshotManager {
    return this.snapshotManager;
  }

  getContextManager(): ContextManager {
    return this.contextManager;
  }
}
