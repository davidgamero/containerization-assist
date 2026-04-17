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

function generateSyntheticDockerfile(analysis: AnalysisShape | undefined): string {
  const mod = analysis?.modules?.[0];
  const lang = mod?.language?.toLowerCase() ?? 'node';
  const version = mod?.languageVersion ?? '';
  const framework = mod?.frameworks?.[0]?.name?.toLowerCase() ?? '';

  if (
    lang === 'python' ||
    framework === 'flask' ||
    framework === 'django' ||
    framework === 'fastapi'
  ) {
    const pyVer = version || '3.12';
    return [
      `FROM python:${pyVer}-slim AS builder`,
      'WORKDIR /app',
      'COPY requirements.txt .',
      'RUN pip install --no-cache-dir -r requirements.txt',
      'COPY . .',
      '',
      `FROM python:${pyVer}-slim`,
      'WORKDIR /app',
      'COPY --from=builder /app /app',
      'EXPOSE 5000',
      'HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:5000/ || exit 1',
      'USER appuser',
      'CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:5000"]',
    ].join('\n');
  }

  const nodeVer = version || '22';
  return [
    `FROM node:${nodeVer}-slim AS builder`,
    'WORKDIR /app',
    'COPY package*.json ./',
    'RUN npm ci --only=production',
    'COPY . .',
    '',
    `FROM node:${nodeVer}-slim`,
    'WORKDIR /app',
    'COPY --from=builder /app /app',
    'EXPOSE 3000',
    'HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:3000/ || exit 1',
    'USER node',
    'CMD ["node", "index.js"]',
  ].join('\n');
}

function generateSyntheticManifest(sessionId: string, analysis: AnalysisShape | undefined): string {
  const mod = analysis?.modules?.[0];
  const lang = mod?.language?.toLowerCase() ?? 'node';
  const appName = `session-${sessionId.slice(0, 8)}`;
  const port = lang === 'python' ? 5000 : 3000;
  const image = `${appName}:latest`;

  return [
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    `  name: ${appName}`,
    '  labels:',
    `    app: ${appName}`,
    'spec:',
    '  replicas: 2',
    '  selector:',
    '    matchLabels:',
    `      app: ${appName}`,
    '  template:',
    '    metadata:',
    '      labels:',
    `        app: ${appName}`,
    '    spec:',
    '      containers:',
    `        - name: ${appName}`,
    `          image: ${image}`,
    '          ports:',
    `            - containerPort: ${port}`,
    '          resources:',
    '            requests:',
    '              cpu: 100m',
    '              memory: 128Mi',
    '            limits:',
    '              cpu: 500m',
    '              memory: 256Mi',
    '          livenessProbe:',
    '            httpGet:',
    '              path: /',
    `              port: ${port}`,
    '            initialDelaySeconds: 10',
    '            periodSeconds: 30',
    '          readinessProbe:',
    '            httpGet:',
    '              path: /',
    `              port: ${port}`,
    '            initialDelaySeconds: 5',
    '            periodSeconds: 10',
    '---',
    'apiVersion: v1',
    'kind: Service',
    'metadata:',
    `  name: ${appName}`,
    'spec:',
    '  selector:',
    `    app: ${appName}`,
    '  ports:',
    `    - port: 80`,
    `      targetPort: ${port}`,
    '  type: ClusterIP',
  ].join('\n');
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
    ctx.log('Generating Dockerfile from plan (demo mode)...');
    const dockerfileContent = generateSyntheticDockerfile(ctx.shared.analysis);
    const dockerfileArtifact = ctx.store.addArtifact(
      ctx.sessionId,
      SESSION_PHASE.GENERATING_DOCKERFILE,
      'Dockerfile',
      dockerfileContent,
      'text/x-dockerfile',
      'dockerfile',
    );

    await evaluatePolicyFor(ctx, dockerfileArtifact, SESSION_PHASE.GENERATING_DOCKERFILE);
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
    const errorArtifact = ctx.store.addArtifact(
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
    await evaluatePolicyFor(ctx, errorArtifact, SESSION_PHASE.BUILDING);
  } else {
    ctx.log('Build context prepared successfully');
    const buildArtifact = ctx.store.addArtifact(
      ctx.sessionId,
      SESSION_PHASE.BUILDING,
      'build-context.json',
      JSON.stringify(result.value, null, 2),
      'application/json',
      'context',
    );
    await evaluatePolicyFor(ctx, buildArtifact, SESSION_PHASE.BUILDING);
  }

  await ctx.demoDelay(800);
  return { ok: true };
};

const scanningHandler: StageHandler = async (ctx) => {
  ctx.log('Scanning image for vulnerabilities...');
  await ctx.demoDelay(1000);

  const imageRef = `session-${ctx.sessionId.slice(0, 8)}:latest`;
  const result = await ctx.runtime.execute(
    'scan-image' as never,
    { imageId: imageRef } as never,
    ctx.metadata,
  );

  if (!result.ok) {
    ctx.log(`Scan skipped: ${result.error}`);
    const scanArtifact = ctx.store.addArtifact(
      ctx.sessionId,
      SESSION_PHASE.SCANNING,
      'scan-report.json',
      JSON.stringify({ skipped: true, reason: result.error }, null, 2),
      'application/json',
      'validation-report',
    );
    await evaluatePolicyFor(ctx, scanArtifact, SESSION_PHASE.SCANNING);
  } else {
    ctx.log('Scan complete');
    const scanArtifact = ctx.store.addArtifact(
      ctx.sessionId,
      SESSION_PHASE.SCANNING,
      'scan-report.json',
      JSON.stringify(result.value, null, 2),
      'application/json',
      'validation-report',
    );
    await evaluatePolicyFor(ctx, scanArtifact, SESSION_PHASE.SCANNING);
  }

  await ctx.demoDelay(600);
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
    ctx.log('Generating Kubernetes manifests from plan (demo mode)...');
    const manifestContent = generateSyntheticManifest(ctx.sessionId, ctx.shared.analysis);
    const manifestArtifact = ctx.store.addArtifact(
      ctx.sessionId,
      SESSION_PHASE.GENERATING_MANIFESTS,
      'k8s-manifests.yaml',
      manifestContent,
      'text/yaml',
      'manifest',
    );

    await evaluatePolicyFor(ctx, manifestArtifact, SESSION_PHASE.GENERATING_MANIFESTS);
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
  [SESSION_PHASE.SCANNING]: scanningHandler,
  [SESSION_PHASE.GENERATING_MANIFESTS]: generateManifestsHandler,
};

export type { LlmConfig };
