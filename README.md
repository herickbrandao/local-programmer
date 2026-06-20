# Local Programmer AI

Extensão VSCode de agente de programação com IA local via Ollama. Alternativa privada ao Cline, com histórico completo, rollback e controle de permissões.

## Funcionalidades

- **Chat lateral** com IA local (Ollama)
- **Agente com ferramentas**: ler, criar, modificar, excluir arquivos e executar comandos
- **Diff visual** estilo Git com aceitar/rejeitar alterações
- **Snapshots automáticos** em `.ai-history/version_XXX/`
- **Rollback completo** — reverta qualquer alteração
- **Comparação entre versões**
- **Sistema de permissões** (Manual / Smart / Auto)
- **Indexação de projeto** com mapa de arquivos e dependências
- **Arquitetura multi-provider** preparada para OpenAI e Claude

## Pré-requisitos

1. [VSCode](https://code.visualstudio.com/) 1.85+
2. [Ollama](https://ollama.com/) rodando localmente
3. Um modelo de código instalado:

```bash
ollama pull qwen2.5-coder:7b
# ou
ollama pull deepseek-coder-v2
# ou
ollama pull codellama
```

## Instalação (desenvolvimento)

```bash
cd local-programmer
npm install
npm run compile
```

Pressione `F5` no VSCode para abrir a janela de extensão.

## Uso

1. Abra um projeto no VSCode
2. Clique no ícone **Local Programmer** na barra lateral
3. Selecione o modelo Ollama
4. Clique em **Indexar** para mapear o projeto
5. Digite seu prompt, ex: *"Crie uma API de usuários com autenticação JWT"*

## Comandos

| Comando | Descrição |
|---------|-----------|
| `AI: Open Chat` | Abre o painel de chat |
| `AI: Rollback Last Change` | Reverte a última alteração |
| `AI: Restore Version` | Restaura uma versão específica |
| `AI: Restore File` | Restaura um arquivo de uma versão |
| `AI: Compare Versions` | Compara duas versões |
| `AI: Index Project` | Indexa o projeto |

## Configurações

| Setting | Padrão | Descrição |
|---------|--------|-----------|
| `localProgrammer.ollamaUrl` | `http://localhost:11434` | URL do Ollama |
| `localProgrammer.model` | `qwen2.5-coder:7b` | Modelo a utilizar |
| `localProgrammer.permissionMode` | `smart` | `manual`, `smart` ou `auto` |
| `localProgrammer.maxAgentIterations` | `20` | Máximo de iterações por prompt |

## Modos de Permissão

- **Manual**: Toda ação pede aprovação
- **Smart** (padrão): Leitura automática, escrita pede aprovação
- **Auto**: Autonomia total com snapshots automáticos

## Estrutura gerada no projeto

```
.ai-history/          # Snapshots e histórico de versões
  version_001/
    manifest.json
    before/
    after/
  permissions.log

.ai-context/           # Índice do projeto
  project-map.json
  dependencies.json
  code-index.json

.ai-settings/          # Configurações persistentes
  permissions.json
```

## Arquitetura

```
src/
├── extension.ts
├── ai/
│   ├── ollamaProvider.ts
│   ├── promptManager.ts
│   ├── agentController.ts
│   └── provider.ts
├── tools/
│   ├── readFile.ts
│   ├── modifyFile.ts
│   ├── createFile.ts
│   ├── deleteFile.ts
│   └── runCommand.ts
├── editor/
│   ├── diffManager.ts
│   └── codeModifier.ts
├── permissions/
│   ├── permissionManager.ts
│   └── rules.ts
├── history/
│   ├── snapshotManager.ts
│   └── rollbackManager.ts
├── workspace/
│   ├── fileIndexer.ts
│   └── contextManager.ts
└── ui/
    └── chatViewProvider.ts
```

## Licença

MIT
