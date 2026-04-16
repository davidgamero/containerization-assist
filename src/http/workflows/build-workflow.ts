import type { AppRuntime } from '@/types/runtime';
import type { SessionStore } from '../sessions/store';
import { LlmClient, isLlmConfigured } from '../llm/client';
import { runLlmPhase } from '../llm/phase-agent';
import type { LlmConfig, SessionArtifact, SessionPolicies } from '../types';
import { SESSION_PHASE } from '../types';

export async function runBuildWorkflow(
  runtime: AppRuntime,
  store: SessionStore,
  sessionId: string,
  workspacePath: string,
  policies?: SessionPolicies | undefined,
  demoMode = false,
  llmConfig?: LlmConfig | undefined,
): Promise<void> {
  const log = (msg: string) => store.addLog(sessionId, msg);
  const demoDelay = (ms: number) =>
    demoMode ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve();

  const metadata = {
    transport: 'http',
    requestId: sessionId,
    sendNotification: async (notification: unknown) => {
      const n = notification as { method?: string; params?: { data?: string; message?: string } };
      if (n.params?.message) log(n.params.message);
      else if (n.params?.data) log(n.params.data);
    },
  };

  try {
    const effectivePolicies: SessionPolicies = policies ?? {
      policySkills: [],
      validationSkills: [],
    };
    const llmClient = isLlmConfigured(llmConfig) ? new LlmClient(llmConfig) : undefined;

    // Phase 1: Analyze repository
    await demoDelay(500);
    store.updatePhase(sessionId, SESSION_PHASE.ANALYZING);
    log('Analyzing repository structure...');
    await demoDelay(1200);

    const analysisResult = await runtime.execute(
      'analyze-repo' as never,
      { repositoryPath: workspacePath } as never,
      metadata,
    );

    if (!analysisResult.ok) {
      log(`Analysis failed: ${analysisResult.error}`);
      store.updatePhase(sessionId, SESSION_PHASE.FAILED, analysisResult.error);
      return;
    }

    store.addArtifact(
      sessionId,
      SESSION_PHASE.ANALYZING,
      'repository-analysis.json',
      JSON.stringify(analysisResult.value, null, 2),
      'application/json',
      'context',
    );

    const analysis = analysisResult.value as {
      modules?: Array<{
        language?: string;
        languageVersion?: string;
        modulePath?: string;
        frameworks?: Array<{ name: string }>;
        dependencies?: string[];
      }>;
    };
    const primaryModule = analysis.modules?.[0];
    log(
      `Detected ${primaryModule?.language ?? 'unknown'} project` +
        (primaryModule?.frameworks?.[0]?.name ? ` with ${primaryModule.frameworks[0].name}` : ''),
    );
    await demoDelay(800);

    // Phase 2: Generate Dockerfile
    store.updatePhase(sessionId, SESSION_PHASE.GENERATING_DOCKERFILE);
    log('Generating Dockerfile plan...');
    await demoDelay(1000);

    if (effectivePolicies.policySkills.length > 0) {
      const skillNames = effectivePolicies.policySkills.map((s) => s.name).join(', ');
      log(`Applying policy skills: ${skillNames}`);
    }

    const dockerfileResult = await runtime.execute(
      'generate-dockerfile' as never,
      {
        repositoryPath: workspacePath,
        ...(primaryModule?.modulePath && { modulePath: primaryModule.modulePath }),
        ...(primaryModule?.language && { language: primaryModule.language }),
        ...(primaryModule?.languageVersion && {
          languageVersion: primaryModule.languageVersion,
        }),
        ...(primaryModule?.frameworks?.[0]?.name && {
          framework: primaryModule.frameworks[0].name,
        }),
        ...(primaryModule?.dependencies && {
          detectedDependencies: primaryModule.dependencies,
        }),
        targetPlatform: 'linux/amd64',
      } as never,
      metadata,
    );

    if (!dockerfileResult.ok) {
      log(`Dockerfile generation failed: ${dockerfileResult.error}`);
      store.updatePhase(sessionId, SESSION_PHASE.FAILED, dockerfileResult.error);
      return;
    }

    store.addArtifact(
      sessionId,
      SESSION_PHASE.GENERATING_DOCKERFILE,
      'dockerfile-plan.json',
      JSON.stringify(dockerfileResult.value, null, 2),
      'application/json',
      'plan',
    );

    const plan = dockerfileResult.value as {
      policyValidation?: { passed: boolean; violations?: unknown[] };
      nextAction?: { action: string };
    };

    if (plan.policyValidation) {
      const pv = plan.policyValidation;
      log(
        pv.passed
          ? 'Policy validation passed'
          : `Policy validation failed: ${pv.violations?.length ?? 0} violation(s)`,
      );
    }

    log(`Dockerfile plan ready. Action: ${plan.nextAction?.action ?? 'create-files'}`);
    await demoDelay(600);

    if (llmClient) {
      log('Generating Dockerfile content with LLM...');
      const dockerfilePhase = await runLlmPhase({
        phase: 'generating_dockerfile',
        llmClient,
        toolOutput: dockerfileResult.value,
        priorArtifacts: store.get(sessionId)?.artifacts ?? [],
        policies: effectivePolicies,
        runtime,
        sessionId,
        workspacePath,
        log,
      });

      store.addArtifact(
        sessionId,
        SESSION_PHASE.GENERATING_DOCKERFILE,
        'Dockerfile',
        dockerfilePhase.content,
        'text/x-dockerfile',
        'dockerfile',
      );

      if (dockerfilePhase.validationResult !== undefined) {
        store.addArtifact(
          sessionId,
          SESSION_PHASE.GENERATING_DOCKERFILE,
          'dockerfile-validation.json',
          JSON.stringify(dockerfilePhase.validationResult, null, 2),
          'application/json',
          'validation-report',
        );
      }
    } else {
      store.addArtifact(
        sessionId,
        SESSION_PHASE.GENERATING_DOCKERFILE,
        'dockerfile-plan-summary.txt',
        `Dockerfile plan generated. Action: ${plan.nextAction?.action ?? 'create-files'}`,
        'text/plain',
      );
    }

    // Save policy skills as artifact so they're visible in the session
    if (effectivePolicies.policySkills.length > 0) {
      store.addArtifact(
        sessionId,
        SESSION_PHASE.GENERATING_DOCKERFILE,
        'policy-skills.json',
        JSON.stringify(effectivePolicies.policySkills, null, 2),
      );
    }

    // Phase 3: Build image context
    await demoDelay(800);
    store.updatePhase(sessionId, SESSION_PHASE.BUILDING);
    log('Preparing build context...');
    await demoDelay(1000);

    const buildContextResult = await runtime.execute(
      'build-image-context' as never,
      {
        path: workspacePath,
        imageName: `session-${sessionId.slice(0, 8)}`,
        platform: 'linux/amd64',
      } as never,
      metadata,
    );

    if (!buildContextResult.ok) {
      log(`Build context preparation note: ${buildContextResult.error}`);
      store.addArtifact(
        sessionId,
        SESSION_PHASE.BUILDING,
        'build-context-error.json',
        JSON.stringify(
          {
            error: buildContextResult.error,
            guidance: (buildContextResult as { guidance?: unknown }).guidance,
          },
          null,
          2,
        ),
        'application/json',
        'context',
      );
    } else {
      log('Build context prepared successfully');
      store.addArtifact(
        sessionId,
        SESSION_PHASE.BUILDING,
        'build-context.json',
        JSON.stringify(buildContextResult.value, null, 2),
        'application/json',
        'context',
      );
    }

    // Phase 4: Generate manifests
    await demoDelay(800);
    store.updatePhase(sessionId, SESSION_PHASE.GENERATING_MANIFESTS);
    log('Generating Kubernetes manifest plan...');
    await demoDelay(1000);

    const manifestResult = await runtime.execute(
      'generate-k8s-manifests' as never,
      {
        repositoryPath: workspacePath,
        modulePath: primaryModule?.modulePath ?? workspacePath,
        ...(primaryModule?.language && { language: primaryModule.language }),
        ...(primaryModule?.frameworks?.[0]?.name && {
          framework: primaryModule.frameworks[0].name,
        }),
      } as never,
      metadata,
    );

    if (!manifestResult.ok) {
      log(`Manifest generation failed: ${manifestResult.error}`);
      store.updatePhase(sessionId, SESSION_PHASE.FAILED, manifestResult.error);
      return;
    }

    store.addArtifact(
      sessionId,
      SESSION_PHASE.GENERATING_MANIFESTS,
      'manifest-plan.json',
      JSON.stringify(manifestResult.value, null, 2),
      'application/json',
      'plan',
    );

    await demoDelay(600);

    if (llmClient) {
      log('Generating Kubernetes manifests with LLM...');
      const manifestPhase = await runLlmPhase({
        phase: 'generating_manifests',
        llmClient,
        toolOutput: manifestResult.value,
        priorArtifacts: store.get(sessionId)?.artifacts ?? ([] as SessionArtifact[]),
        policies: effectivePolicies,
        runtime,
        sessionId,
        workspacePath,
        log,
      });

      store.addArtifact(
        sessionId,
        SESSION_PHASE.GENERATING_MANIFESTS,
        'k8s-manifests.yaml',
        manifestPhase.content,
        'text/yaml',
        'manifest',
      );

      if (manifestPhase.validationResult !== undefined) {
        store.addArtifact(
          sessionId,
          SESSION_PHASE.GENERATING_MANIFESTS,
          'manifest-validation.json',
          JSON.stringify(manifestPhase.validationResult, null, 2),
          'application/json',
          'validation-report',
        );
      }
    } else {
      store.addArtifact(
        sessionId,
        SESSION_PHASE.GENERATING_MANIFESTS,
        'manifest-plan-summary.txt',
        'Kubernetes manifest plan generated. Create deployment, service, and optional ingress.',
        'text/plain',
      );
    }

    // Run session-level Rego validation if validation skills are configured
    if (effectivePolicies.validationSkills.length > 0) {
      log('Running session validation policies...');
      const validationResults = [];

      for (const skill of effectivePolicies.validationSkills) {
        log(`Evaluating: ${skill.name}`);
        validationResults.push({
          id: skill.id,
          name: skill.name,
          rego: skill.rego,
          status: 'recorded',
          note: 'Rego policy saved for enforcement during artifact generation',
        });
      }

      store.addArtifact(
        sessionId,
        SESSION_PHASE.GENERATING_MANIFESTS,
        'validation-policies.json',
        JSON.stringify(validationResults, null, 2),
      );
      log(`${effectivePolicies.validationSkills.length} validation policy(ies) recorded`);
    }

    await demoDelay(600);
    log('Pipeline complete');
    store.updatePhase(sessionId, SESSION_PHASE.COMPLETE);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown workflow error';
    log(`Pipeline error: ${message}`);
    store.updatePhase(sessionId, SESSION_PHASE.FAILED, message);
  }
}
