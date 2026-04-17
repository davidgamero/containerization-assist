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

export const noRootUserEvaluator: BuiltinEvaluator = (artifact) => {
  const violations: PolicyViolation[] = [];
  const warnings: PolicyViolation[] = [];
  const content = artifact.content;

  const lines = content.split('\n');
  let hasUserDirective = false;

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    const userMatch = trimmed.match(/^USER\s+(.+)/i);
    if (userMatch) {
      hasUserDirective = true;
      const user = userMatch[1]!.trim();
      if (user === 'root' || user === '0') {
        violations.push({
          rule: 'no-root-user',
          severity: 'block',
          message: `Running as root user is not allowed. Use a non-root user instead.`,
          line: idx + 1,
        });
      }
    }
  });

  if (!hasUserDirective) {
    warnings.push({
      rule: 'no-root-user',
      severity: 'warn',
      message: 'No USER directive found. Containers should run as a non-root user.',
    });
  }

  return { violations, warnings };
};

export const mcrRequiredImagesEvaluator: BuiltinEvaluator = (artifact) => {
  const violations: PolicyViolation[] = [];
  const lines = artifact.content.split('\n');

  lines.forEach((line, idx) => {
    const match = line.match(FROM_LINE);
    const img = match?.[1];
    if (!img) return;
    if (!img.includes('/') && !img.includes(':') && img !== 'scratch') return;
    if (img === 'scratch') return;
    if (!img.startsWith('mcr.microsoft.com/')) {
      violations.push({
        rule: 'mcr-required-images',
        severity: 'block',
        message: `Base image '${img}' is not from Microsoft Container Registry. Use mcr.microsoft.com/ images (e.g., mcr.microsoft.com/azurelinux/base/core for Azure Linux, mcr.microsoft.com/dotnet/aspnet for .NET, mcr.microsoft.com/openjdk/jdk for Java).`,
        line: idx + 1,
      });
    }
  });

  return { violations, warnings: [] };
};

export const BUILTIN_EVALUATORS: Record<string, BuiltinEvaluator> = {
  'image-allowlist': imageAllowlistEvaluator,
  'no-root-user': noRootUserEvaluator,
  'mcr-required-images': mcrRequiredImagesEvaluator,
};
