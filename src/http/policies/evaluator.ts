import type {
  Policy,
  PolicyResult,
  PolicyTarget,
  PolicyViolation,
  SessionArtifact,
  SessionPhase,
} from '../types';
import { BUILTIN_EVALUATORS } from './builtins';

const TARGET_TO_ARTIFACT_TAG: Record<PolicyTarget, string | null> = {
  dockerfile: 'dockerfile',
  manifest: 'manifest',
  package: 'context',
  any: null,
};

function targetMatchesArtifact(target: PolicyTarget, artifact: SessionArtifact): boolean {
  if (target === 'any') return true;
  const expectedTag = TARGET_TO_ARTIFACT_TAG[target];
  return expectedTag !== null && artifact.tag === expectedTag;
}

function parseRegoResult(raw: unknown): {
  violations: PolicyViolation[];
  warnings: PolicyViolation[];
} {
  const violations: PolicyViolation[] = [];
  const warnings: PolicyViolation[] = [];

  if (typeof raw !== 'object' || raw === null) return { violations, warnings };
  const result = raw as Record<string, unknown>;

  const extract = (key: string, severity: 'block' | 'warn', dest: PolicyViolation[]) => {
    const items = result[key];
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (typeof item === 'object' && item !== null) {
        const v = item as Record<string, unknown>;
        dest.push({
          rule: String(v.rule ?? key),
          severity,
          message: String(v.message ?? 'Policy violation'),
          ...(typeof v.line === 'number' && { line: v.line }),
        });
      }
    }
  };

  extract('violations', 'block', violations);
  extract('warnings', 'warn', warnings);

  return { violations, warnings };
}

export async function evaluateRegoPolicy(
  policy: Policy,
  artifact: SessionArtifact,
  phase: SessionPhase,
  regoEvaluator?: (rego: string, input: unknown) => Promise<unknown>,
): Promise<PolicyResult> {
  const now = new Date();
  const base: Omit<PolicyResult, 'outcome' | 'violations' | 'warnings'> = {
    policyId: policy.id,
    policyName: policy.name,
    artifactId: artifact.id,
    artifactName: artifact.name,
    phase,
    evaluatedAt: now,
  };

  if (!targetMatchesArtifact(policy.target, artifact)) {
    return { ...base, outcome: 'skip', violations: [], warnings: [] };
  }

  if (!policy.rego || !regoEvaluator) {
    return { ...base, outcome: 'skip', violations: [], warnings: [] };
  }

  try {
    const input = {
      type: artifact.tag ?? 'unknown',
      content: artifact.content,
      contentType: artifact.contentType,
      name: artifact.name,
      config: policy.config ?? {},
    };
    const raw = await regoEvaluator(policy.rego, input);
    const { violations, warnings } = parseRegoResult(raw);
    const outcome = violations.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass';
    return { ...base, outcome, violations, warnings } as PolicyResult;
  } catch {
    return {
      ...base,
      outcome: 'fail',
      violations: [
        { rule: 'evaluation-error', severity: 'block', message: 'Rego evaluation failed' },
      ],
      warnings: [],
    };
  }
}

export function evaluateSkillPolicy(
  policy: Policy,
  artifact: SessionArtifact,
  phase: SessionPhase,
): PolicyResult {
  const now = new Date();
  const base: Omit<PolicyResult, 'outcome' | 'violations' | 'warnings'> = {
    policyId: policy.id,
    policyName: policy.name,
    artifactId: artifact.id,
    artifactName: artifact.name,
    phase,
    evaluatedAt: now,
  };

  if (!targetMatchesArtifact(policy.target, artifact)) {
    return { ...base, outcome: 'skip', violations: [], warnings: [] };
  }

  return { ...base, outcome: 'pass', violations: [], warnings: [] };
}

export function evaluateBuiltinPolicy(
  policy: Policy,
  artifact: SessionArtifact,
  phase: SessionPhase,
): PolicyResult {
  const now = new Date();
  const base: Omit<PolicyResult, 'outcome' | 'violations' | 'warnings'> = {
    policyId: policy.id,
    policyName: policy.name,
    artifactId: artifact.id,
    artifactName: artifact.name,
    phase,
    evaluatedAt: now,
  };

  if (!targetMatchesArtifact(policy.target, artifact)) {
    return { ...base, outcome: 'skip', violations: [], warnings: [] };
  }

  const evaluator = policy.builtinId ? BUILTIN_EVALUATORS[policy.builtinId] : undefined;
  if (!evaluator) {
    return {
      ...base,
      outcome: 'fail',
      violations: [
        {
          rule: 'builtin-missing',
          severity: 'block',
          message: `Unknown builtin evaluator '${policy.builtinId ?? '(none)'}'`,
        },
      ],
      warnings: [],
    };
  }

  try {
    const { violations, warnings } = evaluator(artifact, policy.config ?? {});
    const outcome = violations.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass';
    return { ...base, outcome, violations, warnings };
  } catch {
    return {
      ...base,
      outcome: 'fail',
      violations: [
        { rule: 'evaluation-error', severity: 'block', message: 'Builtin evaluation failed' },
      ],
      warnings: [],
    };
  }
}

export async function evaluatePolicies(
  policies: Policy[],
  artifact: SessionArtifact,
  phase: SessionPhase,
  regoEvaluator?: (rego: string, input: unknown) => Promise<unknown>,
): Promise<PolicyResult[]> {
  const results: PolicyResult[] = [];

  for (const policy of policies) {
    if (!policy.enabled) continue;

    if (policy.type === 'rego') {
      results.push(await evaluateRegoPolicy(policy, artifact, phase, regoEvaluator));
    } else if (policy.type === 'builtin') {
      results.push(evaluateBuiltinPolicy(policy, artifact, phase));
    } else {
      results.push(evaluateSkillPolicy(policy, artifact, phase));
    }
  }

  return results;
}
