/**
 * Pipeline Context
 *
 * Tracks the state of a containerization pipeline across stages.
 * Accumulates outputs from each tool so subsequent stages have
 * full context about what's been done and what artifacts exist.
 */

import type { RepositoryAnalysis, ModuleInfo } from '@/tools/analyze-repo/schema.js';
import type { DockerfilePlan } from '@/tools/generate-dockerfile/schema.js';
import type { BuildImageResult } from '@/tools/build-image-context/schema.js';
import type { ManifestPlan } from '@/tools/generate-k8s-manifests/schema.js';

/**
 * Inventory of existing containerization artifacts found in the repo.
 * Detected before the agent loop starts so the LLM can decide
 * whether to regenerate or enhance each artifact.
 */
export interface ArtifactInventory {
  dockerfiles: ArtifactEntry[];
  dockerCompose: ArtifactEntry[];
  k8sManifests: ArtifactEntry[];
  helmCharts: ArtifactEntry[];
  kustomize: ArtifactEntry[];
}

export interface ArtifactEntry {
  path: string;
  relativePath: string;
  /** Byte size */
  size: number;
}

/**
 * Per-stage validation result tracked across the pipeline.
 */
export interface StageValidation {
  stage: string;
  passed: boolean;
  violations: string[];
  warnings: string[];
  timestamp: string;
}

/**
 * Accumulated pipeline state that grows as each stage completes.
 * The agent loop stores this alongside the job, and feeds a
 * summary into the LLM context so it can make informed decisions.
 */
export interface PipelineContext {
  /** Existing artifacts discovered before the pipeline started */
  artifacts: ArtifactInventory;

  /** Result from analyze-repo (stage 1) */
  analysis: RepositoryAnalysis | null;

  /** Primary module selected for containerization */
  selectedModule: ModuleInfo | null;

  /** Result from generate-dockerfile (stage 2) */
  dockerfilePlan: DockerfilePlan | null;

  /** Path to the Dockerfile being used (existing or generated) */
  dockerfilePath: string | null;

  /** Result from build-image-context (stage 3) */
  buildResult: BuildImageResult | null;

  /** Built image reference (e.g., myapp:latest) */
  builtImageRef: string | null;

  /** Scan result summary (stage 4) */
  scanSummary: {
    vulnerabilities: { critical: number; high: number; medium: number; low: number };
    passed: boolean;
  } | null;

  /** Tagged image reference (stage 5) */
  taggedImageRef: string | null;

  /** Pushed image digest (stage 6) */
  pushedDigest: string | null;

  /** Result from generate-k8s-manifests (stage 7) */
  manifestPlan: ManifestPlan | null;

  /** Generated manifest file paths */
  manifestPaths: string[];

  /** Cluster preparation status (stage 8) */
  clusterReady: boolean;

  /** Deployment verification (stage 9) */
  deploymentVerified: boolean;

  /** Validation results collected after each stage */
  validations: StageValidation[];

  /** Revision history of artifacts as they change through stages */
  artifactRevisions: ArtifactRevision[];
}

/**
 * A single revision of a generated/modified artifact.
 * Tracks how Dockerfiles, manifests, etc. evolve across agent steps.
 */
export interface ArtifactRevision {
  /** Artifact type */
  type: 'dockerfile' | 'k8s-manifest' | 'helm-chart' | 'dockerfile-plan' | 'k8s-plan';
  /** The tool that produced this revision */
  producedBy: string;
  /** Step index in the pipeline */
  stepIndex: number;
  /** Timestamp */
  timestamp: string;
  /** Content snapshot or summary (truncated for large artifacts) */
  content: string;
  /** Validation result for this revision */
  validation: StageValidation | null;
}

/**
 * Create an empty pipeline context.
 */
export function createPipelineContext(artifacts: ArtifactInventory): PipelineContext {
  return {
    artifacts,
    analysis: null,
    selectedModule: null,
    dockerfilePlan: null,
    dockerfilePath: null,
    buildResult: null,
    builtImageRef: null,
    scanSummary: null,
    taggedImageRef: null,
    pushedDigest: null,
    manifestPlan: null,
    manifestPaths: [],
    clusterReady: false,
    deploymentVerified: false,
    validations: [],
    artifactRevisions: [],
  };
}

/**
 * Update pipeline context after a tool completes.
 * Extracts key outputs from each tool's result and stores them.
 * Also records artifact revisions for mutating stages.
 */
export function updatePipelineContext(
  ctx: PipelineContext,
  toolName: string,
  result: unknown,
  stepIndex?: number | undefined,
): void {
  if (!result || typeof result !== 'object') return;

  const r = result as Record<string, unknown>;

  switch (toolName) {
    case 'analyze-repo': {
      ctx.analysis = result as RepositoryAnalysis;
      const modules = (r.modules as ModuleInfo[] | undefined) ?? [];
      if (modules.length > 0) {
        ctx.selectedModule = modules[0] ?? null;
      }
      break;
    }

    case 'generate-dockerfile': {
      ctx.dockerfilePlan = result as DockerfilePlan;
      // Extract dockerfile path from the plan's nextAction
      const plan = result as DockerfilePlan;
      if (plan.existingDockerfile?.path) {
        ctx.dockerfilePath = plan.existingDockerfile.path;
      }
      break;
    }

    case 'build-image-context': {
      ctx.buildResult = result as BuildImageResult;
      const buildRes = result as BuildImageResult;
      if (buildRes.context?.dockerfilePath) {
        ctx.dockerfilePath = buildRes.context.dockerfilePath;
      }
      const tags = buildRes.buildConfig?.finalTags;
      if (tags && tags.length > 0) {
        ctx.builtImageRef = tags[0] ?? null;
      }
      break;
    }

    case 'scan-image': {
      const summary = r.summary as
        | { critical?: number; high?: number; medium?: number; low?: number }
        | undefined;
      if (summary) {
        ctx.scanSummary = {
          vulnerabilities: {
            critical: summary.critical ?? 0,
            high: summary.high ?? 0,
            medium: summary.medium ?? 0,
            low: summary.low ?? 0,
          },
          passed: (summary.critical ?? 0) === 0 && (summary.high ?? 0) === 0,
        };
      }
      break;
    }

    case 'tag-image': {
      const newTag = r.newTag as string | undefined;
      if (newTag) {
        ctx.taggedImageRef = newTag;
      }
      break;
    }

    case 'push-image': {
      const digest = r.digest as string | undefined;
      if (digest) {
        ctx.pushedDigest = digest;
      }
      break;
    }

    case 'generate-k8s-manifests': {
      ctx.manifestPlan = result as ManifestPlan;
      break;
    }

    case 'prepare-cluster': {
      const success = r.success as boolean | undefined;
      ctx.clusterReady = success === true;
      break;
    }

    case 'verify-deploy': {
      const ready = r.ready as boolean | undefined;
      ctx.deploymentVerified = ready === true;
      break;
    }
  }

  // --- Track artifact revisions for mutating tools ---
  const idx = stepIndex ?? ctx.artifactRevisions.length;
  const now = new Date().toISOString();

  if (toolName === 'generate-dockerfile') {
    const plan = result as DockerfilePlan;
    const summary = plan.summary || '';
    const existing = plan.existingDockerfile;
    ctx.artifactRevisions.push({
      type: 'dockerfile-plan',
      producedBy: toolName,
      stepIndex: idx,
      timestamp: now,
      content: existing
        ? `Enhancing existing Dockerfile (${existing.analysis.complexity}, security: ${existing.analysis.securityPosture})\n${summary}`
        : `New Dockerfile plan\n${summary}`,
      validation: null,
    });
  }

  if (toolName === 'fix-dockerfile') {
    const fixes = (r.appliedFixes as string[] | undefined) ?? [];
    ctx.artifactRevisions.push({
      type: 'dockerfile',
      producedBy: toolName,
      stepIndex: idx,
      timestamp: now,
      content: fixes.length > 0
        ? `Applied ${fixes.length} fix(es): ${fixes.join('; ')}`
        : r.summary as string || 'Dockerfile fixes analyzed',
      validation: null,
    });
  }

  if (toolName === 'build-image-context') {
    const buildRes = result as BuildImageResult;
    ctx.artifactRevisions.push({
      type: 'dockerfile',
      producedBy: toolName,
      stepIndex: idx,
      timestamp: now,
      content: [
        `Build context: ${buildRes.context?.buildContextPath || 'unknown'}`,
        `Dockerfile: ${buildRes.context?.dockerfileRelative || 'unknown'}`,
        `Tags: ${buildRes.buildConfig?.finalTags?.join(', ') || 'none'}`,
        `Security risk: ${buildRes.securityAnalysis?.riskLevel || 'unknown'}`,
        `Base images: ${buildRes.dockerfileAnalysis?.baseImages?.join(', ') || 'unknown'}`,
      ].join('\n'),
      validation: null,
    });
  }

  if (toolName === 'generate-k8s-manifests') {
    const plan = result as ManifestPlan;
    ctx.artifactRevisions.push({
      type: 'k8s-plan',
      producedBy: toolName,
      stepIndex: idx,
      timestamp: now,
      content: [
        `Type: ${plan.manifestType}`,
        `Confidence: ${plan.confidence}`,
        plan.summary || '',
      ].join('\n'),
      validation: null,
    });
  }
}

/**
 * Build a compact summary of the current pipeline state
 * for injection into the LLM conversation context.
 */
export function summarizePipelineContext(ctx: PipelineContext): string {
  const lines: string[] = ['## Current Pipeline State'];

  // Existing artifacts
  const artifactCounts = [
    ctx.artifacts.dockerfiles.length > 0 &&
      `${ctx.artifacts.dockerfiles.length} Dockerfile(s): ${ctx.artifacts.dockerfiles.map((a) => a.relativePath).join(', ')}`,
    ctx.artifacts.k8sManifests.length > 0 &&
      `${ctx.artifacts.k8sManifests.length} K8s manifest(s): ${ctx.artifacts.k8sManifests.map((a) => a.relativePath).join(', ')}`,
    ctx.artifacts.helmCharts.length > 0 &&
      `${ctx.artifacts.helmCharts.length} Helm chart(s): ${ctx.artifacts.helmCharts.map((a) => a.relativePath).join(', ')}`,
    ctx.artifacts.dockerCompose.length > 0 &&
      `${ctx.artifacts.dockerCompose.length} docker-compose file(s)`,
    ctx.artifacts.kustomize.length > 0 &&
      `${ctx.artifacts.kustomize.length} Kustomize overlay(s)`,
  ].filter(Boolean);

  if (artifactCounts.length > 0) {
    lines.push('### Existing Artifacts');
    for (const entry of artifactCounts) {
      lines.push(`- ${entry}`);
    }
  }

  // Completed stages
  lines.push('### Completed Stages');

  if (ctx.analysis) {
    const modules = ctx.analysis.modules ?? [];
    lines.push(
      `- ✅ **analyze-repo**: ${modules.length} module(s) detected${
        ctx.selectedModule
          ? ` — primary: ${ctx.selectedModule.name} (${ctx.selectedModule.language})`
          : ''}`,
    );
  }

  if (ctx.dockerfilePlan) {
    lines.push(
      `- ✅ **generate-dockerfile**: confidence=${ctx.dockerfilePlan.confidence}${
        ctx.dockerfilePlan.existingDockerfile
          ? ' (enhancing existing)'
          : ' (creating new)'}`,
    );
  }

  if (ctx.buildResult) {
    lines.push(
      `- ✅ **build-image-context**: image=${ctx.builtImageRef ?? 'built'}`,
    );
  }

  if (ctx.scanSummary) {
    const v = ctx.scanSummary.vulnerabilities;
    lines.push(
      `- ${ctx.scanSummary.passed ? '✅' : '⚠️'} **scan-image**: ` +
        `C=${v.critical} H=${v.high} M=${v.medium} L=${v.low}`,
    );
  }

  if (ctx.taggedImageRef) {
    lines.push(`- ✅ **tag-image**: ${ctx.taggedImageRef}`);
  }

  if (ctx.pushedDigest) {
    lines.push(`- ✅ **push-image**: digest=${ctx.pushedDigest.substring(0, 20)}...`);
  }

  if (ctx.manifestPlan) {
    lines.push(
      `- ✅ **generate-k8s-manifests**: type=${ctx.manifestPlan.manifestType}`,
    );
  }

  if (ctx.clusterReady) {
    lines.push('- ✅ **prepare-cluster**: cluster ready');
  }

  if (ctx.deploymentVerified) {
    lines.push('- ✅ **verify-deploy**: deployment healthy');
  }

  // Validation results
  const failures = ctx.validations.filter((v) => !v.passed);
  if (failures.length > 0) {
    lines.push('### Validation Issues');
    for (const v of failures) {
      lines.push(`- ⚠️ **${v.stage}**: ${v.violations.join('; ')}`);
    }
  }

  return lines.join('\n');
}
