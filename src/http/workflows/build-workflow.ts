import type { AppRuntime } from '@/types/runtime';
import type { SessionStore } from '../sessions/store';
import { LlmClient, isLlmConfigured } from '../llm/client';
import { SESSION_PHASE, type LlmConfig, type SessionPolicies } from '../types';
import { EXECUTABLE_STAGES } from '../stages/registry';
import { STAGE_HANDLERS, type StageContext, type StageSharedState } from '../stages/handlers';
import type { RegoRunner } from '../policies/rego-runner';

export async function runBuildWorkflow(
  runtime: AppRuntime,
  store: SessionStore,
  sessionId: string,
  workspacePath: string,
  policies?: SessionPolicies | undefined,
  demoMode = false,
  llmConfig?: LlmConfig | undefined,
  regoRunner?: RegoRunner | undefined,
): Promise<void> {
  const log = (msg: string) => store.addLog(sessionId, msg);
  const demoDelay = (ms: number) =>
    demoMode ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve();

  const effectivePolicies: SessionPolicies = policies ?? { policies: [], results: [] };
  const enabledPolicies = effectivePolicies.policies.filter((p) => p.enabled);
  const llmClient = isLlmConfigured(llmConfig) ? new LlmClient(llmConfig) : undefined;

  const metadata = {
    transport: 'http',
    requestId: sessionId,
    sendNotification: async (notification: unknown) => {
      const n = notification as { method?: string; params?: { data?: string; message?: string } };
      if (n.params?.message) log(n.params.message);
      else if (n.params?.data) log(n.params.data);
    },
  };

  const shared: StageSharedState = {};

  const ctx: StageContext = {
    runtime,
    store,
    sessionId,
    workspacePath,
    policies: effectivePolicies,
    enabledPolicies,
    llmClient,
    regoRunner,
    log,
    demoDelay,
    metadata,
    shared,
  };

  try {
    await demoDelay(500);

    for (const stage of EXECUTABLE_STAGES) {
      const handler = STAGE_HANDLERS[stage.key];
      if (!handler) continue;

      store.updatePhase(sessionId, stage.key);
      const result = await handler(ctx);

      if (!result.ok) {
        store.updatePhase(sessionId, SESSION_PHASE.FAILED, result.error);
        return;
      }
    }

    log('Pipeline complete');
    store.updatePhase(sessionId, SESSION_PHASE.COMPLETE);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown workflow error';
    log(`Pipeline error: ${message}`);
    store.updatePhase(sessionId, SESSION_PHASE.FAILED, message);
  }
}
