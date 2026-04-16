/**
 * Shared types for the HTTP API layer.
 */

import type { AppRuntime } from '@/types/runtime';
import {
  SESSION_PHASE,
  type SessionPhase,
  type ArtifactTag,
  type PolicyTarget,
} from './stages/registry';

export { SESSION_PHASE };
export type { SessionPhase, ArtifactTag, PolicyTarget };

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

export type PolicyType = 'skill' | 'rego' | 'builtin';
export type PolicyScope = 'global' | 'session';
export type PolicyOutcome = 'pass' | 'fail' | 'warn' | 'skip';

export interface Policy {
  id: string;
  name: string;
  description: string;
  type: PolicyType;
  scope: PolicyScope;
  target: PolicyTarget;
  rego?: string;
  directive?: string;
  /** Identifier for a built-in TypeScript evaluator (when type === 'builtin'). */
  builtinId?: string;
  /** Parametric config injected into Rego input as `input.config`. */
  config?: Record<string, unknown>;
  enabled: boolean;
}

export interface PolicyViolation {
  rule: string;
  severity: 'block' | 'warn';
  message: string;
  line?: number;
}

export interface PolicyResult {
  policyId: string;
  policyName: string;
  artifactId: string;
  artifactName: string;
  phase: SessionPhase;
  outcome: PolicyOutcome;
  violations: PolicyViolation[];
  warnings: PolicyViolation[];
  evaluatedAt: Date;
}

export interface SessionPolicies {
  policies: Policy[];
  results: PolicyResult[];
}

/** @deprecated Use Policy with type='skill' instead. Kept for migration compatibility. */
export interface PolicySkill {
  id: string;
  name: string;
  description: string;
}

/** @deprecated Use Policy with type='rego' instead. Kept for migration compatibility. */
export interface ValidationSkill {
  id: string;
  name: string;
  description: string;
  rego: string;
}

export function policyFromSkill(skill: PolicySkill, scope: PolicyScope = 'session'): Policy {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    type: 'skill',
    scope,
    target: 'dockerfile',
    directive: skill.description,
    enabled: true,
  };
}

export function policyFromValidationSkill(
  skill: ValidationSkill,
  scope: PolicyScope = 'session',
): Policy {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    type: 'rego',
    scope,
    target: 'dockerfile',
    rego: skill.rego,
    enabled: true,
  };
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
  type: 'phase_change' | 'artifact' | 'log' | 'error' | 'complete' | 'policy_result';
  sessionId: string;
  phase?: SessionPhase;
  message?: string;
  artifactId?: string;
  result?: PolicyResult;
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
