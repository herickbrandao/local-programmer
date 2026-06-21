import { OperationMode } from '../config/settings';

export type MessageIntent = 'conversational' | 'project_read' | 'project_write';

export interface ResolvedMessageMode {
  intent: MessageIntent;
  toolsMode: OperationMode;
  useTools: boolean;
  showIterations: boolean;
}

const GREETING_PATTERN =
  /^(oi|olá|ola|hey|hi|hello|bom dia|boa tarde|boa noite|e aí|eai|tudo bem|td bem|obrigad\w*|valeu|vlw|brigad\w*|até|ate logo|tchau|falou)[!.?\s]*$/iu;

const CONVERSATIONAL_PATTERN =
  /^(como vai|como você está|como voce esta|quem é você|quem e voce|o que você faz|o que voce faz|me ajuda|help)[!.?\s]*$/iu;

const LOCATION_QUESTION_PATTERN =
  /\b(onde (eu )?(altero|mudo|troco|configuro|encontro|fica|est[aá]|defino)|qual (arquivo|past[ae])|em qual (arquivo|past[ae])|caminho (do|da|de))\b/iu;

const WRITE_PATTERN =
  /\b(crie|criar|adicion[ea]|modific[ea]|edit[ea]|exclu[ia]|delet[ea]|remov[ea]|apagu[ea]|salv[ea]|escrev[ea]|inser[ia]|substitu[ia]|atualiz[ea]|corrij[ea]|implement[ea]|refator[ea]|gere|gerar|renome[ia]|mov[ea]|copi[ea]|create|modify|delete|remove|update|write|append|add)\b/iu;

const IMPLEMENT_PATTERN =
  /\b(deix[ea]|deixar|melhor[ea]|melhorar|bonit[oa]|estiliz|embelez|tornar|quero que (você|voce)|preciso que (você|voce)|faça|fazer|aplic[ea]|constru[ia]|desenvolv[ea]|ajust\w*|arrum\w*|consert\w*|pode ajustar|pode corrigir|pode arrumar)\b/iu;

const READ_ONLY_PATTERN =
  /\b(analis[ea]|apenas analis|somente analis|só analis|so analis|leia|ler|explique|descrev[ea]|list[ea]|inspecion[ea]|revise|mostr[ea]|sem alterar|without edit|read only|não altere|nao altere|não modifique|nao modifique)\b/iu;

const READ_PATTERN =
  /\b(analis[ea]|leia|ler|list[ea]|busqu[ea]|encontr[ea]|procure|explique|mostr[ea]|revise|inspecion[ea]|examin[ea]|descrev[ea]|onde está|onde esta|qual é|qual e|read|list|search|find|explain|analyze|review|show)\b/iu;

const PROJECT_REFERENCE_PATTERN =
  /\b(arquivo|past[ae]|projeto|código|codigo|repositório|repositorio|workspace|\.ts|\.js|\.py|\.txt|\.json|\.md|src\/|function|class|import|componente|módulo|modulo)\b/iu;

const CONCEPTUAL_PATTERN =
  /\b(o que é|o que e|what is|como funciona|me explique|diferença entre|diferenca entre|por que|porque|best practice|boas práticas|boas praticas)\b/iu;

export function classifyMessageIntent(prompt: string): MessageIntent {
  const text = prompt.trim();
  if (!text) {
    return 'conversational';
  }

  if (GREETING_PATTERN.test(text) || CONVERSATIONAL_PATTERN.test(text)) {
    return 'conversational';
  }

  if (LOCATION_QUESTION_PATTERN.test(text)) {
    return 'conversational';
  }

  if (WRITE_PATTERN.test(text) || IMPLEMENT_PATTERN.test(text) || looksLikeFixOrImproveRequest(text)) {
    return 'project_write';
  }

  if (READ_PATTERN.test(text)) {
    return 'project_read';
  }

  if (CONCEPTUAL_PATTERN.test(text) && !PROJECT_REFERENCE_PATTERN.test(text)) {
    return 'conversational';
  }

  if (text.length <= 40 && !PROJECT_REFERENCE_PATTERN.test(text)) {
    return 'conversational';
  }

  if (PROJECT_REFERENCE_PATTERN.test(text)) {
    return 'project_read';
  }

  return 'conversational';
}

const FIX_AND_DIAGNOSE_PATTERN =
  /\b(analis[ea].*(faz|fazer|corrig|arrum|consert|implement|melhor)|ver o que d[aá]|o que d[aá] pra fazer|n[aã]o consegue|nunca consegue|n[aã]o funciona|n[aã]o t[aá]|bug|problema|arrum|consert|corrig|refator|polir|fazer funcionar)\b/iu;

export function looksLikeFixOrImproveRequest(prompt: string): boolean {
  return FIX_AND_DIAGNOSE_PATTERN.test(prompt.trim());
}

export function looksLikeImplementationRequest(prompt: string): boolean {
  const text = prompt.trim();
  return WRITE_PATTERN.test(text) || IMPLEMENT_PATTERN.test(text) || looksLikeFixOrImproveRequest(text);
}

export function resolveEffectiveIntent(
  prompt: string,
  classified: MessageIntent,
  operationMode: OperationMode
): MessageIntent {
  if (operationMode !== 'agent') {
    return classified;
  }
  if (classified === 'conversational') {
    if (looksLikeFixOrImproveRequest(prompt) || looksLikeImplementationRequest(prompt)) {
      return 'project_write';
    }
    return classified;
  }
  if (classified === 'project_write') {
    return classified;
  }
  if (looksLikeFixOrImproveRequest(prompt) || looksLikeImplementationRequest(prompt)) {
    return 'project_write';
  }
  if (READ_ONLY_PATTERN.test(prompt)) {
    return 'project_read';
  }
  return 'project_write';
}

export function resolveMessageMode(
  operationMode: OperationMode,
  intent: MessageIntent,
  allowWriteOverride: boolean
): ResolvedMessageMode {
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
      return {
        intent,
        toolsMode: 'chat',
        useTools: false,
        showIterations: false,
      };
    }
    if (operationMode === 'analyze') {
      return {
        intent,
        toolsMode: 'agent',
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

  return {
    intent,
    toolsMode: operationMode,
    useTools: true,
    showIterations: true,
  };
}
