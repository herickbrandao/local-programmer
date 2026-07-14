import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { ChatMessage } from '../ai/types';

export interface UiMessage {
  id?: string;
  kind: 'user' | 'assistant' | 'system' | 'tool' | 'thinking' | 'error' | 'file_change';
  content: string;
  data?: Record<string, unknown>;
}

export function createUiMessageId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  uiMessages: UiMessage[];
  agentMessages: ChatMessage[];
}

export interface ChatSessionMeta {
  id: string;
  title: string;
  updatedAt: string;
}

export class ChatSessionManager {
  private chatsDir = '';
  private indexPath = '';

  constructor(
    private context: vscode.ExtensionContext,
    private workspaceRoot?: string
  ) {
    this.initPaths();
  }

  updateWorkspace(workspaceRoot?: string): void {
    this.workspaceRoot = workspaceRoot;
    this.initPaths();
  }

  private initPaths(): void {
    const base = this.workspaceRoot
      ? path.join(this.workspaceRoot, '.ai-settings', 'chats')
      : path.join(this.context.globalStorageUri.fsPath, 'chats');
    this.chatsDir = base;
    this.indexPath = path.join(base, 'index.json');
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.chatsDir, { recursive: true });
  }

  async getActiveSessionId(): Promise<string> {
    const key = this.storageKey('activeSessionId');
    return this.context.globalState.get<string>(key) ?? '';
  }

  async setActiveSessionId(id: string): Promise<void> {
    await this.context.globalState.update(this.storageKey('activeSessionId'), id);
  }

  private storageKey(suffix: string): string {
    const ws = this.workspaceRoot ?? 'global';
    return `chat.${ws}.${suffix}`;
  }

  async listSessions(): Promise<ChatSessionMeta[]> {
    await this.ensureDir();
    try {
      const content = await fs.readFile(this.indexPath, 'utf-8');
      const index = JSON.parse(content) as ChatSessionMeta[];
      if (index.length > 0) {
        return index.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      }
    } catch {
      // reconstrói a partir dos arquivos
    }

    return this.rebuildIndexFromFiles();
  }

  private async rebuildIndexFromFiles(): Promise<ChatSessionMeta[]> {
    const entries = await fs.readdir(this.chatsDir);
    const sessions: ChatSessionMeta[] = [];

    for (const file of entries) {
      if (!file.endsWith('.json') || file === 'index.json') {
        continue;
      }
      try {
        const content = await fs.readFile(path.join(this.chatsDir, file), 'utf-8');
        const session = JSON.parse(content) as ChatSession;
        sessions.push({
          id: session.id,
          title: session.title,
          updatedAt: session.updatedAt,
        });
      } catch {
        // ignora arquivos inválidos
      }
    }

    if (sessions.length > 0) {
      await this.saveIndex(sessions);
    }

    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private async saveIndex(meta: ChatSessionMeta[]): Promise<void> {
    await fs.writeFile(this.indexPath, JSON.stringify(meta, null, 2), 'utf-8');
  }

  async getSession(id: string): Promise<ChatSession | null> {
    await this.ensureDir();
    try {
      const content = await fs.readFile(path.join(this.chatsDir, `${id}.json`), 'utf-8');
      return JSON.parse(content) as ChatSession;
    } catch {
      return null;
    }
  }

  async saveSession(session: ChatSession): Promise<void> {
    await this.ensureDir();
    session.updatedAt = new Date().toISOString();
    await fs.writeFile(
      path.join(this.chatsDir, `${session.id}.json`),
      JSON.stringify(session, null, 2),
      'utf-8'
    );

    const index = await this.listSessions();
    const meta: ChatSessionMeta = {
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
    };
    const filtered = index.filter((s) => s.id !== session.id);
    filtered.unshift(meta);
    await this.saveIndex(filtered);
  }

  async createSession(title = 'Novo chat'): Promise<ChatSession> {
    const session: ChatSession = {
      id: `chat_${Date.now()}`,
      title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      uiMessages: [{
        kind: 'system',
        content: 'Agente de programação local com Ollama. 100% privado.',
      }],
      agentMessages: [],
    };
    await this.saveSession(session);
    await this.setActiveSessionId(session.id);
    return session;
  }

  async getOrCreateActiveSession(): Promise<ChatSession> {
    const activeId = await this.getActiveSessionId();
    if (activeId) {
      const existing = await this.getSession(activeId);
      if (existing) {
        return existing;
      }
    }

    const sessions = await this.listSessions();
    if (sessions.length > 0) {
      const session = await this.getSession(sessions[0].id);
      if (session) {
        await this.setActiveSessionId(session.id);
        return session;
      }
    }

    return this.createSession();
  }

  async deleteSession(id: string): Promise<boolean> {
    if (!id) {
      return false;
    }

    await this.ensureDir();

    try {
      await fs.unlink(path.join(this.chatsDir, `${id}.json`));
    } catch {
      return false;
    }

    const index = await this.listSessions();
    await this.saveIndex(index.filter((s) => s.id !== id));

    const activeId = await this.getActiveSessionId();
    if (activeId === id) {
      const remaining = await this.listSessions();
      if (remaining.length > 0) {
        await this.setActiveSessionId(remaining[0].id);
      } else {
        await this.context.globalState.update(this.storageKey('activeSessionId'), undefined);
      }
    }

    return true;
  }

  deriveTitle(firstUserMessage: string): string {
    const trimmed = firstUserMessage.trim();
    if (trimmed.length <= 40) {
      return trimmed || 'Novo chat';
    }
    return trimmed.substring(0, 40) + '…';
  }
}
