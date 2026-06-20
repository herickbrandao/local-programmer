export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface SessionTokenStats {
  last: TokenUsage;
  sessionTotal: TokenUsage;
  requestCount: number;
}

export class TokenTracker {
  private sessionTotal: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  private last: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  private requestCount = 0;

  record(usage: TokenUsage): SessionTokenStats {
    this.last = usage;
    this.sessionTotal = {
      promptTokens: this.sessionTotal.promptTokens + usage.promptTokens,
      completionTokens: this.sessionTotal.completionTokens + usage.completionTokens,
      totalTokens: this.sessionTotal.totalTokens + usage.totalTokens,
    };
    this.requestCount += 1;
    return this.getStats();
  }

  estimateFromText(messages: Array<{ content: string }>): TokenUsage {
    const chars = messages.reduce((sum, m) => sum + m.content.length, 0);
    const estimated = Math.ceil(chars / 3.5);
    return {
      promptTokens: estimated,
      completionTokens: 0,
      totalTokens: estimated,
    };
  }

  getStats(): SessionTokenStats {
    return {
      last: { ...this.last },
      sessionTotal: { ...this.sessionTotal },
      requestCount: this.requestCount,
    };
  }

  reset(): void {
    this.sessionTotal = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    this.last = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    this.requestCount = 0;
  }
}
