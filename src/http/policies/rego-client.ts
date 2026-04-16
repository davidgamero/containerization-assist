// HTTP client adapter for the Go policy sidecar (services/policy).
// Activated when CA_POLICY_SERVICE_URL is set; otherwise the local OPA binary
// runner in rego-runner.ts is used. Response shape mirrors extractPolicyResult:
// { violations: unknown[], warnings: unknown[] }.

import type { RegoRunner } from './rego-runner';

interface SidecarEvalResponse {
  violations?: unknown[];
  warnings?: unknown[];
  raw?: unknown;
  evaluatedInMs?: number;
  cacheHit?: boolean;
}

interface SidecarErrorResponse {
  code?: string;
  message?: string;
  line?: number;
  col?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export interface RegoClientOptions {
  url: string;
  timeoutMs?: number;
}

export async function probeSidecar(url: string, timeoutMs = 2_000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/healthz`, {
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function createRegoHttpClient({
  url,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: RegoClientOptions): RegoRunner {
  const base = url.replace(/\/$/, '');
  return async (rego: string, input: unknown): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/v1/evaluate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rego, input }),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        let parsed: SidecarErrorResponse | undefined;
        try {
          parsed = JSON.parse(text) as SidecarErrorResponse;
        } catch {
          parsed = undefined;
        }
        const detail = parsed?.message ?? text ?? res.statusText;
        const loc = parsed?.line != null ? ` at line ${parsed.line}:${parsed.col ?? 0}` : '';
        throw new Error(`policy sidecar ${res.status}: ${detail}${loc}`);
      }
      const body = JSON.parse(text) as SidecarEvalResponse;
      return {
        violations: Array.isArray(body.violations) ? body.violations : [],
        warnings: Array.isArray(body.warnings) ? body.warnings : [],
      };
    } finally {
      clearTimeout(timer);
    }
  };
}
