import { OperationMode, READ_ONLY_TOOLS } from '../config/settings';
import { ToolDefinition } from './types';
import { MessageIntent } from './messageIntent';
import { ExecutionPhase } from './executionPhase';

export interface SystemPromptOptions {
  intent?: MessageIntent;
  phase?: ExecutionPhase;
  toolsMode?: OperationMode;
}

const ALL_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Lê arquivo em trechos (~350 linhas). Arquivos grandes vêm particionados automaticamente.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho relativo do arquivo' },
        start_line: { type: 'number', description: 'Linha inicial (1-based). Para trecho específico ou busca por linha.' },
        end_line: { type: 'number', description: 'Linha final inclusive (opcional)' },
        continue_read: { type: 'boolean', description: 'true = próximo bloco após o último lido deste arquivo' },
        chunk_size: { type: 'number', description: 'Tamanho do bloco em linhas (padrão 350)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'edit_file',
    description: 'Edita por NÚMERO DE LINHA (preferido). Use números do read_file (ex: 118| ...).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho relativo do arquivo' },
        action: {
          type: 'string',
          enum: ['replace_lines', 'insert_lines', 'delete_lines'],
          description: 'replace_lines=substituir intervalo; insert_lines=inserir; delete_lines=remover',
        },
        start_line: { type: 'number', description: 'Linha inicial 1-based (do read_file)' },
        end_line: { type: 'number', description: 'Linha final inclusive (replace_lines, delete_lines)' },
        after_line: { type: 'number', description: 'Inserir após esta linha; 0=início (insert_lines)' },
        content: { type: 'string', description: 'Texto novo (replace_lines, insert_lines)' },
        verify_content: {
          type: 'string',
          description: 'Opcional: texto atual das linhas start–end (sem N|). Falha se não bater — reler read_file.',
        },
      },
      required: ['path', 'action'],
    },
  },
  {
    name: 'modify_file',
    description: 'Substitui trecho exato via old_content → new_content. Preferir edit_file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho relativo do arquivo' },
        old_content: { type: 'string', description: 'Trecho EXATO existente no arquivo' },
        new_content: { type: 'string', description: 'Trecho novo (substitui old_content)' },
      },
      required: ['path', 'old_content', 'new_content'],
    },
  },
  {
    name: 'create_file',
    description: 'Cria arquivo NOVO. Não sobrescreve arquivos grandes existentes.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho relativo do arquivo (ex: aaa.txt, src/app.ts)' },
        content: { type: 'string', description: 'Conteúdo completo do arquivo' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'delete_file',
    description: 'Exclui um arquivo do projeto (requer confirmação do usuário)',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho relativo do arquivo' },
      },
      required: ['path'],
    },
  },
  {
    name: 'test_project',
    description: 'Roda npm run compile/test/build para validar o projeto após alterações',
    parameters: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'Script do package.json (compile, test, build, lint). Padrão: compile ou test' },
      },
    },
  },
  {
    name: 'run_command',
    description: 'Executa um comando no terminal do projeto (requer aprovação)',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Comando a executar' },
        cwd: { type: 'string', description: 'Diretório de trabalho (opcional)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_files',
    description: 'Lista arquivos e pastas do projeto',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Diretório base (padrão: raiz)' },
        pattern: { type: 'string', description: 'Padrão glob opcional' },
      },
    },
  },
  {
    name: 'search_files',
    description: 'Busca texto nos arquivos do projeto',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto a buscar' },
        file_pattern: { type: 'string', description: 'Padrão de arquivo (ex: *.ts)' },
      },
      required: ['query'],
    },
  },
];

export class PromptManager {
  buildSystemPrompt(
    mode: OperationMode,
    projectContext?: string,
    taskContext?: string,
    options?: SystemPromptOptions
  ): string {
    const contextSection = projectContext
      ? `\n\n## Contexto do Projeto\n${projectContext}`
      : '';
    const taskSection = taskContext ?? '';
    const intent = options?.intent;
    const phase = options?.phase;
    const toolsMode = options?.toolsMode ?? mode;

    if (toolsMode === 'agent' && intent === 'project_write') {
      return this.buildAgentWritePrompt(contextSection, taskSection, phase);
    }

    if (mode === 'chat') {
      return `Você é um assistente de programação local integrado ao VSCode, rodando via Ollama.

## Modo atual: CHAT (conversa)
- Responda em português brasileiro, de forma natural e amigável
- Para cumprimentos, conversa casual e dúvidas conceituais, responda diretamente em texto — sem ferramentas
- Se o usuário pedir para ler ou alterar arquivos, explique o que faria e informe que a aplicação pedirá confirmação antes de executar
- Não recuse ajudar: oriente o usuário e responda o que puder em texto
- Seja conciso, claro e prestativo
${contextSection}${taskSection}`;
    }

    if (mode === 'analyze') {
      return `Você é um analista de código local integrado ao VSCode.

## Modo atual: ANÁLISE (prioridade leitura)
- Use ferramentas SOMENTE quando o usuário pedir algo relacionado ao projeto (ler, buscar, analisar arquivos)
- Para cumprimentos, conversa casual ou perguntas gerais, responda em texto — NÃO liste arquivos nem explore o projeto
- Você PODE ler arquivos, listar pastas e buscar no código quando relevante
- Alterações em arquivos exigem aprovação do usuário — se pedirem edição, execute com a ferramenta adequada após explicar
- Analise o projeto e responda com insights, explicações, revisões e sugestões em texto
- Nunca explore o projeto "por curiosidade" — só use ferramentas com propósito claro
- Responda em português brasileiro

## Ferramentas disponíveis (somente leitura)
- read_file, list_files, search_files

## Formato de chamada de ferramenta
\`\`\`json
{ "tool_calls": [{ "name": "read_file", "arguments": { "path": "src/app.ts" } }] }
\`\`\`

Após coletar informações, responda com a análise completa em texto.
${contextSection}${taskSection}`;
    }

    return `Você é um assistente de programação local integrado ao VSCode. Você pode conversar normalmente E, quando necessário, usar ferramentas para interagir com o projeto.

## Modo atual: AGENTE (conversa + ações quando pedidas)
- Este modo ainda é um CHAT — nem toda mensagem exige ferramentas
- Para cumprimentos ("bom dia", "olá"), agradecimentos e conversa casual: responda SOMENTE em texto, sem ferramentas
- Para perguntas conceituais (ex: "o que é JWT?"): responda em texto, sem ferramentas
- Use ferramentas APENAS quando o usuário pedir explicitamente algo sobre o projeto (ler, criar, editar, buscar arquivos, executar comandos)
- NÃO liste arquivos nem leia o projeto "só porque está no modo agente"
- Quando usar ferramentas, faça alterações mínimas e focadas
- Sempre forneça o conteúdo COMPLETO ao criar ou modificar arquivos
- Explique brevemente o que está fazendo antes de cada ação com ferramenta
- Responda em português brasileiro

## Criar vs editar arquivos
- Quando o usuário pedir para **"criar um arquivo X com conteúdo Y"**, use **create_file** — mesmo que o arquivo já exista (ele sobrescreve automaticamente)
- **NÃO** chame create_file e depois modify_file para o mesmo pedido
- **NÃO** leia o arquivo após salvar — considere a tarefa concluída após create_file ou modify_file com sucesso
- Use **modify_file** apenas para alterações parciais em arquivos existentes
- Use sempre caminhos **relativos** (ex: aaa.txt), nunca caminhos absolutos

## JSON em ferramentas (OBRIGATÓRIO)
Ao chamar create_file ou modify_file, o JSON deve ser válido:
- Prefira ASPAS SIMPLES dentro do código: print('Olá!') em vez de print("Olá!")
- Se usar aspas duplas no código, escape com barra: print(\\"Olá!\\")
- Exemplo correto: {"path":"feijoada.py","content":"print('Olá, Mundo!')"}
- NUNCA deixe aspas duplas soltas dentro do valor de "content"

## Ferramentas Disponíveis
- read_file, modify_file, create_file, delete_file, run_command, list_files, search_files

## Formato de Chamada de Ferramenta
Use EXATAMENTE um destes formatos JSON:
\`\`\`json
{ "name": "create_file", "arguments": { "path": "arquivo.py", "content": "print('Olá!')" } }
\`\`\`

Ou com "parameters" (equivalente a "arguments"):
\`\`\`json
{ "name": "create_file", "parameters": { "path": "arquivo.py", "content": "print('Olá!')" } }
\`\`\`

NÃO responda só com JSON sem executar — envie a chamada de ferramenta diretamente.
${contextSection}${taskSection}`;
  }

  private buildAgentWritePrompt(
    contextSection: string,
    taskSection: string,
    phase?: ExecutionPhase
  ): string {
    const phaseBlock = phase === 'implement'
      ? `
## FASE ATUAL: IMPLEMENTAÇÃO
- Leitura ampla ENCERRADA — não use read_file sem start_line/end_line
- **search_files** permitido para achar linha (ex: nome de função ou classe CSS)
- **read_file** permitido: trecho ≤350 linhas não lido OU ≤30 linhas para reverificar
- Use **edit_file replace_lines** — NUNCA reescreva o arquivo inteiro
- Depois de editar, chame **test_project** para validar`
      : `
## Fase: EXPLORAÇÃO
- Leia trechos com read_file (use start_line/end_line em arquivos grandes)
- Depois edite com **edit_file** — mudanças mínimas e precisas
- Valide com **test_project** quando terminar`;

    return `Você é um agente de código no VSCode (estilo Cursor/Codex) com ferramentas reais.

## Missão
Você é um **editor de código** — o pedido do usuário DEVE resultar em alterações reais (edit_file).
Pedidos amplos (UI, layout, refatoração) → leia o necessário, depois **edit_file** em cada arquivo relevante.
Nunca encerre só com texto se o pedido pedia mudança no código. Divida mentalmente em etapas se precisar.

## Fluxo recomendado (estilo Cursor/Codex)
1. **read_file** — primeiro bloco (automático ~350 linhas se grande)
2. **continue_read=true** ou **start_line=N** — próximos trechos só se precisar
3. **edit_file** — alteração cirúrgica no trecho relevante
4. **test_project** — compile/test
5. Corrigir com nova **edit_file** se falhar

## Leitura particionada
- Arquivos >120 linhas: nunca enviam tudo de uma vez
- Cada bloco traz numeração \`N| linha\` — use em edit_file replace_lines
- Só leia mais blocos se o trecho alvo ainda não estiver visível
- search_files para achar linha antes de ler trecho específico

${phaseBlock}

## edit_file — SEMPRE por número de linha (nunca search_replace)

1. **read_file** → anote \`N| linha\` (ex: linha 118)
2. **edit_file replace_lines** com \`start_line\`, \`end_line\`, \`content\`
3. Opcional: **verify_content** = texto atual das linhas (sem o prefixo \`N|\`) — se mudou, falha e mostra o trecho real
4. Se verify falhar → **read_file** de novo com \`start_line\`/\`end_line\` estreito e corrija os números

| action | uso |
| replace_lines | substituir linhas start_line–end_line por content |
| insert_lines | inserir content após after_line (0 = início) |
| delete_lines | remover linhas start_line–end_line |

**PROIBIDO:** search_replace, old_text, reescrever arquivo inteiro.

## Exemplo
\`\`\`json
{ "name": "edit_file", "arguments": { "path": "src/ui/panelHtml.ts", "action": "replace_lines", "start_line": 118, "end_line": 119, "verify_content": "    .message.assistant {\\n      white-space: normal;", "content": "    .message.assistant {\\n      white-space: pre-wrap;" } }
\`\`\`

## create_file
Somente para arquivos **novos**. Arquivos existentes grandes → edit_file.

## test_project
Roda npm run compile (ou test/build). Use após editar para garantir que compila.

## Ferramentas
read_file, edit_file, modify_file, create_file, delete_file, test_project, run_command, list_files, search_files
${contextSection}${taskSection}`;
  }

  getToolDefinitions(mode: OperationMode): ToolDefinition[] {
    if (mode === 'chat') {
      return [];
    }
    if (mode === 'analyze') {
      return ALL_TOOLS.filter((t) => (READ_ONLY_TOOLS as readonly string[]).includes(t.name));
    }
    return ALL_TOOLS;
  }

  getToolDefinitionsForIntent(toolsMode: OperationMode, intent: MessageIntent): ToolDefinition[] {
    if (toolsMode === 'chat') {
      return [];
    }
    if (toolsMode === 'analyze') {
      return ALL_TOOLS.filter((t) => (READ_ONLY_TOOLS as readonly string[]).includes(t.name));
    }
    if (toolsMode === 'agent' && intent === 'project_read') {
      return ALL_TOOLS.filter((t) => (READ_ONLY_TOOLS as readonly string[]).includes(t.name));
    }
    return ALL_TOOLS;
  }

  isToolAllowed(mode: OperationMode, toolName: string, intent?: MessageIntent): boolean {
    if (mode === 'chat') {
      return false;
    }
    if (mode === 'analyze') {
      return (READ_ONLY_TOOLS as readonly string[]).includes(toolName);
    }
    if (mode === 'agent' && intent === 'project_read') {
      return (READ_ONLY_TOOLS as readonly string[]).includes(toolName);
    }
    return true;
  }
}
