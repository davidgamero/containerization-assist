/**
 * OpenAI-Compatible LLM Client
 *
 * Generic client for chat completions with tool calling support.
 * Works with Azure OpenAI, OpenAI, vLLM, Ollama, and any
 * OpenAI-compatible API endpoint.
 */

import type { Logger } from 'pino';
import type {
  LLMMessage,
  LLMChatResponse,
  OpenAIToolDefinition,
  AgentConfig,
} from './types.js';

export interface ChatCompletionOptions {
  messages: LLMMessage[];
  tools?: OpenAIToolDefinition[] | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  signal?: AbortSignal | null | undefined;
}

export interface LLMClient {
  chat(options: ChatCompletionOptions): Promise<LLMChatResponse>;
  validateConnection(): Promise<boolean>;
}

/**
 * Build the API URL for chat completions.
 * Handles both Azure OpenAI and standard OpenAI URL formats.
 */
function buildChatUrl(config: AgentConfig): string {
  const base = config.baseUrl.replace(/\/$/, '');

  // Azure OpenAI format: {base}/deployments/{model}/chat/completions?api-version={version}
  if (config.apiVersion) {
    return `${base}/deployments/${config.model}/chat/completions?api-version=${config.apiVersion}`;
  }

  // Standard OpenAI format: {base}/chat/completions
  // Handle case where base already includes /v1
  if (base.endsWith('/v1')) {
    return `${base}/chat/completions`;
  }
  return `${base}/v1/chat/completions`;
}

/**
 * Build request headers for the API call.
 */
function buildHeaders(config: AgentConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.apiVersion) {
    // Azure OpenAI uses api-key header
    headers['api-key'] = config.apiKey;
  } else {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  return headers;
}

export function createLLMClient(config: AgentConfig, logger: Logger): LLMClient {
  const chatUrl = buildChatUrl(config);

  return {
    async chat(options: ChatCompletionOptions): Promise<LLMChatResponse> {
      const body: Record<string, unknown> = {
        messages: options.messages,
        temperature: options.temperature ?? config.temperature,
      };

      // Only include model for non-Azure endpoints (Azure uses deployment name in URL)
      if (!config.apiVersion) {
        body.model = config.model;
      }

      if (options.tools && options.tools.length > 0) {
        body.tools = options.tools;
        body.tool_choice = 'auto';
      }

      if (options.maxTokens) {
        body.max_tokens = options.maxTokens;
      }

      logger.debug({ url: chatUrl, model: config.model }, 'Sending chat completion request');

      const response = await fetch(chatUrl, {
        method: 'POST',
        headers: buildHeaders(config),
        body: JSON.stringify(body),
        ...(options.signal ? { signal: options.signal } : {}),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'unknown error');
        throw new Error(
          `LLM API error ${response.status}: ${errorBody}`,
        );
      }

      const result = (await response.json()) as LLMChatResponse;

      logger.debug(
        {
          finishReason: result.choices?.[0]?.finish_reason,
          toolCalls: result.choices?.[0]?.message?.tool_calls?.length ?? 0,
          usage: result.usage,
        },
        'Chat completion response received',
      );

      return result;
    },

    async validateConnection(): Promise<boolean> {
      try {
        const response = await this.chat({
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 5,
        });
        return !!response.choices?.[0];
      } catch (error) {
        logger.warn({ error }, 'LLM connection validation failed');
        return false;
      }
    },
  };
}
