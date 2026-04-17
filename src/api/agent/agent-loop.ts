/**
 * Agent Loop
 *
 * Iterative LLM → tool → LLM loop that autonomously runs
 * the containerization pipeline using OpenAI-compatible tool calling.
 *
 * Key features:
 * - Scans for existing artifacts (Dockerfiles, manifests, Helm charts) before starting
 * - Tracks pipeline context across stages (analysis → build → deploy)
 * - Validates outputs after each stage and feeds violations to LLM
 * - Stores structured tool results for typed API access
 */

import type { Logger } from 'pino';
import type { AppRuntime } from '@/types/runtime.js';
import { type ToolName, ALL_TOOLS } from '@/tools';
import type { LLMClient } from './llm-client.js';
import type { LLMMessage, AgentStep, AgentRunResult, OpenAIToolDefinition } from './types.js';
import { buildToolDefinitions, getSystemPrompt, buildJobPrompt } from './prompts.js';
import {
  type PipelineContext,
  type StageValidation,
  createPipelineContext,
  updatePipelineContext,
  summarizePipelineContext,
} from './pipeline-context.js';
import { scanArtifacts, formatArtifactSummary } from './artifact-scanner.js';

export interface AgentLoopInput {
  repositoryPath: string;
  registry: string;
  namespace: string;
  imageName?: string | undefined;
  clusterName?: string | undefined;
  resourceGroup?: string | undefined;
}

export interface AgentLoopOptions {
  maxIterations: number;
  signal?: AbortSignal | undefined;
  onStep?: ((step: AgentStep) => void) | undefined;
  onMessage?: ((message: LLMMessage) => void) | undefined;
  onPipelineUpdate?: ((ctx: PipelineContext) => void) | undefined;
}

// Tool names that the agent is allowed to call
const ALLOWED_TOOLS = new Set([
  'analyze-repo',
  'generate-dockerfile',
  'fix-dockerfile',
  'build-image-context',
  'scan-image',
  'tag-image',
  'push-image',
  'generate-k8s-manifests',
  'prepare-cluster',
  'verify-deploy',
]);

// Tools whose outputs should be validated for completeness
const VALIDATION_RULES: Record<string, (result: Record<string, unknown>) => StageValidation> = {
  'analyze-repo': (result) => {
    const violations: string[] = [];
    const warnings: string[] = [];
    const modules = result.modules as unknown[] | undefined;

    if (!modules || modules.length === 0) {
      violations.push('No modules detected in repository');
    }

    return {
      stage: 'analyze-repo',
      passed: violations.length === 0,
      violations,
      warnings,
      timestamp: new Date().toISOString(),
    };
  },

  'generate-dockerfile': (result) => {
    const violations: string[] = [];
    const warnings: string[] = [];
    const confidence = result.confidence as number | undefined;
    const recs = result.recommendations as Record<string, unknown> | undefined;

    if (confidence !== undefined && confidence < 0.5) {
      warnings.push(`Low confidence score: ${confidence}`);
    }

    const secItems = recs?.securityConsiderations as unknown[] | undefined;
    const highSev = (secItems ?? []).filter(
      (s) => (s as Record<string, unknown>).severity === 'high',
    );
    if (highSev.length > 0) {
      warnings.push(`${highSev.length} high-severity security consideration(s)`);
    }

    const policyValidation = result.policyValidation as
      | { passed?: boolean; violations?: Array<{ message: string }> }
      | undefined;
    if (policyValidation && !policyValidation.passed) {
      const policyViolations = policyValidation.violations ?? [];
      for (const v of policyViolations) {
        violations.push(`Policy: ${v.message}`);
      }
    }

    return {
      stage: 'generate-dockerfile',
      passed: violations.length === 0,
      violations,
      warnings,
      timestamp: new Date().toISOString(),
    };
  },

  'build-image-context': (result) => {
    const violations: string[] = [];
    const warnings: string[] = [];
    const security = result.securityAnalysis as
      | { riskLevel?: string; warnings?: unknown[] }
      | undefined;

    if (security?.riskLevel === 'high') {
      warnings.push('High security risk detected in build context');
    }

    const secWarnings = security?.warnings as Array<Record<string, unknown>> | undefined;
    const criticalWarnings = (secWarnings ?? []).filter(
      (w) => w.severity === 'critical' || w.severity === 'high',
    );
    if (criticalWarnings.length > 0) {
      for (const w of criticalWarnings) {
        warnings.push(`Build security: ${w.message}`);
      }
    }

    return {
      stage: 'build-image-context',
      passed: violations.length === 0,
      violations,
      warnings,
      timestamp: new Date().toISOString(),
    };
  },

  'scan-image': (result) => {
    const violations: string[] = [];
    const warnings: string[] = [];
    const vulns = result.vulnerabilities as
      | { critical?: number; high?: number }
      | undefined;

    if (vulns) {
      if ((vulns.critical ?? 0) > 0) {
        violations.push(`${vulns.critical} critical vulnerabilities found`);
      }
      if ((vulns.high ?? 0) > 0) {
        warnings.push(`${vulns.high} high-severity vulnerabilities found`);
      }
    }

    return {
      stage: 'scan-image',
      passed: violations.length === 0,
      violations,
      warnings,
      timestamp: new Date().toISOString(),
    };
  },

  'generate-k8s-manifests': (result) => {
    const violations: string[] = [];
    const warnings: string[] = [];

    const policyValidation = result.policyValidation as
      | { passed?: boolean; violations?: Array<{ message: string }> }
      | undefined;
    if (policyValidation && !policyValidation.passed) {
      const policyViolations = policyValidation.violations ?? [];
      for (const v of policyViolations) {
        violations.push(`Policy: ${v.message}`);
      }
    }

    return {
      stage: 'generate-k8s-manifests',
      passed: violations.length === 0,
      violations,
      warnings,
      timestamp: new Date().toISOString(),
    };
  },

  'verify-deploy': (result) => {
    const violations: string[] = [];
    const warnings: string[] = [];
    const ready = result.ready as boolean | undefined;
    const success = result.success as boolean | undefined;

    if (!success) {
      violations.push('Deployment verification failed');
    } else if (!ready) {
      warnings.push('Deployment not yet ready');
    }

    return {
      stage: 'verify-deploy',
      passed: violations.length === 0,
      violations,
      warnings,
      timestamp: new Date().toISOString(),
    };
  },
};

/**
 * Run the agent loop: LLM decides which tools to call,
 * we execute them and feed results back until completion.
 *
 * Before starting:
 * 1. Scans repo for existing artifacts (Dockerfiles, manifests, Helm charts)
 * 2. Includes artifact inventory in the user prompt
 *
 * After each tool call:
 * 1. Updates pipeline context with structured outputs
 * 2. Runs stage validation (policy checks, completeness)
 * 3. Injects pipeline state summary into conversation if state changed
 */
export async function runAgentLoop(
  app: AppRuntime,
  llmClient: LLMClient,
  input: AgentLoopInput,
  options: AgentLoopOptions,
  logger: Logger,
): Promise<AgentRunResult> {
  const toolDefs: OpenAIToolDefinition[] = buildToolDefinitions(ALL_TOOLS);

  // --- Phase 0: Scan for existing artifacts ---
  logger.info({ repositoryPath: input.repositoryPath }, 'Scanning for existing artifacts');
  const artifacts = await scanArtifacts(input.repositoryPath);
  const artifactSummary = formatArtifactSummary(artifacts);
  const pipelineCtx = createPipelineContext(artifacts);

  logger.info(
    {
      dockerfiles: artifacts.dockerfiles.length,
      k8sManifests: artifacts.k8sManifests.length,
      helmCharts: artifacts.helmCharts.length,
      dockerCompose: artifacts.dockerCompose.length,
      kustomize: artifacts.kustomize.length,
    },
    'Artifact scan complete',
  );

  // Build initial messages with artifact context
  const userPrompt = buildJobPrompt(input);
  const artifactContext =
    artifacts.dockerfiles.length > 0 ||
    artifacts.k8sManifests.length > 0 ||
    artifacts.helmCharts.length > 0
      ? `\n\n## Existing Artifacts Found\n${artifactSummary}\n\n` +
        'Consider these existing artifacts when deciding whether to generate new files or enhance existing ones.'
      : '';

  const messages: LLMMessage[] = [
    { role: 'system', content: getSystemPrompt() },
    { role: 'user', content: userPrompt + artifactContext },
  ];

  const steps: AgentStep[] = [];
  let totalTokens = 0;
  let iteration = 0;

  logger.info({ input, maxIterations: options.maxIterations }, 'Starting agent loop');

  while (iteration < options.maxIterations) {
    if (options.signal?.aborted) {
      return {
        success: false,
        steps,
        messages,
        summary: 'Agent loop cancelled',
        totalTokens,
        pipelineContext: pipelineCtx,
        error: 'Cancelled by user',
      };
    }

    iteration++;
    logger.debug({ iteration }, 'Agent loop iteration');

    // Call LLM
    const response = await llmClient.chat({
      messages,
      tools: toolDefs,
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (response.usage) {
      totalTokens += response.usage.total_tokens;
    }

    const choice = response.choices[0];
    if (!choice) {
      return {
        success: false,
        steps,
        messages,
        summary: 'No response from LLM',
        totalTokens,
        pipelineContext: pipelineCtx,
        error: 'Empty LLM response',
      };
    }

    const assistantMessage = choice.message;
    messages.push(assistantMessage);
    options.onMessage?.(assistantMessage);

    // If the LLM is done (no tool calls), return the final message
    if (choice.finish_reason === 'stop' || !assistantMessage.tool_calls?.length) {
      logger.info({ iterations: iteration, steps: steps.length }, 'Agent loop completed');
      return {
        success: true,
        steps,
        messages,
        summary: assistantMessage.content || 'Pipeline completed',
        totalTokens,
        pipelineContext: pipelineCtx,
      };
    }

    // Process tool calls
    const toolCalls = assistantMessage.tool_calls ?? [];
    let pipelineStateChanged = false;

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;

      if (!ALLOWED_TOOLS.has(toolName)) {
        const errorMsg = `Unknown tool: ${toolName}`;
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: errorMsg }),
        });
        continue;
      }

      let toolInput: Record<string, unknown>;
      try {
        toolInput = JSON.parse(toolCall.function.arguments);
      } catch {
        const errorMsg = `Invalid JSON arguments for ${toolName}`;
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: errorMsg }),
        });
        continue;
      }

      logger.info({ toolName, toolInput }, 'Executing tool');
      const startTime = Date.now();

      try {
        const result = await app.execute(toolName as ToolName, toolInput as never, {
          ...(options.signal ? { signal: options.signal } : {}),
        });

        const durationMs = Date.now() - startTime;
        const step: AgentStep = {
          index: steps.length,
          toolName,
          toolInput,
          toolResult: result.ok ? result.value : result.error,
          timestamp: new Date(),
          durationMs,
          success: result.ok,
          ...(result.ok ? {} : { error: result.error }),
        };

        steps.push(step);
        options.onStep?.(step);

        // --- Update pipeline context with structured outputs ---
        if (result.ok) {
          updatePipelineContext(pipelineCtx, toolName, result.value, step.index);
          pipelineStateChanged = true;

          // --- Run inter-stage validation ---
          const validator = VALIDATION_RULES[toolName];
          if (validator && typeof result.value === 'object' && result.value !== null) {
            const validation = validator(result.value as Record<string, unknown>);
            pipelineCtx.validations.push(validation);

            // Attach validation to the most recent artifact revision from this tool
            const revisions = pipelineCtx.artifactRevisions;
            const lastRevision = revisions.filter(
              (rev) => rev.producedBy === toolName,
            ).pop();
            if (lastRevision) {
              lastRevision.validation = validation;
            }

            if (!validation.passed) {
              logger.warn(
                { toolName, violations: validation.violations },
                'Stage validation found issues',
              );
            }
          }

          options.onPipelineUpdate?.(pipelineCtx);
        }

        // Truncate large results to avoid token overflow
        const resultContent = JSON.stringify(result.ok ? result.value : { error: result.error });
        const truncated =
          resultContent.length > 8000
            ? `${resultContent.substring(0, 8000)}... (truncated)`
            : resultContent;

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: truncated,
        });

        logger.info(
          { toolName, success: result.ok, durationMs },
          'Tool execution completed',
        );
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const errorMsg = error instanceof Error ? error.message : String(error);

        const step: AgentStep = {
          index: steps.length,
          toolName,
          toolInput,
          toolResult: null,
          timestamp: new Date(),
          durationMs,
          success: false,
          error: errorMsg,
        };

        steps.push(step);
        options.onStep?.(step);

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: errorMsg }),
        });

        logger.error({ toolName, error: errorMsg, durationMs }, 'Tool execution failed');
      }
    }

    // --- Inject pipeline state summary after tool calls ---
    if (pipelineStateChanged) {
      const stateSummary = summarizePipelineContext(pipelineCtx);
      // Inject as a system-like context note so the LLM knows cumulative state
      messages.push({
        role: 'user',
        content: `[Pipeline State Update]\n${stateSummary}`,
      });
    }
  }

  // Max iterations reached
  logger.warn({ maxIterations: options.maxIterations }, 'Agent loop reached max iterations');
  return {
    success: false,
    steps,
    messages,
    summary: `Agent loop reached maximum iterations (${options.maxIterations})`,
    totalTokens,
    pipelineContext: pipelineCtx,
    error: 'Max iterations exceeded',
  };
}
