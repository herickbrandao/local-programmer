import { AIProvider, ChatMessage, ChatOptions, ChatResponse } from './types';

export abstract class BaseAIProvider implements AIProvider {
  abstract readonly name: string;
  abstract isAvailable(): Promise<boolean>;
  abstract listModels(): Promise<string[]>;
  abstract chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
}

export class ProviderRegistry {
  private providers = new Map<string, AIProvider>();
  private activeProvider: string = 'ollama';

  register(provider: AIProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): AIProvider | undefined {
    return this.providers.get(name);
  }

  getActive(): AIProvider {
    const provider = this.providers.get(this.activeProvider);
    if (!provider) {
      throw new Error(`Provider "${this.activeProvider}" not registered`);
    }
    return provider;
  }

  setActive(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`Provider "${name}" not found`);
    }
    this.activeProvider = name;
  }

  list(): AIProvider[] {
    return Array.from(this.providers.values());
  }
}

// Placeholder for future providers
export class FutureOpenAIProvider extends BaseAIProvider {
  readonly name = 'openai';

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async listModels(): Promise<string[]> {
    return [];
  }

  async chat(): Promise<ChatResponse> {
    throw new Error('OpenAI provider not yet implemented');
  }
}

export class FutureClaudeProvider extends BaseAIProvider {
  readonly name = 'claude';

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async listModels(): Promise<string[]> {
    return [];
  }

  async chat(): Promise<ChatResponse> {
    throw new Error('Claude provider not yet implemented');
  }
}
