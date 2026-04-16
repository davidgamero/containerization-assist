import type { AppRuntime } from '@/types/runtime';
import type { SessionStore } from '../sessions/store';
import type { LlmClient } from '../llm/client';
import { runLlmPhase } from '../llm/phase-agent';
import { evaluatePolicies } from '../policies/evaluator';
import type { RegoRunner } from '../policies/rego-runner';
import type { Policy, SessionArtifact, SessionPolicies, LlmConfig } from '../types';
import { SESSION_PHASE, type SessionPhase } from './registry';

export interface AnalysisShape {
  modules?: Array<{
    language?: string;
    languageVersion?: string;
    modulePath?: string;
    frameworks?: Array<{ name: string }>;
    dependencies?: string[];
  }>;
}

export interface DockerfilePlanShape {
  policyValidation?: { passed: boolean; violations?: unknown[] };
  nextAction?: { action: string };
}

export interface StageSharedState {
  analysis?: AnalysisShape;
  dockerfilePlan?: DockerfilePlanShape;
}

export interface StageContext {
  runtime: AppRuntime;
  store: SessionStore;
  sessionId: string;
  workspacePath: string;
  policies: SessionPolicies;
  enabledPolicies: Policy[];
  llmClient: LlmClient | undefined;
  regoRunner: RegoRunner | undefined;
  log: (msg: string) => void;
  demoDelay: (ms: number) => Promise<void>;
  metadata: {
    transport: string;
    requestId: string;
    sendNotification: (n: unknown) => Promise<void>;
  };
  shared: StageSharedState;
}

export type StageResult = { ok: true } | { ok: false; error: string };

export type StageHandler = (ctx: StageContext) => Promise<StageResult>;

async function evaluatePolicyFor(
  ctx: StageContext,
  artifact: SessionArtifact,
  phase: SessionPhase,
): Promise<void> {
  if (ctx.enabledPolicies.length === 0) return;
  const results = await evaluatePolicies(ctx.enabledPolicies, artifact, phase, ctx.regoRunner);
  if (results.length > 0) {
    ctx.store.addPolicyResults(ctx.sessionId, results);
  }
}

function primaryModule(ctx: StageContext) {
  return ctx.shared.analysis?.modules?.[0];
}

const analyzingHandler: StageHandler = async (ctx) => {
  ctx.log('Analyzing repository structure...');
  await ctx.demoDelay(1200);

  const result = await ctx.runtime.execute(
    'analyze-repo' as never,
    { repositoryPath: ctx.workspacePath } as never,
    ctx.metadata,
  );

  if (!result.ok) {
    ctx.log(`Analysis failed: ${result.error}`);
    return { ok: false, error: result.error };
  }

  const artifact = ctx.store.addArtifact(
    ctx.sessionId,
    SESSION_PHASE.ANALYZING,
    'repository-analysis.json',
    JSON.stringify(result.value, null, 2),
    'application/json',
    'context',
  );

  await evaluatePolicyFor(ctx, artifact, SESSION_PHASE.ANALYZING);

  ctx.shared.analysis = result.value as AnalysisShape;
  const mod = primaryModule(ctx);
  ctx.log(
    `Detected ${mod?.language ?? 'unknown'} project${
      mod?.frameworks?.[0]?.name ? ` with ${mod.frameworks[0].name}` : ''
    }`,
  );
  await ctx.demoDelay(800);
  return { ok: true };
};

const generateDockerfileHandler: StageHandler = async (ctx) => {
  ctx.log('Generating Dockerfile plan...');
  await ctx.demoDelay(1000);

  const mod = primaryModule(ctx);
  const skillPolicies = ctx.enabledPolicies.filter((p) => p.type === 'skill');
  if (skillPolicies.length > 0) {
    ctx.log(`Applying policy skills: ${skillPolicies.map((s) => s.name).join(', ')}`);
  }

  const planResult = await ctx.runtime.execute(
    'generate-dockerfile' as never,
    {
      repositoryPath: ctx.workspacePath,
      ...(mod?.modulePath && { modulePath: mod.modulePath }),
      ...(mod?.language && { language: mod.language }),
      ...(mod?.languageVersion && { languageVersion: mod.languageVersion }),
      ...(mod?.frameworks?.[0]?.name && { framework: mod.frameworks[0].name }),
      ...(mod?.dependencies && { detectedDependencies: mod.dependencies }),
      targetPlatform: 'linux/amd64',
    } as never,
    ctx.metadata,
  );

  if (!planResult.ok) {
    ctx.log(`Dockerfile generation failed: ${planResult.error}`);
    return { ok: false, error: planResult.error };
  }

  ctx.store.addArtifact(
    ctx.sessionId,
    SESSION_PHASE.GENERATING_DOCKERFILE,
    'dockerfile-plan.json',
    JSON.stringify(planResult.value, null, 2),
    'application/json',
    'plan',
  );

  const plan = planResult.value as DockerfilePlanShape;
  ctx.shared.dockerfilePlan = plan;

  if (plan?.policyValidation) {
    const pv = plan.policyValidation;
    ctx.log(
      pv.passed
        ? 'Policy validation passed'
        : `Policy validation failed: ${pv.violations?.length ?? 0} violation(s)`,
    );
  }

  ctx.log(`Dockerfile plan ready. Action: ${plan?.nextAction?.action ?? 'create-files'}`);
  await ctx.demoDelay(600);

  if (ctx.llmClient) {
    ctx.log('Generating Dockerfile content with LLM...');
    const llmResult = await runLlmPhase({
      phase: SESSION_PHASE.GENERATING_DOCKERFILE,
      llmClient: ctx.llmClient,
      toolOutput: planResult.value,
      priorArtifacts: ctx.store.get(ctx.sessionId)?.artifacts ?? [],
      policies: ctx.policies,
      runtime: ctx.runtime,
      sessionId: ctx.sessionId,
      workspacePath: ctx.workspacePath,
      log: ctx.log,
    });

    const dockerfileArtifact = ctx.store.addArtifact(
      ctx.sessionId,
      SESSION_PHASE.GENERATING_DOCKERFILE,
      'Dockerfile',
      llmResult.content,
      'text/x-dockerfile',
      'dockerfile',
    );

    await evaluatePolicyFor(ctx, dockerfileArtifact, SESSION_PHASE.GENERATING_DOCKERFILE);

    if (llmResult.validationResult !== undefined) {
      ctx.store.addArtifact(
        ctx.sessionId,
        SESSION_PHASE.GENERATING_DOCKERFILE,
        'dockerfile-validation.json',
        JSON.stringify(llmResult.validationResult, null, 2),
        'application/json',
        'validation-report',
      );
    }
  } else {
    ctx.store.addArtifact(
      ctx.sessionId,
      SESSION_PHASE.GENERATING_DOCKERFILE,
      'dockerfile-plan-summary.txt',
      `Dockerfile plan generated. Action: ${plan?.nextAction?.action ?? 'create-files'}`,
      'text/plain',
    );
  }

  if (skillPolicies.length > 0) {
    ctx.store.addArtifact(
      ctx.sessionId,
      SESSION_PHASE.GENERATING_DOCKERFILE,
      'policy-skills.json',
      JSON.stringify(skillPolicies, null, 2),
    );
  }

  await ctx.demoDelay(800);
  return { ok: true };
};

const buildingHandler: StageHandler = async (ctx) => {
  ctx.log('Preparing build context...');
  await ctx.demoDelay(1000);

  const result = await ctx.runtime.execute(
    'build-image-context' as never,
    {
      path: ctx.workspacePath,
      imageName: `session-${ctx.sessionId.slice(0, 8)}`,
      platform: 'linux/amd64',
    } as never,
    ctx.metadata,
  );

  if (!result.ok) {
    ctx.log(`Build context preparation note: ${result.error}`);
    ctx.store.addArtifact(
      ctx.sessionId,
      SESSION_PHASE.BUILDING,
      'build-context-error.json',
      JSON.stringify(
        { error: result.error, guidance: (result as { guidance?: unknown }).guidance },
        null,
        2,
      ),
      'application/json',
      'context',
    );
  } else {
    ctx.log('Build context prepared successfully');
    ctx.store.addArtifact(
      ctx.sessionId,
      SESSION_PHASE.BUILDING,
      'build-context.json',
      JSON.stringify(result.value, null, 2),
      'application/json',
      'context',
    );
  }

  await ctx.demoDelay(800);
  return { ok: true };
};

const generateManifestsHandler: StageHandler = async (ctx) => {
  ctx.log('Generating Kubernetes manifest plan...');
  await ctx.demoDelay(1000);

  const mod = primaryModule(ctx);
  const planResult = await ctx.runtime.execute(
    'generate-k8s-manifests' as never,
    {
      repositoryPath: ctx.workspacePath,
      modulePath: mod?.modulePath ?? ctx.workspacePath,
      ...(mod?.language && { language: mod.language }),
      ...(mod?.frameworks?.[0]?.name && { framework: mod.frameworks[0].name }),
    } as never,
    ctx.metadata,
  );

  if (!planResult.ok) {
    ctx.log(`Manifest generation failed: ${planResult.error}`);
    return { ok: false, error: planResult.error };
  }

  ctx.store.addArtifact(
    ctx.sessionId,
    SESSION_PHASE.GENERATING_MANIFESTS,
    'manifest-plan.json',
    JSON.stringify(planResult.value, null, 2),
    'application/json',
    'plan',
  );

  await ctx.demoDelay(600);

  if (ctx.llmClient) {
    ctx.log('Generating Kubernetes manifests with LLM...');
    const llmResult = await runLlmPhase({
      phase: SESSION_PHASE.GENERATING_MANIFESTS,
      llmClient: ctx.llmClient,
      toolOutput: planResult.value,
      priorArtifacts: ctx.store.get(ctx.sessionId)?.artifacts ?? [],
      policies: ctx.policies,
      runtime: ctx.runtime,
      sessionId: ctx.sessionId,
      workspacePath: ctx.workspacePath,
      log: ctx.log,
    });

    const manifestArtifact = ctx.store.addArtifact(
      ctx.sessionId,
      SESSION_PHASE.GENERATING_MANIFESTS,
      'k8s-manifests.yaml',
      llmResult.content,
      'text/yaml',
      'manifest',
    );

    await evaluatePolicyFor(ctx, manifestArtifact, SESSION_PHASE.GENERATING_MANIFESTS);

    if (llmResult.validationResult !== undefined) {
      ctx.store.addArtifact(
        ctx.sessionId,
        SESSION_PHASE.GENERATING_MANIFESTS,
        'manifest-validation.json',
        JSON.stringify(llmResult.validationResult, null, 2),
        'application/json',
        'validation-report',
      );
    }
  } else {
    ctx.store.addArtifact(
      ctx.sessionId,
      SESSION_PHASE.GENERATING_MANIFESTS,
      'manifest-plan-summary.txt',
      'Kubernetes manifest plan generated. Create deployment, service, and optional ingress.',
      'text/plain',
    );
  }

  const regoPolicies = ctx.enabledPolicies.filter((p) => p.type === 'rego');
  if (regoPolicies.length > 0) {
    ctx.log('Running session validation policies...');
    const validationResults = regoPolicies.map((p) => ({
      id: p.id,
      name: p.name,
      target: p.target,
      status: 'recorded',
    }));
    ctx.store.addArtifact(
      ctx.sessionId,
      SESSION_PHASE.GENERATING_MANIFESTS,
      'validation-policies.json',
      JSON.stringify(validationResults, null, 2),
    );
    ctx.log(`${regoPolicies.length} validation policy(ies) recorded`);
  }

  await ctx.demoDelay(600);
  return { ok: true };
};

export const STAGE_HANDLERS: Partial<Record<SessionPhase, StageHandler>> = {
  [SESSION_PHASE.ANALYZING]: analyzingHandler,
  [SESSION_PHASE.GENERATING_DOCKERFILE]: generateDockerfileHandler,
  [SESSION_PHASE.BUILDING]: buildingHandler,
  [SESSION_PHASE.GENERATING_MANIFESTS]: generateManifestsHandler,
};

export type { LlmConfig };
