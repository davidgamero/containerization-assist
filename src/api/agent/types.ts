/**
 * Agent Types
 *
 * Type definitions for the AI agent loop that orchestrates
 * containerization tools via OpenAI-compatible LLM providers.
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: LLMToolCall[];
  tool_call_id?: string;
}

export interface LLMToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMChatResponse {
  id: string;
  choices: Array<{
    index: number;
    message: LLMMessage;
    finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AgentConfig {
  /** OpenAI-compatible API base URL */
  baseUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Model name (e.g., gpt-4o) */
  model: string;
  /** API version for Azure OpenAI */
  apiVersion?: string | undefined;
  /** Maximum agent loop iterations */
  maxIterations: number;
  /** Temperature for LLM responses */
  temperature: number;
}

export interface AgentStep {
  index: number;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResult: unknown;
  timestamp: Date;
  durationMs: number;
  success: boolean;
  error?: string | undefined;
}

import type { PipelineContext } from './pipeline-context.js';

export interface AgentRunResult {
  success: boolean;
  steps: AgentStep[];
  messages: LLMMessage[];
  summary: string;
  totalTokens: number;
  pipelineContext?: PipelineContext | undefined;
  error?: string | undefined;
}

export const DEFAULT_AGENT_CONFIG: Omit<AgentConfig, 'baseUrl' | 'apiKey'> = {
  model: 'gpt-4o',
  maxIterations: 30,
  temperature: 0.1,
};
