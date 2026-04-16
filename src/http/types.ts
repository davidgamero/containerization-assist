/**
 * Shared types for the HTTP API layer.
 */

import type { AppRuntime } from '@/types/runtime';

/** Session phases in pipeline order. */
export const SESSION_PHASE = {
  PENDING: 'pending',
  CLONING: 'cloning',
  ANALYZING: 'analyzing',
  GENERATING_DOCKERFILE: 'generating_dockerfile',
  BUILDING: 'building',
  SCANNING: 'scanning',
  GENERATING_MANIFESTS: 'generating_manifests',
  COMPLETE: 'complete',
  FAILED: 'failed',
} as const;
export type SessionPhase = (typeof SESSION_PHASE)[keyof typeof SESSION_PHASE];

export type ArtifactTag =
  | 'context'
  | 'dockerfile'
  | 'manifest'
  | 'validation-report'
  | 'plan'
  | 'log';

/** Versioned artifact produced by a phase. */
export interface SessionArtifact {
  id: string;
  sessionId: string;
  phase: SessionPhase;
  name: string;
  contentType: string;
  tag?: ArtifactTag | undefined;
  /** Stringified content (JSON or text). */
  content: string;
  version: number;
  createdAt: Date;
}

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** A policy skill — free-text LLM directive applied during generation. */
export interface PolicySkill {
  id: string;
  name: string;
  description: string;
}

/** A validation skill — Rego policy applied during validation. */
export interface ValidationSkill {
  id: string;
  name: string;
  description: string;
  rego: string;
}

/** Per-session policy configuration. */
export interface SessionPolicies {
  policySkills: PolicySkill[];
  validationSkills: ValidationSkill[];
}

/** Persistent session state. */
export interface Session {
  id: string;
  phase: SessionPhase;
  /** Source description for display. */
  source:
    | { type: 'zip'; filename: string }
    | { type: 'github'; repoUrl: string; ref: string }
    | { type: 'example'; exampleId: string; exampleName: string };
  workspacePath: string;
  policies: SessionPolicies;
  artifacts: SessionArtifact[];
  logs: string[];
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** SSE event emitted during session processing. */
export interface SessionEvent {
  type: 'phase_change' | 'artifact' | 'log' | 'error' | 'complete';
  sessionId: string;
  phase?: SessionPhase;
  message?: string;
  artifactId?: string;
  timestamp: Date;
}

/** Typed environment the Hono app carries. */
export interface HonoEnv {
  Variables: {
    runtime: AppRuntime;
    githubToken?: string;
  };
}

/** Standard JSON envelope returned by all API endpoints. */
export interface ApiResponse<T = unknown> {
  ok: boolean;
  value?: T;
  error?: { code: string; message: string; details?: string };
}
