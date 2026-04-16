import type { LlmConfig } from '../types';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

export class LlmClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: LlmConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.model = config.model;
  }

  async chatCompletion(
    messages: ChatMessage[],
    options?: { temperature?: number },
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
      }),
    });

    if (!response.ok) {
      let details = '';
      try {
        const payload = (await response.json()) as ChatCompletionResponse;
        details = payload.error?.message ?? JSON.stringify(payload);
      } catch {
        details = await response.text();
      }
      throw new Error(
        `LLM chat completion failed (${response.status} ${response.statusText}): ${details}`,
      );
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;

    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('LLM chat completion response missing choices[0].message.content');
    }

    return content;
  }
}

export function isLlmConfigured(config: LlmConfig | undefined): config is LlmConfig {
  return Boolean(config && config.apiKey.trim() && config.baseUrl.trim() && config.model.trim());
}
