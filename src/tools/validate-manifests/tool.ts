/**
 * Validate Manifests Tool
 *
 * Validates Kubernetes manifests against organizational policies and best practices.
 * Supports three input modes: inline manifests, file paths, or manifest plans.
 *
 * @category kubernetes
 * @version 1.0.0
 * @knowledgeEnhanced false
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Failure, Success, type Result } from '@/types';
import type { ToolContext } from '@/core/context';
import { validateManifestsInputSchema, type ManifestValidationResult } from './schema';
import type { z } from 'zod';
import { validateManifestsToolDefinition } from './types';
import { getToolLogger } from '@/lib/tool-helpers';
import { tool } from '@/types/tool';
import { parseManifests, wrapForGatekeeper } from '@/lib/manifest-parser';
import type { K8sResource } from '@/lib/manifest-parser';
import { validateContentAgainstPolicy, type PolicyViolation } from '@/lib/policy-helpers';
import { loadAndMergeRegoPolicies } from '@/config/policy-rego';

const { name } = validateManifestsToolDefinition;

const SAFEGUARD_POLICY_FILES = [
  'container-resource-limits.rego',
  'container-enforce-probes.rego',
  'container-allowed-images.rego',
  'container-restricted-image-pulls.rego',
  'pod-enforce-antiaffinity.rego',
  'disallowed-bad-pdb.rego',
];

const SAFEGUARD_PACKAGE_KEYS = [
  'container_resource_limits',
  'container_enforce_probes',
  'container_allowed_images',
  'container_restricted_image_pulls',
  'pod_enforce_antiaffinity',
  'disallowed_bad_pdb',
];

function findProjectRoot(): string {
  let current = process.cwd();
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'policies'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return process.cwd();
}

function buildSafeguardAdapterRego(): string {
  const packageKeys = SAFEGUARD_PACKAGE_KEYS.map((pkg) => `"${pkg}"`).join(', ');
  return `package containerization.safeguards

safeguard_packages := [${packageKeys}]

default allow := false
allow if count(violations) == 0

violations contains violation if {
  some pkg in safeguard_packages
  some raw in object.get(data.safeguards[pkg], "violations", [])

  rule := object.get(raw, "rule", sprintf("safeguard-%s", [replace(pkg, "_", "-")]))
  msg := object.get(raw, "message", object.get(raw, "msg", "Safeguard violation"))

  violation := {
    "rule": rule,
    "category": "kubernetes-safeguard",
    "severity": "block",
    "message": msg,
    "description": object.get(raw, "description", "Tier 1 safeguard validation violation"),
    "priority": 90,
  }
}

warnings contains warning if {
  some pkg in safeguard_packages
  some raw in object.get(data.safeguards[pkg], "warnings", [])

  rule := object.get(raw, "rule", sprintf("safeguard-%s", [replace(pkg, "_", "-")]))
  msg := object.get(raw, "message", object.get(raw, "msg", "Safeguard warning"))

  warning := {
    "rule": rule,
    "category": "kubernetes-safeguard",
    "severity": "warn",
    "message": msg,
    "description": object.get(raw, "description", "Tier 1 safeguard validation warning"),
    "priority": 70,
  }
}

result := {
  "allow": allow,
  "violations": violations,
  "warnings": warnings,
  "suggestions": [],
  "summary": {
    "total_violations": count(violations),
    "total_warnings": count(warnings),
    "total_suggestions": 0,
  },
}`;
}

function planToManifestText(
  plan: NonNullable<z.infer<typeof validateManifestsInputSchema>['plan']>,
): string[] {
  const fromInline = plan.manifests ?? [];
  const fromFiles = (plan.manifestPaths ?? []).map((manifestPath) =>
    fs.readFileSync(manifestPath, 'utf-8'),
  );

  const manifests = [...fromInline, ...fromFiles];
  if (manifests.length > 0) {
    return manifests;
  }

  return [
    `apiVersion: v1
kind: ConfigMap
metadata:
  name: ${plan.name}
data:
  description: ${plan.description ?? 'generated plan manifest'}`,
  ];
}

function summarizeResource(
  resource: { kind: string; metadata: { name: string } },
  violations: number,
  warnings: number,
): string {
  return `${resource.kind}/${resource.metadata.name}: ${violations} violation(s), ${warnings} warning(s)`;
}

async function handleValidateManifests(
  input: z.infer<typeof validateManifestsInputSchema>,
  ctx: ToolContext,
): Promise<Result<ManifestValidationResult>> {
  const logger = getToolLogger(ctx, name);

  const parse = validateManifestsInputSchema.safeParse(input);
  if (!parse.success) {
    return Failure(`Invalid input: ${parse.error.message}`);
  }
  const validatedInput = parse.data;

  logger.info(
    {
      hasManifests: !!validatedInput.manifests,
      hasManifestPaths: !!validatedInput.manifestPaths,
      hasPlan: !!validatedInput.plan,
      safeguardLevel: validatedInput.safeguardLevel,
    },
    'Validating manifests',
  );

  const manifestTexts: string[] = [];
  try {
    if (validatedInput.manifests) {
      manifestTexts.push(...validatedInput.manifests);
    } else if (validatedInput.manifestPaths) {
      for (const manifestPath of validatedInput.manifestPaths) {
        manifestTexts.push(fs.readFileSync(manifestPath, 'utf-8'));
      }
    } else if (validatedInput.plan) {
      manifestTexts.push(...planToManifestText(validatedInput.plan));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Failure(`Failed to read manifest input: ${message}`);
  }

  const parsedResources: K8sResource[] = [];
  for (const manifestText of manifestTexts) {
    const parseResult = parseManifests(manifestText);
    if (!parseResult.ok) {
      return Failure(`Failed to parse manifests: ${parseResult.error}`);
    }
    parsedResources.push(...parseResult.value);
  }

  const allViolations: PolicyViolation[] = [];
  const allWarnings: PolicyViolation[] = [];
  const allSuggestions: PolicyViolation[] = [];
  const tier1Results: string[] = [];

  const projectRoot = findProjectRoot();
  const safeguardsDir = path.join(projectRoot, 'policies', 'safeguards');
  const safeguardPolicyPaths = SAFEGUARD_POLICY_FILES.map((fileName) =>
    path.join(safeguardsDir, fileName),
  );
  const helperPolicyPath = path.join(safeguardsDir, 'lib', 'helpers.rego');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-manifests-safeguards-'));
  const adapterPath = path.join(tempDir, 'safeguard-adapter.rego');
  fs.writeFileSync(adapterPath, buildSafeguardAdapterRego(), 'utf-8');

  try {
    const safeguardEvaluatorResult = await loadAndMergeRegoPolicies(
      [...safeguardPolicyPaths, helperPolicyPath, adapterPath],
      logger,
    );

    for (const resource of parsedResources) {
      const wrapped = wrapForGatekeeper(resource);
      const resourceViolationsStart = allViolations.length;
      const resourceWarningsStart = allWarnings.length;

      if (safeguardEvaluatorResult.ok) {
        try {
          const safeguardResult = await safeguardEvaluatorResult.value.evaluate(
            wrapped as unknown as Record<string, unknown>,
          );
          allViolations.push(
            ...safeguardResult.violations.map((v) => ({
              ruleId: v.rule,
              category: v.category,
              message: v.message,
              severity: v.severity,
              ...(v.priority !== undefined ? { priority: v.priority } : {}),
              ...(v.description !== undefined ? { description: v.description } : {}),
            })),
          );
          allWarnings.push(
            ...safeguardResult.warnings.map((v) => ({
              ruleId: v.rule,
              category: v.category,
              message: v.message,
              severity: v.severity,
              ...(v.priority !== undefined ? { priority: v.priority } : {}),
              ...(v.description !== undefined ? { description: v.description } : {}),
            })),
          );
          allSuggestions.push(
            ...safeguardResult.suggestions.map((v) => ({
              ruleId: v.rule,
              category: v.category,
              message: v.message,
              severity: v.severity,
              ...(v.priority !== undefined ? { priority: v.priority } : {}),
              ...(v.description !== undefined ? { description: v.description } : {}),
            })),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn(
            { error: message, resource: resource.metadata.name },
            'Safeguard policy evaluation failed',
          );
          allWarnings.push({
            ruleId: 'safeguard-evaluation-error',
            category: 'system',
            severity: 'warn',
            message: `Safeguard evaluation failed for ${resource.kind}/${resource.metadata.name}: ${message}`,
            description:
              'Tier 1 safeguard policy evaluation failed for this resource; continued validation.',
          });
        }
      } else {
        logger.warn({ error: safeguardEvaluatorResult.error }, 'Failed to load safeguard policies');
        allWarnings.push({
          ruleId: 'safeguard-policy-load-error',
          category: 'system',
          severity: 'warn',
          message: `Failed to load safeguard policies: ${safeguardEvaluatorResult.error}`,
          description: 'Tier 1 safeguard policy loading failed; continued validation.',
        });
      }

      const resourceViolationCount = allViolations.length - resourceViolationsStart;
      const resourceWarningCount = allWarnings.length - resourceWarningsStart;
      tier1Results.push(summarizeResource(resource, resourceViolationCount, resourceWarningCount));
    }

    if (ctx.policy) {
      for (const manifestText of manifestTexts) {
        try {
          const textPolicyResult = await validateContentAgainstPolicy(
            manifestText,
            ctx.policy,
            logger,
            'manifest',
          );
          allViolations.push(...textPolicyResult.violations);
          allWarnings.push(...textPolicyResult.warnings);
          allSuggestions.push(...textPolicyResult.suggestions);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn({ error: message }, 'Text-based policy evaluation failed');
          allWarnings.push({
            ruleId: 'text-policy-evaluation-error',
            category: 'system',
            severity: 'warn',
            message: `Text policy evaluation failed: ${message}`,
            description: 'Text policy validation failed; continued safeguard validation.',
          });
        }
      }
    }
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  const summary = {
    totalRules: allViolations.length + allWarnings.length + allSuggestions.length,
    matchedRules: allViolations.length + allWarnings.length + allSuggestions.length,
    blockingViolations: allViolations.length,
    warnings: allWarnings.length,
    suggestions: allSuggestions.length,
  };

  const allow = allViolations.length === 0;

  const result: ManifestValidationResult & { allow: boolean } = {
    allow,
    passed: allViolations.length === 0,
    violations: allViolations,
    warnings: allWarnings,
    suggestions: allSuggestions,
    summary,
    tier1Results,
    tier2: [],
    tier3Results: [],
    resourceCount: parsedResources.length,
  };

  return Success(result as ManifestValidationResult);
}

export default tool({
  ...validateManifestsToolDefinition,
  handler: handleValidateManifests,
});
