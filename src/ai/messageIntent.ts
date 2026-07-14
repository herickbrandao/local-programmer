import { OperationMode } from '../config/settings';

/** O que o usuário quer fazer — definido pela IA (intentClassifier), não por regex */
export type MessageIntent = 'conversational' | 'project_read' | 'project_write';

export interface ResolvedMessageMode {
  intent: MessageIntent;
  toolsMode: OperationMode;
  useTools: boolean;
  showIterations: boolean;
}

/**
 * Combina intenção (IA) com o modo selecionado na UI (Chat / Análise / Agente).
 * A UI impõe limites; a IA decide read vs write vs conversa.
 */
export function resolveMessageMode(
  operationMode: OperationMode,
  intent: MessageIntent,
  allowWriteOverride: boolean
): ResolvedMessageMode {
  if (operationMode === 'analyze') {
    return {
      intent: 'project_read',
      toolsMode: 'analyze',
      useTools: intent !== 'conversational',
      showIterations: intent !== 'conversational',
    };
  }

  if (intent === 'conversational') {
    return {
      intent,
      toolsMode: 'chat',
      useTools: false,
      showIterations: false,
    };
  }

  if (intent === 'project_write') {
    if (operationMode === 'chat' && allowWriteOverride) {
      return {
        intent,
        toolsMode: 'agent',
        useTools: true,
        showIterations: true,
      };
    }
    if (operationMode === 'chat') {
      // Sem confirmação de escrita: ainda assim lê o projeto (não inventar "sem acesso")
      return {
        intent: 'project_read',
        toolsMode: 'analyze',
        useTools: true,
        showIterations: true,
      };
    }
    return {
      intent,
      toolsMode: 'agent',
      useTools: true,
      showIterations: true,
    };
  }

  // project_read
  if (operationMode === 'chat') {
    return {
      intent,
      toolsMode: 'analyze',
      useTools: true,
      showIterations: true,
    };
  }

  if (operationMode === 'agent') {
    return {
      intent,
      toolsMode: 'analyze',
      useTools: true,
      showIterations: true,
    };
  }

  return {
    intent,
    toolsMode: operationMode,
    useTools: true,
    showIterations: true,
  };
}
