import type { PolicyViolation, SessionArtifact } from '../../types';

export interface BuiltinEvaluationResult {
  violations: PolicyViolation[];
  warnings: PolicyViolation[];
}

export type BuiltinEvaluator = (
  artifact: SessionArtifact,
  config: Record<string, unknown>,
) => BuiltinEvaluationResult;

const FROM_LINE = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/i;

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export const imageAllowlistEvaluator: BuiltinEvaluator = (artifact, config) => {
  const violations: PolicyViolation[] = [];
  const allowedImages = new Set(asStringArray(config.allowed_images));
  const allowedPatterns = asStringArray(config.allowed_patterns)
    .filter((p) => p !== '' && p !== '*' && p.includes('*'))
    .map(globToRegex);

  const lines = artifact.content.split('\n');
  lines.forEach((line, idx) => {
    const match = line.match(FROM_LINE);
    const img = match?.[1];
    if (!img) return;
    if (allowedImages.has(img)) return;
    if (allowedPatterns.some((re) => re.test(img))) return;
    violations.push({
      rule: 'image-allowlist',
      severity: 'block',
      message: `Base image '${img}' is not in the approved allowlist. Use an approved image.`,
      line: idx + 1,
    });
  });

  return { violations, warnings: [] };
};

export const BUILTIN_EVALUATORS: Record<string, BuiltinEvaluator> = {
  'image-allowlist': imageAllowlistEvaluator,
};
