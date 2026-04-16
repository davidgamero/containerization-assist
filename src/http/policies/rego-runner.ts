import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { createRegoHttpClient, probeSidecar } from './rego-client';

const execFileAsync = promisify(execFile);

export type RegoRunner = (rego: string, input: unknown) => Promise<unknown>;

interface RunnerState {
  checked: boolean;
  available: boolean;
  binary: string;
}

const state: RunnerState = { checked: false, available: false, binary: 'opa' };

function getOpaBinaryPath(): string {
  const name = process.platform === 'win32' ? 'opa.exe' : 'opa';
  return join(process.cwd(), 'node_modules', '.bin', name);
}

async function probeOpa(): Promise<boolean> {
  const local = getOpaBinaryPath();
  for (const candidate of [local, 'opa']) {
    try {
      await execFileAsync(candidate, ['version'], { timeout: 5000 });
      state.binary = candidate;
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

export async function createRegoRunner(
  log: (msg: string) => void,
): Promise<RegoRunner | undefined> {
  const sidecarUrl = process.env.CA_POLICY_SERVICE_URL?.trim();
  if (sidecarUrl) {
    const healthy = await probeSidecar(sidecarUrl);
    if (healthy) {
      log(`Policy sidecar reachable at ${sidecarUrl}; Rego policy evaluation enabled via HTTP.`);
      return createRegoHttpClient({ url: sidecarUrl });
    }
    log(
      `CA_POLICY_SERVICE_URL=${sidecarUrl} set but sidecar unreachable; falling back to local OPA binary probe.`,
    );
  }

  if (!state.checked) {
    state.available = await probeOpa();
    state.checked = true;
    if (state.available) {
      log(`OPA binary found at ${state.binary}; Rego policy evaluation enabled.`);
    } else {
      log(
        'OPA binary not found on PATH or in node_modules/.bin; Rego policies will be skipped at runtime. ' +
          'Install from https://www.openpolicyagent.org/docs/latest/#running-opa to enable evaluation.',
      );
    }
  }

  if (!state.available) return undefined;

  return async (rego: string, input: unknown): Promise<unknown> => {
    const dir = await mkdtemp(join(tmpdir(), 'ca-rego-'));
    const regoPath = join(dir, 'policy.rego');
    const inputPath = join(dir, 'input.json');
    try {
      await writeFile(regoPath, rego, 'utf8');
      await writeFile(inputPath, JSON.stringify(input), 'utf8');
      const { stdout } = await execFileAsync(
        state.binary,
        ['eval', '-d', regoPath, '-i', inputPath, '-f', 'json', 'data'],
        { maxBuffer: 10 * 1024 * 1024, timeout: 10_000 },
      );
      const parsed = JSON.parse(stdout) as {
        result?: Array<{ expressions?: Array<{ value?: unknown }> }>;
      };
      const dataValue = parsed.result?.[0]?.expressions?.[0]?.value;
      return extractPolicyResult(dataValue);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

function extractPolicyResult(dataValue: unknown): unknown {
  if (!dataValue || typeof dataValue !== 'object') return null;
  const violations: unknown[] = [];
  const warnings: unknown[] = [];
  walkForRuleArrays(dataValue, violations, warnings);
  return { violations, warnings };
}

function walkForRuleArrays(node: unknown, violations: unknown[], warnings: unknown[]): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'violations' && Array.isArray(value)) violations.push(...value);
    else if (key === 'warnings' && Array.isArray(value)) warnings.push(...value);
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      walkForRuleArrays(value, violations, warnings);
    }
  }
}
