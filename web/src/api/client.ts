export {
  SESSION_PHASE,
  STAGES,
  STAGES_BY_KEY,
  ORDERED_STAGES,
  EXECUTABLE_STAGES,
  getStageState,
  isTerminalPhase,
} from '../../../src/http/stages/registry';
export type {
  SessionPhase,
  SessionPhase as Phase,
  ArtifactTag,
  PolicyTarget,
  StageState,
  StageDefinition,
} from '../../../src/http/stages/registry';

import type { SessionPhase as Phase, PolicyTarget } from '../../../src/http/stages/registry';

export interface ApiError {
  code: string;
  message: string;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  value?: T;
  error?: ApiError;
}

export interface User {
  id: string;
  username: string;
  avatarUrl: string;
}

export type SessionSource =
  | { type: 'zip'; filename: string }
  | { type: 'github'; repoUrl: string; ref: string }
  | { type: 'example'; exampleId: string; exampleName: string };

export interface SessionListItem {
  id: string;
  phase: Phase;
  source: SessionSource;
  artifactCount: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  phase: Phase;
  source: SessionSource;
  workspacePath: string;
  policies: SessionPolicies;
  artifacts: Artifact[];
  logs: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Artifact {
  id: string;
  name: string;
  phase: Phase;
  version: string;
  content: string;
  contentType: string;
  createdAt: string;
  tag?: string;
}

export interface SessionEvent {
  type: 'phase_change' | 'artifact' | 'log' | 'error' | 'complete' | 'policy_result';
  sessionId: string;
  phase?: Phase;
  message?: string;
  artifactId?: string;
  result?: PolicyResult;
  timestamp: string;
}

export interface ExampleApp {
  id: string;
  name: string;
  description: string;
  tags: string[];
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
  builtinId?: string;
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
  phase: Phase;
  outcome: PolicyOutcome;
  violations: PolicyViolation[];
  warnings: PolicyViolation[];
  evaluatedAt: string;
}

export interface SessionPolicies {
  policies: Policy[];
  results: PolicyResult[];
}

export interface PolicyPreset {
  id: string;
  name: string;
  description: string;
  category: 'policy' | 'validation';
  target: PolicyTarget;
  type: PolicyType;
  builtinId?: string;
  rego?: string;
  defaultConfig?: Record<string, unknown>;
  configurable?: boolean;
  configFields?: Array<{ key: string; label: string; placeholder: string }>;
}

export interface RegoValidationResult {
  valid: boolean;
  message?: string;
  line?: number;
  col?: number;
  code?: string;
}

const API_BASE = '/v1';

class ApiClient {
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const envelope: ApiEnvelope<T> = await response.json();

    if (!envelope.ok || !envelope.value) {
      throw new Error(envelope.error?.message || 'Request failed');
    }

    return envelope.value;
  }

  async getHealth(): Promise<{ status: string }> {
    return this.request('/health');
  }

  async getMe(): Promise<User | null> {
    try {
      return await this.request('/auth/me');
    } catch {
      return null;
    }
  }

  async logout(): Promise<void> {
    await this.request('/auth/logout', { method: 'POST' });
  }

  async getSessions(): Promise<SessionListItem[]> {
    return this.request('/sessions');
  }

  async getSession(id: string): Promise<Session> {
    return this.request(`/sessions/${id}`);
  }

  async createSessionFromUpload(file: File): Promise<Session> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/sessions/upload`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    const envelope: ApiEnvelope<Session> = await response.json();

    if (!envelope.ok || !envelope.value) {
      throw new Error(envelope.error?.message || 'Upload failed');
    }

    return envelope.value;
  }

  async createSessionFromGitHub(repoUrl: string, ref?: string): Promise<Session> {
    return this.request('/sessions/github', {
      method: 'POST',
      body: JSON.stringify({ repoUrl, ref }),
    });
  }

  async getArtifact(sessionId: string, artifactId: string): Promise<Artifact> {
    return this.request(`/sessions/${sessionId}/artifacts/${artifactId}`);
  }

  async getExamples(): Promise<ExampleApp[]> {
    return this.request('/examples');
  }

  async createSessionFromExample(
    exampleId: string,
  ): Promise<{ sessionId: string; eventsUrl: string }> {
    return this.request('/sessions/example', {
      method: 'POST',
      body: JSON.stringify({ exampleId }),
    });
  }

  async getPolicyPresets(): Promise<PolicyPreset[]> {
    return this.request('/policy-presets');
  }

  async updateSessionPolicies(sessionId: string, policies: Policy[]): Promise<SessionPolicies> {
    return this.request(`/sessions/${sessionId}/policies`, {
      method: 'PATCH',
      body: JSON.stringify({ policies }),
    });
  }

  async validateRegoPolicy(rego: string): Promise<RegoValidationResult> {
    const response = await fetch(`${API_BASE}/policies/validate`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rego }),
    });

    const envelope: ApiEnvelope<RegoValidationResult> = await response.json();

    if (!envelope.ok || !envelope.value) {
      if (envelope.error?.code === 'SIDECAR_UNAVAILABLE') {
        throw new Error(
          'Custom Rego requires the Docker Compose deployment. Run `docker compose up` to enable.',
        );
      }
      if (envelope.error?.code === 'SIDECAR_ERROR') {
        throw new Error(
          'Policy sidecar is unreachable. Ensure Docker Compose services are running, then retry validation.',
        );
      }
      throw new Error(envelope.error?.message || 'Failed to validate Rego policy');
    }

    return envelope.value;
  }

  async getGlobalPolicies(): Promise<Policy[]> {
    return this.request('/policies/global');
  }

  async getConfig(): Promise<{ demoMode: boolean }> {
    return this.request('/config');
  }

  getEventSourceUrl(sessionId: string): string {
    return `${API_BASE}/sessions/${sessionId}/events`;
  }
}

export const api = new ApiClient();
