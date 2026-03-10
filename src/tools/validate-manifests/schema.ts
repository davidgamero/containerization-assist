/**
 * Schema definition for validate-manifests tool
 */

import { z } from 'zod';
import type { PolicyValidationResult } from '@/lib/policy-helpers';

/**
 * ManifestPlan - represents planned manifest validation with recommendations
 */
export interface ManifestPlan {
  manifestSource: 'inline' | 'file' | 'plan';
  manifestCount: number;
  summary: string;
  tier1Results: string[];
  tier2: Array<{
    level: string;
    details: string;
  }>;
  tier3Results: string[];
  resourceCount: number;
  policyValidation?: PolicyValidationResult;
}

/**
 * ManifestValidationResult - output type extending PolicyValidationResult
 */
export interface ManifestValidationResult extends PolicyValidationResult {
  tier1Results: string[];
  tier2: Array<{
    level: string;
    details: string;
  }>;
  tier3Results: string[];
  resourceCount: number;
}

export const validateManifestsInputSchema = z
  .object({
    // Three exclusive input modes
    manifests: z
      .array(z.string())
      .optional()
      .describe(
        'Array of Kubernetes manifest content as YAML strings. Use for inline manifest validation.',
      ),
    manifestPaths: z
      .array(z.string())
      .optional()
      .describe('Array of file paths to Kubernetes manifests. Use for file-based validation.'),
    plan: z
      .object({
        name: z.string().describe('Name of the validation plan'),
        description: z.string().optional().describe('Plan description'),
        manifests: z.array(z.string()).optional().describe('Inline manifests for this plan'),
        manifestPaths: z.array(z.string()).optional().describe('File paths for this plan'),
      })
      .optional()
      .describe('ManifestPlan object containing manifest references and metadata.'),

    // Optional fields
    clusterContext: z
      .string()
      .optional()
      .describe('kubectl context name for validation. Defaults to current context.'),
    enableDryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Enable dry-run validation against actual cluster. Defaults to false.'),
    safeguardLevel: z
      .enum(['warn', 'enforce'])
      .optional()
      .default('warn')
      .describe('Policy enforcement level: "warn" for advisory, "enforce" to block violations.'),
  })
  // NOTE: zod-to-json-schema does not encode superRefine constraints into JSON Schema.
  // SDK/VS Code JSON Schema validation may accept inputs that Zod rejects at runtime
  // (e.g. providing both manifests and manifestPaths). Runtime validation catches these.
  .superRefine((data, ctx) => {
    const hasManifests = !!data.manifests;
    const hasManifestPaths = !!data.manifestPaths;
    const hasPlan = !!data.plan;

    // Count how many modes are provided
    const providedModes = [hasManifests, hasManifestPaths, hasPlan].filter(Boolean).length;

    // Require exactly one mode
    if (providedModes === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Must provide exactly one of: manifests (inline YAML), manifestPaths (file paths), or plan (ManifestPlan object)',
        path: ['manifests'],
      });
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Must provide exactly one of: manifests (inline YAML), manifestPaths (file paths), or plan (ManifestPlan object)',
        path: ['manifestPaths'],
      });
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Must provide exactly one of: manifests (inline YAML), manifestPaths (file paths), or plan (ManifestPlan object)',
        path: ['plan'],
      });
    } else if (providedModes > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Cannot provide multiple input modes. Use exactly one of: manifests (inline YAML), manifestPaths (file paths), or plan (ManifestPlan object)',
        path: ['manifests'],
      });
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Cannot provide multiple input modes. Use exactly one of: manifests (inline YAML), manifestPaths (file paths), or plan (ManifestPlan object)',
        path: ['manifestPaths'],
      });
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Cannot provide multiple input modes. Use exactly one of: manifests (inline YAML), manifestPaths (file paths), or plan (ManifestPlan object)',
        path: ['plan'],
      });
    }
  });

export type ValidateManifestsParams = z.infer<typeof validateManifestsInputSchema>;
