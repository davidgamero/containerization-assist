import yaml from 'js-yaml';
import type { AppRuntime } from '@/types/runtime';
import type { ArtifactTag, SessionArtifact, SessionPolicies } from '../types';
import { LlmClient } from './client';

type LlmPhase = 'generating_dockerfile' | 'generating_manifests';

function collectArtifacts(artifacts: SessionArtifact[], tag?: ArtifactTag | undefined): string {
  const filtered = tag ? artifacts.filter((a) => a.tag === tag) : artifacts;
  if (filtered.length === 0) return 'None';

  return filtered
    .map((artifact) => {
      const content =
        artifact.content.length > 4000
          ? `${artifact.content.slice(0, 4000)}\n...(truncated)`
          : artifact.content;
      return `Artifact: ${artifact.name}\nTag: ${artifact.tag ?? 'none'}\nContent-Type: ${artifact.contentType}\nContent:\n${content}`;
    })
    .join('\n\n---\n\n');
}

function policyDirectives(policies: SessionPolicies): string {
  if (policies.policySkills.length === 0) return 'No additional policy directives.';
  return policies.policySkills.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n');
}

function extractDockerValidationGrade(validationResult: unknown): string | undefined {
  if (typeof validationResult !== 'object' || validationResult === null) return undefined;
  const rec = validationResult as Record<string, unknown>;
  if (!('ok' in rec) || rec.ok !== true) return undefined;
  const value = rec.value;
  if (typeof value !== 'object' || value === null) return undefined;
  const grade = (value as Record<string, unknown>).validationGrade;
  return typeof grade === 'string' ? grade : undefined;
}

function extractDockerValidationIssues(validationResult: unknown): string {
  if (typeof validationResult !== 'object' || validationResult === null)
    return 'No structured issues available.';
  const rec = validationResult as Record<string, unknown>;
  const value = rec.value;
  if (typeof value !== 'object' || value === null) return 'No structured issues available.';
  return JSON.stringify(value, null, 2);
}

export async function runLlmPhase(params: {
  phase: LlmPhase;
  llmClient: LlmClient;
  toolOutput: unknown;
  priorArtifacts: SessionArtifact[];
  policies: SessionPolicies;
  runtime: AppRuntime;
  sessionId: string;
  workspacePath: string;
  log: (msg: string) => void;
}): Promise<{ content: string; validationResult?: unknown }> {
  const {
    phase,
    llmClient,
    toolOutput,
    priorArtifacts,
    policies,
    runtime,
    sessionId,
    workspacePath,
    log,
  } = params;

  const metadata = {
    transport: 'http',
    requestId: sessionId,
    sendNotification: async (notification: unknown) => {
      const n = notification as { params?: { data?: string; message?: string } };
      if (n.params?.message) log(n.params.message);
      else if (n.params?.data) log(n.params.data);
    },
  };

  if (phase === 'generating_dockerfile') {
    const systemPrompt =
      'You are a Docker expert. Generate a production-ready Dockerfile based on the analysis and plan below. Output ONLY the Dockerfile content, no markdown fences.';

    const contextArtifacts = collectArtifacts(priorArtifacts, 'context');

    const userBasePrompt = [
      'Repository analysis and Dockerfile planning data:',
      JSON.stringify(toolOutput, null, 2),
      '',
      'Prior context artifacts:',
      contextArtifacts,
      '',
      'Policy directives:',
      policyDirectives(policies),
    ].join('\n');

    let content = await llmClient.chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userBasePrompt },
    ]);

    let validationResult = await runtime.execute(
      'fix-dockerfile' as never,
      {
        dockerfileContent: content,
        repositoryPath: workspacePath,
        dockerfile: content,
        path: workspacePath,
      } as never,
      metadata,
    );

    const maxRetries = 2;
    let retry = 0;
    while (retry < maxRetries) {
      const grade = extractDockerValidationGrade(validationResult);
      if (grade !== 'D' && grade !== 'F') break;

      retry += 1;
      log(
        `Dockerfile validation grade ${grade}; retrying LLM generation (${retry}/${maxRetries})...`,
      );

      const issues = extractDockerValidationIssues(validationResult);
      content = await llmClient.chatCompletion([
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `${userBasePrompt}\n\nPrevious Dockerfile failed validation with grade ${grade}. Address all issues below and regenerate complete Dockerfile:\n${issues}`,
        },
      ]);

      validationResult = await runtime.execute(
        'fix-dockerfile' as never,
        {
          dockerfileContent: content,
          repositoryPath: workspacePath,
          dockerfile: content,
          path: workspacePath,
        } as never,
        metadata,
      );
    }

    return { content, validationResult };
  }

  const systemPrompt =
    'You are a Kubernetes expert. Generate production-ready K8s manifests (Deployment + Service + optional Ingress) based on the context below. Output ONLY valid YAML, no markdown fences.';

  const contextArtifacts = collectArtifacts(priorArtifacts, 'context');
  const dockerfileArtifacts = collectArtifacts(priorArtifacts, 'dockerfile');

  const userPrompt = [
    'Analysis and manifest planning data:',
    JSON.stringify(toolOutput, null, 2),
    '',
    'Prior context artifacts:',
    contextArtifacts,
    '',
    'Generated Dockerfile artifacts:',
    dockerfileArtifacts,
    '',
    'Policy directives:',
    policyDirectives(policies),
  ].join('\n');

  const content = await llmClient.chatCompletion([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);

  let validationResult: unknown;
  try {
    const parsed = yaml.loadAll(content);
    validationResult = {
      valid: true,
      documentCount: parsed.length,
    };
  } catch (error) {
    validationResult = {
      valid: false,
      error: error instanceof Error ? error.message : 'Failed to parse YAML output',
    };
  }

  return { content, validationResult };
}
