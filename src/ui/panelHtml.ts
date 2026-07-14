export function getPanelHtml(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Local Programmer AI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    .header {
      padding: 10px 12px 0;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }
    .header h2 {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .header h2::before {
      content: '⬡';
      color: var(--vscode-textLink-foreground);
    }
    .tabs {
      display: flex;
      gap: 0;
      margin-top: 4px;
    }
    .tab {
      flex: 1;
      padding: 8px 12px;
      border: none;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: var(--vscode-descriptionForeground);
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .tab:hover { color: var(--vscode-foreground); }
    .tab.active {
      color: var(--vscode-foreground);
      border-bottom-color: var(--vscode-textLink-foreground);
      font-weight: 600;
    }
    .tab-panel {
      display: none;
      flex: 1;
      flex-direction: column;
      overflow: hidden;
    }
    .tab-panel.active { display: flex; }
    .controls {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      align-items: center;
    }
    .controls select, .controls button, .form button, .form input, .form select {
      font-family: inherit;
      font-size: 11px;
      padding: 4px 8px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 3px;
    }
    .controls button, .form button.primary {
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
    }
    .controls button:hover, .form button.primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .status {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      padding: 0 12px 8px;
    }
    .status.error { color: var(--vscode-errorForeground); }
    .status.ok { color: var(--vscode-testing-iconPassed); }
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .message {
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
      line-height: 1.5;
      max-width: 95%;
      word-wrap: break-word;
    }
    .message.user, .message.system, .message.tool, .message.error {
      white-space: pre-wrap;
    }
    .message.assistant {
      white-space: pre-wrap;
    }
    .message.user {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      align-self: flex-end;
    }
    .message.assistant {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      align-self: flex-start;
    }
    .message.system {
      background: transparent;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      font-style: italic;
      align-self: center;
      text-align: center;
      padding: 4px;
    }
    .message.tool {
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textLink-foreground);
      font-size: 11px;
      font-family: var(--vscode-editor-font-family);
      align-self: flex-start;
    }
    .message.error {
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-errorForeground);
    }
    .message-content { display: flex; flex-direction: column; gap: 6px; }
    .message-content .md-text { white-space: pre-wrap; word-break: break-word; }
    .message-content p { margin: 0 0 6px 0; }
    .message-content p:last-child { margin-bottom: 0; }
    .inline-code {
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      padding: 1px 5px;
      border-radius: 3px;
      background: var(--vscode-textCodeBlock-background);
      border: 1px solid var(--vscode-panel-border);
    }
    .code-block {
      margin: 4px 0;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-textCodeBlock-background);
    }
    .code-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 5px 10px;
      background: var(--vscode-editorWidget-background);
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .code-lang {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family);
      text-transform: lowercase;
    }
    .copy-btn {
      padding: 2px 10px;
      font-size: 11px;
      font-family: inherit;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-foreground);
      border-radius: 3px;
      cursor: pointer;
    }
    .copy-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
    .copy-btn.copied { color: var(--vscode-testing-iconPassed); border-color: var(--vscode-testing-iconPassed); }
    .code-block pre {
      margin: 0;
      padding: 10px 12px;
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      line-height: 1.45;
    }
    .code-block code {
      white-space: pre;
      color: var(--vscode-editor-foreground);
    }
    .input-area {
      padding: 12px;
      border-top: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }
    .input-wrapper { display: flex; gap: 6px; }
    textarea {
      flex: 1;
      font-family: inherit;
      font-size: 13px;
      padding: 8px 10px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      resize: none;
      min-height: 60px;
      max-height: 150px;
    }
    textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
    /* Continua-like: composer brilha enquanto o agente trabalha */
    .input-wrapper.working textarea {
      outline: none;
      border-color: color-mix(in srgb, var(--vscode-focusBorder) 70%, transparent);
      animation: composer-glow 1.8s ease-in-out infinite;
    }
    @keyframes composer-glow {
      0%, 100% {
        box-shadow:
          0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder) 55%, transparent),
          0 0 10px color-mix(in srgb, var(--vscode-focusBorder) 35%, transparent);
      }
      50% {
        box-shadow:
          0 0 0 2px var(--vscode-focusBorder),
          0 0 18px color-mix(in srgb, var(--vscode-button-background) 45%, transparent);
      }
    }
    .send-btn, .stop-btn {
      align-self: flex-end;
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: 13px;
    }
    .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .stop-btn {
      display: none;
      background: var(--vscode-errorForeground);
      color: var(--vscode-editor-background);
      white-space: nowrap;
    }
    .input-wrapper.working .stop-btn { display: inline-block; }
    .input-wrapper.working .send-btn { display: none; }
    .stop-btn:hover { opacity: 0.9; }
    /* Wrapper evita bug do webview: summary com display:flex colapsa altura → some do chat */
    .activity-wrap {
      align-self: stretch;
      width: 100%;
      flex: 0 0 auto;
      min-height: 36px;
    }
    .activity-accordion {
      display: block;
      width: 100%;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      font-size: 12px;
      overflow: hidden;
    }
    .activity-accordion > summary {
      display: block;
      list-style: none;
      cursor: pointer;
      padding: 8px 12px;
      color: var(--vscode-descriptionForeground);
      user-select: none;
      min-height: 20px;
      line-height: 1.4;
    }
    .activity-accordion > summary::-webkit-details-marker { display: none; }
    .activity-summary-row {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      box-sizing: border-box;
    }
    .activity-chevron {
      flex-shrink: 0;
      width: 12px;
      font-size: 10px;
      color: var(--vscode-textLink-foreground);
      transition: transform 0.15s ease;
      display: inline-block;
    }
    .activity-accordion[open] .activity-chevron { transform: rotate(90deg); }
    .activity-title {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--vscode-foreground);
    }
    .activity-meta {
      flex: 0 0 auto;
      font-size: 11px;
      opacity: 0.85;
      white-space: nowrap;
    }
    .activity-body {
      display: block;
      border-top: 1px solid var(--vscode-panel-border);
      max-height: 220px;
      overflow-y: auto;
      padding: 6px 0;
      background: var(--vscode-sideBar-background);
    }
    .activity-item {
      padding: 4px 12px;
      font-size: 11px;
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--vscode-descriptionForeground);
      border-left: 2px solid transparent;
      margin: 2px 8px;
    }
    .activity-item.activity-thinking { border-left-color: var(--vscode-textLink-foreground); }
    .activity-item.activity-tool {
      border-left-color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d);
      font-family: var(--vscode-editor-font-family);
    }
    .message.assistant.streaming { opacity: 0.95; }
    .message.assistant.streaming::after {
      content: '▍
      animation: blink 1s step-end infinite;
      color: var(--vscode-textLink-foreground);
    }
    @keyframes blink { 50% { opacity: 0; } }
    .settings-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }
    .form { display: flex; flex-direction: column; gap: 14px; }
    .form-group { display: flex; flex-direction: column; gap: 4px; }
    .form-group label {
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }
    .form-group .hint {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
    }
    .form-group input[type="text"],
    .form-group input[type="number"],
    .form-group select {
      width: 100%;
      padding: 6px 8px;
      font-size: 12px;
    }
    .form-group.checkbox {
      flex-direction: row;
      align-items: center;
      gap: 8px;
    }
    .form-group.checkbox label { font-weight: normal; }
    .form-actions {
      display: flex;
      gap: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--vscode-panel-border);
    }
    .form-actions button { padding: 6px 14px; cursor: pointer; }
    .test-result {
      font-size: 11px;
      padding: 8px;
      border-radius: 4px;
      margin-top: 4px;
    }
    .test-result.ok {
      background: var(--vscode-testing-iconPassed);
      color: var(--vscode-editor-background);
      opacity: 0.9;
    }
    .test-result.fail {
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-errorForeground);
    }
    .section-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      margin-top: 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .session-bar {
      display: flex;
      gap: 6px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      align-items: center;
      background: var(--vscode-editor-background);
    }
    .session-bar select {
      flex: 1;
      min-width: 0;
      font-family: inherit;
      font-size: 11px;
      padding: 5px 8px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 3px;
    }
    .session-bar button {
      font-family: inherit;
      font-size: 11px;
      padding: 5px 10px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-button-secondaryBackground, var(--vscode-input-background));
      color: var(--vscode-foreground);
      border-radius: 3px;
      cursor: pointer;
      white-space: nowrap;
    }
    .session-bar button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
    }
    .session-bar button:hover { opacity: 0.9; }
    .message.file-change {
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border);
      border-left: 3px solid var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d);
      align-self: stretch;
      max-width: 100%;
      padding: 10px 12px;
    }
    .file-change-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .file-change-icon { font-size: 14px; flex-shrink: 0; }
    .file-change-name {
      font-family: var(--vscode-editor-font-family);
      word-break: break-all;
      color: var(--vscode-foreground);
    }
    .file-change-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 6px;
    }
    .file-change-actions {
      display: flex;
      gap: 8px;
    }
    .action-btn {
      font-family: inherit;
      font-size: 11px;
      padding: 4px 12px;
      border-radius: 3px;
      cursor: pointer;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-foreground);
    }
    .action-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
    .action-btn.compare { border-color: var(--vscode-textLink-foreground); color: var(--vscode-textLink-foreground); }
    .action-btn.restore { border-color: var(--vscode-inputValidation-warningBorder, #cca700); }
    .message.checkpoint-card {
      align-self: stretch;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-panel-border);
      border-left: 3px solid var(--vscode-charts-green, #89d185);
      border-radius: 6px;
      padding: 10px 12px;
      max-width: 100%;
    }
    .checkpoint-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }
    .checkpoint-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--vscode-foreground);
      margin-bottom: 6px;
    }
    .checkpoint-files {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
      line-height: 1.45;
      word-break: break-word;
    }
    .checkpoint-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .cite-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      max-width: min(280px, 100%);
      padding: 2px 8px;
      margin: 0 2px;
      border-radius: 999px;
      font-size: 11px;
      line-height: 1.4;
      cursor: pointer;
      vertical-align: middle;
      border: 1px solid var(--vscode-badge-background, var(--vscode-panel-border));
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-family: inherit;
    }
    .cite-chip:hover {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground));
    }
    .cite-chip-file { border-color: var(--vscode-textLink-foreground); color: var(--vscode-textLink-foreground); }
    .cite-chip-msg { border-color: var(--vscode-charts-purple, #b180d7); }
    .cite-chip-icon { flex-shrink: 0; font-size: 12px; }
    .cite-chip-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 220px;
    }
    .user-message-body { white-space: pre-wrap; word-break: break-word; }
    .message.cite-highlight {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: 2px;
      border-radius: 4px;
    }
    .processing-indicator {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      padding: 4px 12px;
      display: none;
      font-variant-numeric: tabular-nums;
    }
    .processing-indicator.visible { display: block; }
    .message.timing-meta {
      align-self: flex-start;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.9;
      padding: 2px 10px 6px;
      margin-top: -2px;
      font-variant-numeric: tabular-nums;
    }
    option.inactive { color: var(--vscode-errorForeground); }
    .token-wrap { position: relative; margin-left: auto; }
    .token-btn {
      font-family: inherit;
      font-size: 11px;
      padding: 5px 8px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-foreground);
      border-radius: 3px;
      cursor: pointer;
    }
    .token-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
    .token-popup {
      display: none;
      position: absolute;
      right: 0;
      top: calc(100% + 4px);
      z-index: 100;
      min-width: 220px;
      padding: 10px 12px;
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      font-size: 11px;
      line-height: 1.6;
    }
    .token-popup.visible { display: block; }
    .token-popup h4 {
      margin: 0 0 8px 0;
      font-size: 12px;
      font-weight: 600;
    }
    .token-row { display: flex; justify-content: space-between; gap: 12px; }
    .token-row span:last-child { font-family: var(--vscode-editor-font-family); }
    .message-actions {
      display: flex;
      gap: 6px;
      margin-top: 6px;
    }
    .msg-action-btn {
      font-family: inherit;
      font-size: 10px;
      padding: 2px 8px;
      border: 1px solid var(--vscode-panel-border);
      background: transparent;
      color: var(--vscode-descriptionForeground);
      border-radius: 3px;
      cursor: pointer;
    }
    .msg-action-btn:hover {
      color: var(--vscode-foreground);
      background: var(--vscode-toolbar-hoverBackground);
    }
    .input-toolbar {
      display: flex;
      gap: 6px;
      margin-bottom: 6px;
    }
    .input-toolbar button {
      font-family: inherit;
      font-size: 11px;
      padding: 4px 10px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-foreground);
      border-radius: 3px;
      cursor: pointer;
    }
    .input-toolbar button:hover { background: var(--vscode-toolbar-hoverBackground); }
  </style>
</head>
<body>
  <div class="header">
    <h2>Local Programmer AI</h2>
    <div class="tabs">
      <button class="tab active" data-tab="chat">Chat</button>
      <button class="tab" data-tab="settings">Configurações</button>
    </div>
  </div>

  <div id="tab-chat" class="tab-panel active">
    <div class="session-bar">
      <select id="sessionSelect" title="Conversas salvas"></select>
      <button id="newChatBtn" class="primary" title="Nova conversa">+ Novo</button>
      <button id="deleteChatBtn" title="Excluir conversa">🗑</button>
    </div>
    <div class="controls">
      <select id="operationModeSelect" title="Modo de operação">
        <option value="chat">💬 Chat</option>
        <option value="analyze">🔍 Análise</option>
        <option value="agent">⚙️ Agente</option>
      </select>
      <select id="modelSelect" title="Modelo"><option value="">Carregando...</option></select>
      <button id="refreshBtn" title="Atualizar modelos">🔄</button>
      <button id="indexBtn" title="Indexar projeto">📁 Indexar</button>
      <div class="token-wrap">
        <button id="tokenBtn" class="token-btn" title="Uso de tokens">⬡ 0</button>
        <div id="tokenPopup" class="token-popup">
          <h4>Uso de tokens</h4>
          <div class="token-row"><span>Última requisição</span><span id="tokenLast">—</span></div>
          <div class="token-row"><span>Sessão (total)</span><span id="tokenSession">—</span></div>
          <div class="token-row"><span>Requisições</span><span id="tokenRequests">0</span></div>
        </div>
      </div>
    </div>
    <div id="status" class="status">Conectando ao Ollama...</div>
    <div id="processing" class="processing-indicator">Pensando...</div>
    <div id="messages" class="messages">
      <div class="message system">Agente de programação local com Ollama. 100% privado.</div>
    </div>
    <div class="input-area">
      <div class="input-toolbar">
        <button type="button" id="citeFileBtn" title="Citar arquivo">📎 Arquivo</button>
        <button type="button" id="citeEditorBtn" title="Citar seleção do editor">⌗ Seleção</button>
      </div>
      <div class="input-wrapper">
        <textarea id="promptInput" placeholder="Use @arquivo.ts:10-20 ou @msg:id para citar. Ex: adicione opção de citar mensagem..." rows="3"></textarea>
        <button id="sendBtn" class="send-btn">Enviar</button>
        <button id="stopBtn" class="stop-btn" type="button" title="Interromper execução">Parar</button>
      </div>
    </div>
  </div>

  <div id="tab-settings" class="tab-panel">
    <div class="settings-scroll">
      <form id="settingsForm" class="form">
        <div class="section-title">Ollama</div>

        <div class="form-group">
          <label for="ollamaUrl">URL do Ollama</label>
          <input type="text" id="ollamaUrl" placeholder="http://localhost:11434">
          <span class="hint">Endereço do servidor Ollama local</span>
        </div>

        <div class="form-group">
          <label for="connectionTimeoutMs">Timeout de conexão (ms)</label>
          <input type="number" id="connectionTimeoutMs" min="1000" max="300000" step="1000">
          <span class="hint">Tempo para conectar e listar modelos (padrão: 30000)</span>
        </div>

        <div class="form-group">
          <label for="requestTimeoutMs">Timeout de resposta (ms)</label>
          <input type="number" id="requestTimeoutMs" min="5000" max="3600000" step="1000">
          <span class="hint">Tempo máximo por resposta do chat — modelos grandes precisam de 300000+ (5 min)</span>
        </div>

        <div class="form-group">
          <label for="settingsModel">Modelo padrão</label>
          <select id="settingsModel"><option value="">Carregando modelos...</option></select>
        </div>

        <div class="form-group">
          <label for="temperature">Temperatura</label>
          <input type="number" id="temperature" min="0" max="2" step="0.1">
          <span class="hint">0 = preciso, 2 = criativo</span>
        </div>

        <div class="section-title">Agente</div>

        <div class="form-group">
          <label for="operationMode">Modo de operação padrão</label>
          <select id="operationMode">
            <option value="chat">Chat — só conversa, sem ferramentas</option>
            <option value="analyze">Análise — ler código sem alterar</option>
            <option value="agent">Agente — editar arquivos e executar comandos</option>
          </select>
        </div>

        <div class="form-group">
          <label for="permissionMode">Modo de permissão</label>
          <select id="permissionMode">
            <option value="manual">Manual — tudo pede aprovação</option>
            <option value="smart">Smart — leitura automática</option>
            <option value="auto">Auto — autonomia com snapshots</option>
          </select>
        </div>

        <div class="form-group">
          <label for="maxAgentIterations">Máx. iterações</label>
          <input type="number" id="maxAgentIterations" min="1" max="100">
          <span class="hint">Quantas rodadas de ferramentas por prompt</span>
        </div>

        <div class="form-group">
          <label for="maxResponseTokens">Máx. tokens na resposta</label>
          <input type="number" id="maxResponseTokens" min="256" max="999999999999" step="256">
          <span class="hint">Evita respostas cortadas — padrão 8192 (num_predict Ollama)</span>
        </div>

        <div class="section-title">Interface do chat</div>

        <div class="form-group checkbox">
          <input type="checkbox" id="showThinking">
          <label for="showThinking">Incluir atividade do agente (accordion minimizado)</label>
        </div>

        <div class="form-group checkbox">
          <input type="checkbox" id="showToolCalls">
          <label for="showToolCalls">Mostrar chamadas de ferramentas</label>
        </div>

        <div class="form-group checkbox">
          <input type="checkbox" id="showToolResults">
          <label for="showToolResults">Mostrar resultados das ferramentas</label>
        </div>

        <div id="testResult" class="test-result" style="display:none"></div>

        <div class="form-actions">
          <button type="button" id="testBtn">Testar conexão</button>
          <button type="submit" class="primary">Salvar</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const state = {
      settings: {},
      isProcessing: false,
      activeSessionId: '',
      fileChangeData: new Map(),
      chatUi: { model: '', operationMode: 'chat', userLocked: false },
      tokenStats: null,
      messageById: {},
      activity: { el: null, body: null, summary: null, wrap: null, count: 0 },
      streaming: { el: null, content: '' },
      timing: { startedAt: 0, timerId: null, stopping: false },
    };

    const els = {
      messages: document.getElementById('messages'),
      promptInput: document.getElementById('promptInput'),
      sendBtn: document.getElementById('sendBtn'),
      stopBtn: document.getElementById('stopBtn'),
      modelSelect: document.getElementById('modelSelect'),
      operationModeSelect: document.getElementById('operationModeSelect'),
      settingsModel: document.getElementById('settingsModel'),
      status: document.getElementById('status'),
      testResult: document.getElementById('testResult'),
      form: document.getElementById('settingsForm'),
      sessionSelect: document.getElementById('sessionSelect'),
      newChatBtn: document.getElementById('newChatBtn'),
      deleteChatBtn: document.getElementById('deleteChatBtn'),
      processing: document.getElementById('processing'),
      tokenBtn: document.getElementById('tokenBtn'),
      tokenPopup: document.getElementById('tokenPopup'),
      tokenLast: document.getElementById('tokenLast'),
      tokenSession: document.getElementById('tokenSession'),
      tokenRequests: document.getElementById('tokenRequests'),
      citeFileBtn: document.getElementById('citeFileBtn'),
      citeEditorBtn: document.getElementById('citeEditorBtn'),
    };

    const MODE_LABELS = { chat: 'Chat', analyze: 'Análise', agent: 'Agente' };
    const MODE_PLACEHOLDERS = {
      chat: 'Converse normalmente — ex: bom dia, explique o que é JWT...',
      analyze: 'Analise sem alterar — ex: analise src/auth.ts e liste problemas...',
      agent: 'Converse ou peça alterações — ex: bom dia, crie um arquivo X...',
    };

    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
        if (tab.dataset.tab === 'settings') {
          vscode.postMessage({ type: 'get_settings' });
        }
      });
    });

    vscode.postMessage({ type: 'ready' });

    function updateModelSelects(msg, opts = {}) {
      const selects = [els.modelSelect, els.settingsModel];
      const preserve = state.chatUi.userLocked && !opts.force && !msg.initial;

      const selectedModel = preserve && state.chatUi.model
        ? state.chatUi.model
        : (msg.currentModel || state.settings.model || state.chatUi.model || '');
      const selectedMode = preserve && state.chatUi.operationMode
        ? state.chatUi.operationMode
        : (msg.operationMode || state.settings.operationMode || state.chatUi.operationMode || 'chat');

      selects.forEach(sel => { sel.innerHTML = ''; });

      const options = msg.modelOptions || (msg.models || []).map(m => ({
        value: m,
        label: m,
        inactive: false,
      }));

      if (msg.error && options.length === 0) {
        els.modelSelect.innerHTML = '<option value="">Erro ao carregar</option>';
        els.status.textContent = '⚠ ' + msg.error;
        els.status.className = 'status error';
        return;
      }

      if (options.length === 0 && msg.ollamaAvailable === false) {
        if (selectedModel) {
          options.push({ value: selectedModel, label: selectedModel + ' (inativa)', inactive: true });
        } else {
          els.modelSelect.innerHTML = '<option value="">Ollama offline</option>';
          els.settingsModel.innerHTML = '<option value="">Ollama offline</option>';
          els.status.textContent = '⚠ Ollama offline — configure em Configurações';
          els.status.className = 'status error';
          return;
        }
      }

      if (options.length === 0) {
        els.modelSelect.innerHTML = '<option value="">Nenhum modelo</option>';
        els.settingsModel.innerHTML = '<option value="">Nenhum modelo</option>';
        els.status.textContent = '⚠ Nenhum modelo instalado';
        els.status.className = 'status error';
        return;
      }

      if (selectedModel && !options.some(o => o.value === selectedModel)) {
        options.unshift({ value: selectedModel, label: selectedModel + ' (inativa)', inactive: true });
      }

      options.forEach(opt => {
        [els.modelSelect, els.settingsModel].forEach(sel => {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          if (opt.inactive) o.className = 'inactive';
          if (opt.value === selectedModel) o.selected = true;
          sel.appendChild(o.cloneNode(true));
        });
      });

      if (els.modelSelect && selectedModel) els.modelSelect.value = selectedModel;
      if (els.settingsModel && selectedModel) els.settingsModel.value = selectedModel;
      if (els.operationModeSelect) els.operationModeSelect.value = selectedMode;

      state.chatUi.model = selectedModel;
      state.chatUi.operationMode = selectedMode;

      updatePlaceholder(selectedMode);

      const wsNote = msg.hasWorkspace ? '' : (selectedMode === 'chat' ? '' : ' | Abra uma pasta de projeto');
      const modeLabel = MODE_LABELS[selectedMode] || selectedMode;
      const inactiveNote = options.find(o => o.value === selectedModel && o.inactive) ? ' | modelo inativo' : '';
      els.status.textContent = '✓ Ollama | ' + modeLabel + wsNote + inactiveNote;
      els.status.className = msg.hasWorkspace || selectedMode === 'chat' ? 'status ok' : 'status';
    }

    function updateSessionBar(session, sessions) {
      if (!els.sessionSelect) return;
      els.sessionSelect.innerHTML = '';
      const list = [...(sessions || [])];
      const activeId = session?.id || state.activeSessionId || '';

      if (activeId && !list.some(s => s.id === activeId)) {
        list.unshift({
          id: activeId,
          title: session?.title || 'Chat',
          updatedAt: session?.updatedAt || '',
        });
      }

      list.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.title || 'Chat';
        if (s.id === activeId) opt.selected = true;
        els.sessionSelect.appendChild(opt);
      });

      state.activeSessionId = activeId || els.sessionSelect.value || '';
      if (els.deleteChatBtn) {
        els.deleteChatBtn.disabled = !state.activeSessionId;
      }
    }

    function isActivityKind(kind) {
      return kind === 'thinking' || kind === 'tool';
    }

    function resetActivityState() {
      state.activity = { el: null, body: null, summary: null, wrap: null, count: 0 };
    }

    function sealActivityAccordion() {
      if (!state.activity.el) return;
      const count = state.activity.count;
      const meta = state.activity.summary?.querySelector('.activity-meta');
      const title = state.activity.summary?.querySelector('.activity-title');
      if (meta) meta.textContent = count + ' passo' + (count === 1 ? '' : 's');
      if (title) title.textContent = 'Atividade do agente';
      state.activity.el.open = false;
      state.activity.el.setAttribute('data-sealed', '1');
      resetActivityState();
    }

    function addActivityItem(content, variant) {
      if (!content || !String(content).trim()) return;

      if (!state.activity.el || !state.activity.el.isConnected) {
        const wrap = document.createElement('div');
        wrap.className = 'activity-wrap';

        const details = document.createElement('details');
        details.className = 'activity-accordion';
        details.open = false;

        const summary = document.createElement('summary');
        summary.innerHTML =
          '<span class="activity-summary-row">' +
          '<span class="activity-chevron" aria-hidden="true">▸</span>' +
          '<span class="activity-title">Atividade do agente</span>' +
          '<span class="activity-meta">0 passos</span>' +
          '</span>';

        const body = document.createElement('div');
        body.className = 'activity-body';

        details.appendChild(summary);
        details.appendChild(body);
        wrap.appendChild(details);
        els.messages.appendChild(wrap);
        state.activity = { el: details, body, summary, wrap, count: 0 };
      }

      state.activity.count += 1;
      const item = document.createElement('div');
      item.className = 'activity-item activity-' + variant;
      item.textContent = content;
      state.activity.body.appendChild(item);

      const meta = state.activity.summary.querySelector('.activity-meta');
      const title = state.activity.summary.querySelector('.activity-title');
      const preview = String(content).replace(/\\s+/g, ' ').trim();
      if (meta) meta.textContent = state.activity.count + ' passo' + (state.activity.count === 1 ? '' : 's');
      if (title) title.textContent = preview.length > 72 ? preview.slice(0, 69) + '…' : preview;
      // Não forçar fechar: se o usuário abriu o accordion, permanece aberto ao chegar novo passo
      if (state.activity.el.open) {
        state.activity.body.scrollTop = state.activity.body.scrollHeight;
      }
      els.messages.scrollTop = els.messages.scrollHeight;
    }

    function clearStreamingMessage() {
      if (state.streaming.el?.isConnected) {
        state.streaming.el.remove();
      }
      state.streaming = { el: null, content: '' };
    }

    function appendStreamDelta(delta) {
      if (!delta) return;
      if (!state.streaming.el || !state.streaming.el.isConnected) {
        sealActivityAccordion();
        const div = document.createElement('div');
        div.className = 'message assistant streaming';
        const body = document.createElement('div');
        body.className = 'message-content md-text';
        div.appendChild(body);
        els.messages.appendChild(div);
        state.streaming = { el: div, content: '' };
      }
      state.streaming.content += delta;
      const body = state.streaming.el.querySelector('.message-content');
      if (body) body.textContent = state.streaming.content;
      els.messages.scrollTop = els.messages.scrollHeight;
    }

    function finalizeStreamingAsAssistant(content, msgMeta) {
      clearStreamingMessage();
      addMessage(content, 'assistant', msgMeta);
    }

    function renderUiMessage(msg) {
      if (!msg) return;
      switch (msg.kind) {
        case 'user':
          sealActivityAccordion();
          clearStreamingMessage();
          addMessage(msg.content, 'user', msg);
          break;
        case 'assistant':
          sealActivityAccordion();
          if (state.streaming.el) {
            finalizeStreamingAsAssistant(msg.content, msg);
          } else {
            addMessage(msg.content, 'assistant', msg);
          }
          break;
        case 'system':
          sealActivityAccordion();
          addMessage(msg.content, 'system', msg);
          break;
        case 'thinking':
          addActivityItem(msg.content, 'thinking');
          break;
        case 'tool':
          addActivityItem(msg.content, 'tool');
          break;
        case 'error':
          sealActivityAccordion();
          clearStreamingMessage();
          addMessage(msg.content, 'error', msg);
          break;
        case 'file_change':
          sealActivityAccordion();
          addFileChangeCard(msg.data);
          break;
        case 'checkpoint':
          sealActivityAccordion();
          addCheckpointCard(msg.data || {}, msg.content);
          break;
      }
    }

    function renderAllMessages(messages) {
      els.messages.innerHTML = '';
      state.fileChangeData.clear();
      state.messageById = {};
      resetActivityState();
      clearStreamingMessage();
      (messages || []).forEach(renderUiMessage);
      sealActivityAccordion();
    }

    function addCheckpointCard(data, fallbackContent) {
      const versionId = data?.versionId;
      if (!versionId) {
        if (fallbackContent) addMessage(fallbackContent, 'system');
        return;
      }

      const files = Array.isArray(data.files) ? data.files.filter(Boolean) : [];
      const div = document.createElement('div');
      div.className = 'message checkpoint-card';
      div.dataset.versionId = versionId;

      const label = document.createElement('div');
      label.className = 'checkpoint-label';
      label.textContent = '💾 Checkpoint';

      const title = document.createElement('div');
      title.className = 'checkpoint-title';
      title.textContent = versionId + (files.length
        ? (' · ' + files.length + ' arquivo' + (files.length === 1 ? '' : 's'))
        : '');

      const fileList = document.createElement('div');
      fileList.className = 'checkpoint-files';
      fileList.textContent = files.length
        ? files.join(', ')
        : 'Restaura todos os arquivos deste lote ao estado anterior.';

      const actions = document.createElement('div');
      actions.className = 'checkpoint-actions';

      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'action-btn restore';
      restoreBtn.type = 'button';
      restoreBtn.textContent = 'Restaurar tudo';
      restoreBtn.title = 'Voltar todos os arquivos deste checkpoint ao estado anterior';
      restoreBtn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'restore_checkpoint',
          data: { versionId, files },
        });
      });

      actions.appendChild(restoreBtn);
      div.appendChild(label);
      div.appendChild(title);
      div.appendChild(fileList);
      div.appendChild(actions);
      els.messages.appendChild(div);
      els.messages.scrollTop = els.messages.scrollHeight;
    }

    function addFileChangeCard(data) {
      if (!data || !data.file) return;

      const cardId = 'fc-' + data.file + '-' + Date.now();
      state.fileChangeData.set(cardId, data);

      const div = document.createElement('div');
      div.className = 'message file-change';
      div.dataset.file = data.file;
      div.dataset.cardId = cardId;

      const label = document.createElement('div');
      label.className = 'file-change-label';
      label.textContent = '📝 Arquivo alterado';

      const header = document.createElement('div');
      header.className = 'file-change-header';
      const icon = document.createElement('span');
      icon.className = 'file-change-icon';
      icon.textContent = '📄';
      const name = document.createElement('span');
      name.className = 'file-change-name';
      name.textContent = data.file;
      header.appendChild(icon);
      header.appendChild(name);

      const actions = document.createElement('div');
      actions.className = 'file-change-actions';

      const compareBtn = document.createElement('button');
      compareBtn.className = 'action-btn compare';
      compareBtn.type = 'button';
      compareBtn.textContent = 'Comparar';
      compareBtn.addEventListener('click', () => {
        const d = state.fileChangeData.get(cardId);
        if (d) vscode.postMessage({ type: 'compare_file', data: d });
      });

      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'action-btn restore';
      restoreBtn.type = 'button';
      restoreBtn.textContent = 'Restaurar';
      restoreBtn.addEventListener('click', () => {
        const d = state.fileChangeData.get(cardId);
        if (d) vscode.postMessage({ type: 'restore_file', data: d });
      });

      actions.appendChild(compareBtn);
      actions.appendChild(restoreBtn);

      div.appendChild(label);
      div.appendChild(header);
      div.appendChild(actions);
      els.messages.appendChild(div);
      els.messages.scrollTop = els.messages.scrollHeight;
    }

    function updateFileChangeCard(data) {
      if (!data?.file) return;
      const cards = els.messages.querySelectorAll('.message.file-change[data-file="' + CSS.escape(data.file) + '"]');
      cards.forEach(card => {
        const cardId = card.dataset.cardId;
        if (cardId) {
          const existing = state.fileChangeData.get(cardId) || {};
          state.fileChangeData.set(cardId, { ...existing, ...data });
        }
      });
    }

    function updatePlaceholder(mode) {
      els.promptInput.placeholder = MODE_PLACEHOLDERS[mode] || MODE_PLACEHOLDERS.chat;
    }

    function fillSettingsForm(settings) {
      state.settings = settings;
      document.getElementById('ollamaUrl').value = settings.ollamaUrl || '';
      document.getElementById('connectionTimeoutMs').value = settings.connectionTimeoutMs || 30000;
      document.getElementById('requestTimeoutMs').value = settings.requestTimeoutMs || 500000;
      document.getElementById('temperature').value = settings.temperature ?? 0.2;
      document.getElementById('operationMode').value = settings.operationMode || 'chat';
      document.getElementById('permissionMode').value = settings.permissionMode || 'smart';
      document.getElementById('maxAgentIterations').value = settings.maxAgentIterations || 50;
      document.getElementById('maxResponseTokens').value = settings.maxResponseTokens || 128000;
      document.getElementById('showThinking').checked = settings.showThinking !== false;
      document.getElementById('showToolCalls').checked = settings.showToolCalls !== false;
      document.getElementById('showToolResults').checked = settings.showToolResults !== false;
      if (settings.model && els.settingsModel) {
        const opt = Array.from(els.settingsModel.options).find(o => o.value === settings.model);
        if (opt) opt.selected = true;
      }
      if (els.operationModeSelect && settings.operationMode) {
        els.operationModeSelect.value = settings.operationMode;
        updatePlaceholder(settings.operationMode);
      }
    }

    function readSettingsForm() {
      return {
        ollamaUrl: document.getElementById('ollamaUrl').value.trim(),
        connectionTimeoutMs: parseInt(document.getElementById('connectionTimeoutMs').value, 10),
        requestTimeoutMs: parseInt(document.getElementById('requestTimeoutMs').value, 10),
        model: document.getElementById('settingsModel').value,
        temperature: parseFloat(document.getElementById('temperature').value),
        operationMode: document.getElementById('operationMode').value,
        permissionMode: document.getElementById('permissionMode').value,
        maxAgentIterations: parseInt(document.getElementById('maxAgentIterations').value, 10),
        maxResponseTokens: parseInt(document.getElementById('maxResponseTokens').value, 10),
        showThinking: document.getElementById('showThinking').checked,
        showToolCalls: document.getElementById('showToolCalls').checked,
        showToolResults: document.getElementById('showToolResults').checked,
      };
    }

    function escapeHtml(str) {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function scrollToMessage(msgId) {
      const el = els.messages.querySelector('[data-msg-id="' + msgId + '"]');
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('cite-highlight');
      setTimeout(() => el.classList.remove('cite-highlight'), 1600);
    }

    function parseCitationParts(text) {
      const parts = [];
      let i = 0;
      while (i < text.length) {
        const at = text.indexOf('@', i);
        if (at === -1) {
          parts.push({ type: 'text', value: text.slice(i) });
          break;
        }
        if (at > i) parts.push({ type: 'text', value: text.slice(i, at) });

        const rest = text.slice(at);
        const msgMatch = rest.match(/^@msg:([a-zA-Z0-9_-]+)/);
        if (msgMatch) {
          parts.push({ type: 'msg', id: msgMatch[1] });
          i = at + msgMatch[0].length;
          continue;
        }

        const fileMatch = rest.match(/^@([^\\s@]+?)(?::(\\d+)(?:-(\\d+))?)?(?=\\s|$|[!?])/);
        if (fileMatch && !fileMatch[1].startsWith('msg:')) {
          parts.push({
            type: 'file',
            path: fileMatch[1],
            startLine: fileMatch[2] ? parseInt(fileMatch[2], 10) : undefined,
            endLine: fileMatch[3] ? parseInt(fileMatch[3], 10) : undefined,
          });
          i = at + fileMatch[0].length;
          continue;
        }

        parts.push({ type: 'text', value: '@' });
        i = at + 1;
      }
      return parts;
    }

    function createMsgCitationChip(msgId) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cite-chip cite-chip-msg';
      const icon = document.createElement('span');
      icon.className = 'cite-chip-icon';
      icon.textContent = '💬';
      const label = document.createElement('span');
      label.className = 'cite-chip-label';
      const cited = state.messageById[msgId];
      const raw = cited ? cited.content.trim().replace(/\\s+/g, ' ') : '';
      label.textContent = raw
        ? (raw.length > 42 ? raw.slice(0, 42) + '…' : raw)
        : ('msg:' + msgId.slice(0, 8));
      btn.title = cited ? cited.content.slice(0, 400) : ('Ir para mensagem ' + msgId);
      btn.appendChild(icon);
      btn.appendChild(label);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        scrollToMessage(msgId);
      });
      return btn;
    }

    function createFileCitationChip(path, startLine, endLine) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cite-chip cite-chip-file';
      const icon = document.createElement('span');
      icon.className = 'cite-chip-icon';
      icon.textContent = '📄';
      const label = document.createElement('span');
      label.className = 'cite-chip-label';
      const fileName = path.split(/[/\\\\]/).pop() || path;
      let lineLabel = '';
      if (startLine) {
        lineLabel = endLine && endLine !== startLine ? (':' + startLine + '-' + endLine) : (':' + startLine);
      }
      label.textContent = fileName + lineLabel;
      btn.title = path + lineLabel;
      btn.appendChild(icon);
      btn.appendChild(label);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        vscode.postMessage({ type: 'open_citation', path, startLine, endLine });
      });
      return btn;
    }

    function appendCitationsToElement(container, text) {
      const normalized = String(text).replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n');
      const lines = normalized.split('\\n');
      lines.forEach((line, index) => {
        if (index > 0) container.appendChild(document.createElement('br'));
        parseCitationParts(line).forEach(part => {
          if (part.type === 'text') {
            if (part.value) container.appendChild(document.createTextNode(part.value));
          } else if (part.type === 'msg') {
            container.appendChild(createMsgCitationChip(part.id));
          } else if (part.type === 'file') {
            container.appendChild(createFileCitationChip(part.path, part.startLine, part.endLine));
          }
        });
      });
    }

    function renderPlainTextWithCitations(text) {
      const container = document.createElement('div');
      container.className = 'md-text';
      const paragraphs = text.split(/\\n{2,}/);
      if (paragraphs.length <= 1) {
        const p = document.createElement('p');
        appendCitationsToElement(p, text);
        container.appendChild(p);
      } else {
        paragraphs.forEach(para => {
          if (!para.trim()) return;
          const p = document.createElement('p');
          appendCitationsToElement(p, para);
          container.appendChild(p);
        });
      }
      return container;
    }

    function renderInlineText(text) {
      const container = document.createElement('div');
      container.className = 'md-text';
      const paragraphs = text.split(/\\n{2,}/);
      paragraphs.forEach(para => {
        if (!para.trim()) return;
        const p = document.createElement('p');
        let html = escapeHtml(para.trim());
        html = html.replace(/\`([^\`\\n]+)\`/g, '<code class="inline-code">$1</code>');
        html = html.replace(/\\*\\*([^*\\n]+)\\*\\*/g, '<strong>$1</strong>');
        html = html.replace(/\\n/g, '<br>');
        p.innerHTML = html;
        container.appendChild(p);
      });
      return container;
    }

    function createCodeBlock(lang, code) {
      const block = document.createElement('div');
      block.className = 'code-block';

      const header = document.createElement('div');
      header.className = 'code-header';

      const langSpan = document.createElement('span');
      langSpan.className = 'code-lang';
      langSpan.textContent = lang || 'texto';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-btn';
      copyBtn.type = 'button';
      copyBtn.textContent = 'Copiar';
      copyBtn.title = 'Copiar código';
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(code);
          copyBtn.textContent = 'Copiado!';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = 'Copiar';
            copyBtn.classList.remove('copied');
          }, 2000);
        } catch {
          copyBtn.textContent = 'Erro';
          setTimeout(() => { copyBtn.textContent = 'Copiar'; }, 2000);
        }
      });

      header.appendChild(langSpan);
      header.appendChild(copyBtn);

      const pre = document.createElement('pre');
      const codeEl = document.createElement('code');
      codeEl.textContent = code;
      pre.appendChild(codeEl);

      block.appendChild(header);
      block.appendChild(pre);
      return block;
    }

    function renderMessageContent(content) {
      const wrapper = document.createElement('div');
      wrapper.className = 'message-content';

      const regex = /\`\`\`([\\w-]*)\\r?\\n([\\s\\S]*?)\`\`\`/g;
      let lastIndex = 0;
      let match;
      let foundCode = false;

      while ((match = regex.exec(content)) !== null) {
        foundCode = true;
        if (match.index > lastIndex) {
          const textPart = content.slice(lastIndex, match.index);
          if (textPart.trim()) wrapper.appendChild(renderPlainTextWithCitations(textPart));
        }
        wrapper.appendChild(createCodeBlock(match[1], match[2].replace(/\\s+$/, '')));
        lastIndex = regex.lastIndex;
      }

      if (!foundCode) {
        wrapper.appendChild(renderPlainTextWithCitations(content));
      } else if (lastIndex < content.length) {
        const textPart = content.slice(lastIndex);
        if (textPart.trim()) wrapper.appendChild(renderPlainTextWithCitations(textPart));
      }

      return wrapper;
    }

    function insertAtCursor(text) {
      const ta = els.promptInput;
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + text.length;
    }

    function updateTokenDisplay(stats) {
      if (!stats) return;
      state.tokenStats = stats;
      const last = stats.last?.totalTokens ?? 0;
      const session = stats.sessionTotal?.totalTokens ?? 0;
      if (els.tokenBtn) els.tokenBtn.textContent = '⬡ ' + session.toLocaleString('pt-BR');
      if (els.tokenLast) els.tokenLast.textContent = last.toLocaleString('pt-BR');
      if (els.tokenSession) els.tokenSession.textContent = session.toLocaleString('pt-BR');
      if (els.tokenRequests) els.tokenRequests.textContent = String(stats.requestCount ?? 0);
    }

    function addMessage(content, className, msgMeta) {
      const div = document.createElement('div');
      div.className = 'message ' + className;
      if (msgMeta?.id) {
        div.dataset.msgId = msgMeta.id;
        state.messageById[msgMeta.id] = msgMeta;
      }

      if (className === 'assistant') {
        div.appendChild(renderMessageContent(content));
      } else if (className === 'user') {
        const body = document.createElement('div');
        body.className = 'user-message-body';
        appendCitationsToElement(body, content);
        div.appendChild(body);
      } else {
        div.textContent = content;
      }

      if ((className === 'user' || className === 'assistant') && msgMeta?.id) {
        const actions = document.createElement('div');
        actions.className = 'message-actions';
        const citeBtn = document.createElement('button');
        citeBtn.type = 'button';
        citeBtn.className = 'msg-action-btn';
        citeBtn.textContent = '↩ Citar';
        citeBtn.title = 'Inserir citação desta mensagem no prompt';
        citeBtn.addEventListener('click', () => {
          insertAtCursor('@msg:' + msgMeta.id + ' ');
        });
        actions.appendChild(citeBtn);
        div.appendChild(actions);
      }

      els.messages.appendChild(div);
      els.messages.scrollTop = els.messages.scrollHeight;
    }

    function formatDuration(ms) {
      if (!ms || ms < 0) return '0s';
      if (ms < 10000) {
        return (Math.round(ms / 100) / 10).toFixed(1) + 's';
      }
      const totalSec = Math.round(ms / 1000);
      if (totalSec < 60) return totalSec + 's';
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    }

    function clearTimingTick() {
      if (state.timing.timerId) {
        clearInterval(state.timing.timerId);
        state.timing.timerId = null;
      }
    }

    function startResponseTimer() {
      clearTimingTick();
      state.timing.startedAt = Date.now();
      state.timing.stopping = false;
      const tick = () => {
        if (!state.timing.startedAt || !els.processing) return;
        const elapsed = Date.now() - state.timing.startedAt;
        const label = state.timing.stopping ? 'Parando… ' : 'Trabalhando… ';
        els.processing.textContent = label + formatDuration(elapsed);
      };
      tick();
      state.timing.timerId = setInterval(tick, 200);
    }

    function finishResponseTimer(showInChat) {
      if (!state.timing.startedAt) {
        clearTimingTick();
        return;
      }
      const elapsed = Date.now() - state.timing.startedAt;
      clearTimingTick();
      state.timing.startedAt = 0;
      if (showInChat && elapsed > 0) {
        const div = document.createElement('div');
        div.className = 'message timing-meta';
        div.textContent = '⏱ ' + formatDuration(elapsed);
        div.title = 'Tempo até a resposta final';
        els.messages.appendChild(div);
        els.messages.scrollTop = els.messages.scrollHeight;
      }
    }

    function setProcessing(processing) {
      state.isProcessing = processing;
      els.sendBtn.disabled = processing;
      const wrapper = els.promptInput?.closest('.input-wrapper');
      if (wrapper) {
        wrapper.classList.toggle('working', processing);
      }
      els.promptInput?.classList.toggle('working', processing);
      if (processing) {
        startResponseTimer();
        if (els.processing) {
          els.processing.classList.add('visible');
        }
      } else {
        const hadTimer = !!state.timing.startedAt || !!state.timing.timerId;
        finishResponseTimer(hadTimer);
        if (els.processing) {
          els.processing.classList.remove('visible');
          els.processing.textContent = 'Pensando...';
        }
        sealActivityAccordion();
      }
    }


    els.sendBtn.addEventListener('click', send);
    els.stopBtn?.addEventListener('click', () => {
      vscode.postMessage({ type: 'stop' });
      state.timing.stopping = true;
      if (els.processing && state.timing.startedAt) {
        els.processing.textContent =
          'Parando… ' + formatDuration(Date.now() - state.timing.startedAt);
      }
    });
    els.promptInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    document.getElementById('indexBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'index' });
    });
    els.citeFileBtn.addEventListener('click', () => vscode.postMessage({ type: 'pick_file_citation' }));
    els.citeEditorBtn.addEventListener('click', () => vscode.postMessage({ type: 'insert_editor_citation' }));
    els.tokenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      els.tokenPopup.classList.toggle('visible');
      vscode.postMessage({ type: 'get_token_stats' });
    });
    document.addEventListener('click', () => els.tokenPopup?.classList.remove('visible'));
    els.tokenPopup?.addEventListener('click', (e) => e.stopPropagation());
    els.newChatBtn.addEventListener('click', () => vscode.postMessage({ type: 'new_chat' }));
    els.deleteChatBtn.addEventListener('click', () => {
      const sessionId = els.sessionSelect?.value || state.activeSessionId;
      if (sessionId) {
        vscode.postMessage({ type: 'delete_chat', sessionId });
      }
    });
    els.sessionSelect.addEventListener('change', () => {
      if (els.sessionSelect.value && els.sessionSelect.value !== state.activeSessionId) {
        vscode.postMessage({ type: 'switch_chat', sessionId: els.sessionSelect.value });
      }
    });
    els.modelSelect.addEventListener('change', () => {
      const model = els.modelSelect.value;
      if (model) {
        state.chatUi.userLocked = true;
        state.chatUi.model = model;
        state.settings.model = model;
        vscode.postMessage({ type: 'save_settings', settings: { model }, silent: true });
      }
    });
    document.getElementById('refreshBtn').addEventListener('click', () => {
      els.modelSelect.innerHTML = '<option value="">Carregando...</option>';
      els.status.textContent = 'Conectando ao Ollama...';
      vscode.postMessage({ type: 'refresh_models' });
    });

    els.form.addEventListener('submit', e => {
      e.preventDefault();
      vscode.postMessage({ type: 'save_settings', settings: readSettingsForm() });
    });
    document.getElementById('testBtn').addEventListener('click', () => {
      els.testResult.style.display = 'none';
      vscode.postMessage({ type: 'test_connection', settings: readSettingsForm() });
    });

    els.operationModeSelect.addEventListener('change', () => {
      const mode = els.operationModeSelect.value;
      state.chatUi.userLocked = true;
      state.chatUi.operationMode = mode;
      state.settings.operationMode = mode;
      updatePlaceholder(mode);
      vscode.postMessage({ type: 'save_settings', settings: { operationMode: mode }, silent: true });
    });

    function send() {
      const text = els.promptInput.value.trim();
      if (!text || state.isProcessing) return;
      setProcessing(true);
      vscode.postMessage({
        type: 'send',
        text,
        model: els.modelSelect.value,
        operationMode: els.operationModeSelect.value,
      });
      els.promptInput.value = '';
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'init':
          if (msg.settings) state.settings = msg.settings;
          updateModelSelects(msg);
          if (msg.sessions) updateSessionBar({ id: msg.activeSessionId }, msg.sessions);
          break;
        case 'load_session':
          renderAllMessages(msg.uiMessages);
          updateSessionBar(msg.session, msg.sessions);
          clearTimingTick();
          state.timing.startedAt = 0;
          state.isProcessing = false;
          els.sendBtn.disabled = false;
          els.promptInput?.closest('.input-wrapper')?.classList.remove('working');
          els.promptInput?.classList.remove('working');
          if (els.processing) {
            els.processing.classList.remove('visible');
            els.processing.textContent = 'Pensando...';
          }
          break;
        case 'memory_status':
          if (msg.content) {
            addMessage(msg.content, 'system');
            if (els.status) {
              els.status.textContent = String(msg.content).replace(/^💾\\s*/, '');
            }
          }
          break;
        case 'sessions_updated':
          updateSessionBar({ id: msg.activeSessionId || state.activeSessionId }, msg.sessions);
          break;
        case 'ui_message':
          renderUiMessage(msg.message);
          break;
        case 'update_file_change':
          updateFileChangeCard(msg.data);
          break;
        case 'settings':
          fillSettingsForm(msg.settings);
          updateModelSelects({
            ...msg,
            models: msg.models || [],
            ollamaAvailable: true,
            hasWorkspace: true,
            operationMode: msg.settings?.operationMode,
          });
          break;
        case 'settings_saved':
          state.settings = msg.settings;
          state.chatUi.model = msg.settings.model;
          state.chatUi.operationMode = msg.settings.operationMode;
          fillSettingsForm(msg.settings);
          if (!msg.silent) {
            els.testResult.style.display = 'block';
            els.testResult.className = 'test-result ok';
            els.testResult.textContent = '✓ Configurações salvas';
          }
          updateModelSelects({
            ...msg,
            models: msg.models || [],
            currentModel: msg.settings.model,
            modelOptions: msg.modelOptions,
            mode: msg.settings.permissionMode,
            ollamaAvailable: msg.ollamaAvailable,
            hasWorkspace: msg.hasWorkspace,
            operationMode: msg.settings.operationMode,
          }, { force: true });
          break;
        case 'test_result':
          els.testResult.style.display = 'block';
          els.testResult.className = 'test-result ' + (msg.ok ? 'ok' : 'fail');
          els.testResult.textContent = (msg.ok ? '✓ ' : '✗ ') + msg.message;
          if (msg.models && msg.models.length) {
            updateModelSelects({
              models: msg.models,
              modelOptions: msg.modelOptions,
              currentModel: state.settings.model,
              ollamaAvailable: true,
              hasWorkspace: true,
              mode: state.settings.permissionMode,
              operationMode: state.settings.operationMode,
            });
          }
          break;
        case 'insert_citation':
          if (msg.text) insertAtCursor(msg.text);
          break;
        case 'mode_updated':
          if (msg.operationMode && els.operationModeSelect) {
            els.operationModeSelect.value = msg.operationMode;
            state.settings.operationMode = msg.operationMode;
            state.chatUi.operationMode = msg.operationMode;
            updatePlaceholder(msg.operationMode);
          }
          if (msg.settings) fillSettingsForm(msg.settings);
          break;
        case 'token_stats':
          updateTokenDisplay(msg.stats);
          break;
        case 'agent_event': {
          const ev = msg.event;
          if (ev.type === 'stream_delta') {
            appendStreamDelta(ev.content || '');
          }
          if (ev.type === 'done' || ev.type === 'error' || ev.type === 'cancelled') {
            sealActivityAccordion();
            if (ev.type !== 'done' || !state.streaming.el) {
              // keep streaming el until assistant message arrives; seal on done without stream
            }
            if (ev.type === 'done' && state.streaming.el && state.streaming.content) {
              finalizeStreamingAsAssistant(state.streaming.content, { id: 'stream_' + Date.now() });
            }
            setProcessing(false);
          }
          if (msg.settings) state.settings = msg.settings;
          break;
        }
        case 'error':
          addMessage(msg.content, 'error');
          setProcessing(false);
          break;
      }
    });
  </script>
</body>
</html>`;
}
