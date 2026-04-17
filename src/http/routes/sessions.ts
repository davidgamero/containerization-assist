import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppRuntime } from '@/types/runtime';
import type { HonoEnv, ApiResponse, LlmConfig, Policy, SessionPolicies } from '../types';
import type { SessionStore } from '../sessions/store';
import type { WorkspaceManager } from '../workspace/manager';
import { runBuildWorkflow } from '../workflows/build-workflow';
import { EXAMPLE_APPS, getExample } from '../examples/catalog';
import { POLICY_PRESETS, getDefaultSessionPolicies } from '../policies/presets';
import type { GlobalPolicyStore } from '../policies/global-store';
import type { RegoRunner } from '../policies/rego-runner';

interface SessionRouteConfig {
  githubClientId?: string | undefined;
  githubClientSecret?: string | undefined;
  demoMode?: boolean | undefined;
  llmConfig?: LlmConfig | undefined;
  regoRunnerPromise?: Promise<RegoRunner | undefined> | undefined;
}

export function sessionRoutes(
  runtime: AppRuntime,
  sessionStore: SessionStore,
  workspaceManager: WorkspaceManager,
  _config: SessionRouteConfig,
  globalPolicyStore: GlobalPolicyStore,
): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const demoMode = _config.demoMode ?? false;
  const llmConfig = _config.llmConfig;
  const regoRunnerPromise = _config.regoRunnerPromise ?? Promise.resolve(undefined);

  // List all sessions.
  router.get('/sessions', (c) => {
    const sessions = sessionStore.list().map((s) => ({
      id: s.id,
      phase: s.phase,
      source: s.source,
      artifactCount: s.artifacts.length,
      error: s.error,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
    return c.json({ ok: true, value: sessions } satisfies ApiResponse);
  });

  // Get single session with artifacts.
  router.get('/sessions/:id', (c) => {
    const session = sessionStore.get(c.req.param('id'));
    if (!session) {
      return c.json(
        {
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' },
        } satisfies ApiResponse,
        404,
      );
    }
    return c.json({ ok: true, value: session } satisfies ApiResponse);
  });

  // Get a specific artifact.
  router.get('/sessions/:id/artifacts/:artifactId', (c) => {
    const session = sessionStore.get(c.req.param('id'));
    if (!session) {
      return c.json(
        {
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' },
        } satisfies ApiResponse,
        404,
      );
    }
    const artifact = session.artifacts.find((a) => a.id === c.req.param('artifactId'));
    if (!artifact) {
      return c.json(
        {
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Artifact not found' },
        } satisfies ApiResponse,
        404,
      );
    }
    return c.json({ ok: true, value: artifact } satisfies ApiResponse);
  });

  // Create session from zip upload.
  router.post('/sessions/upload', async (c) => {
    const contentType = c.req.header('content-type') ?? '';

    if (
      !contentType.includes('application/zip') &&
      !contentType.includes('application/octet-stream') &&
      !contentType.includes('multipart/form-data')
    ) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'Expected application/zip, application/octet-stream, or multipart/form-data',
          },
        } satisfies ApiResponse,
        400,
      );
    }

    let stream: ReadableStream<Uint8Array>;
    let filename = 'upload.zip';

    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData();
      const file = formData.get('file');
      if (!(file instanceof File)) {
        return c.json(
          {
            ok: false,
            error: { code: 'BAD_REQUEST', message: 'Missing file field' },
          } satisfies ApiResponse,
          400,
        );
      }
      filename = file.name;
      stream = file.stream();
    } else {
      const body = c.req.raw.body;
      if (!body) {
        return c.json(
          {
            ok: false,
            error: { code: 'BAD_REQUEST', message: 'Empty body' },
          } satisfies ApiResponse,
          400,
        );
      }
      stream = body;
    }

    try {
      const workspace = await workspaceManager.createFromZipStream(stream, filename);
      const initialPolicies: SessionPolicies = {
        policies: globalPolicyStore.mergeWithSession(getDefaultSessionPolicies()),
        results: [],
      };
      const session = sessionStore.create(
        { type: 'zip', filename },
        workspace.srcPath,
        initialPolicies,
      );

      runBuildWorkflow(
        runtime,
        sessionStore,
        session.id,
        workspace.srcPath,
        session.policies,
        demoMode,
        llmConfig,
        await regoRunnerPromise,
      ).catch(() => {});

      const body: ApiResponse = {
        ok: true,
        value: { sessionId: session.id, eventsUrl: `/v1/sessions/${session.id}/events` },
      };
      return c.json(body, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      return c.json(
        { ok: false, error: { code: 'UPLOAD_ERROR', message } } satisfies ApiResponse,
        400,
      );
    }
  });

  // Create session from GitHub repo URL.
  router.post('/sessions/github', async (c) => {
    const { repoUrl, ref } = await c.req.json<{ repoUrl: string; ref?: string }>();

    if (!repoUrl || !repoUrl.includes('github.com')) {
      return c.json(
        {
          ok: false,
          error: { code: 'BAD_REQUEST', message: 'Invalid GitHub repo URL' },
        } satisfies ApiResponse,
        400,
      );
    }

    const token = getCookie(c, 'gh_token');
    if (!token) {
      return c.json(
        {
          ok: false,
          error: { code: 'UNAUTHENTICATED', message: 'GitHub login required' },
        } satisfies ApiResponse,
        401,
      );
    }

    try {
      const workspace = await workspaceManager.createFromGitHub(repoUrl, token, ref ?? 'HEAD');
      const initialPolicies: SessionPolicies = {
        policies: globalPolicyStore.mergeWithSession(getDefaultSessionPolicies()),
        results: [],
      };
      const session = sessionStore.create(
        { type: 'github', repoUrl, ref: ref ?? 'HEAD' },
        workspace.srcPath,
        initialPolicies,
      );

      runBuildWorkflow(
        runtime,
        sessionStore,
        session.id,
        workspace.srcPath,
        session.policies,
        demoMode,
        llmConfig,
        await regoRunnerPromise,
      ).catch(() => {});

      const body: ApiResponse = {
        ok: true,
        value: { sessionId: session.id, eventsUrl: `/v1/sessions/${session.id}/events` },
      };
      return c.json(body, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Clone failed';
      return c.json(
        { ok: false, error: { code: 'CLONE_ERROR', message } } satisfies ApiResponse,
        400,
      );
    }
  });

  router.get('/examples', (c) => {
    const examples = EXAMPLE_APPS.map(({ id, name, description, tags }) => ({
      id,
      name,
      description,
      tags,
    }));
    return c.json({ ok: true, value: examples } satisfies ApiResponse);
  });

  router.post('/sessions/example', async (c) => {
    const { exampleId } = await c.req.json<{ exampleId: string }>();

    if (!exampleId) {
      return c.json(
        {
          ok: false,
          error: { code: 'BAD_REQUEST', message: 'exampleId is required' },
        } satisfies ApiResponse,
        400,
      );
    }

    const example = getExample(exampleId);
    if (!example) {
      return c.json(
        {
          ok: false,
          error: { code: 'NOT_FOUND', message: `Example '${exampleId}' not found` },
        } satisfies ApiResponse,
        404,
      );
    }

    try {
      const workspace = await workspaceManager.createFromExample(example.files);
      const initialPolicies: SessionPolicies = {
        policies: globalPolicyStore.mergeWithSession(getDefaultSessionPolicies()),
        results: [],
      };
      const session = sessionStore.create(
        { type: 'example' as const, exampleId: example.id, exampleName: example.name },
        workspace.srcPath,
        initialPolicies,
      );

      runBuildWorkflow(
        runtime,
        sessionStore,
        session.id,
        workspace.srcPath,
        session.policies,
        demoMode,
        llmConfig,
        await regoRunnerPromise,
      ).catch(() => {});

      const body: ApiResponse = {
        ok: true,
        value: { sessionId: session.id, eventsUrl: `/v1/sessions/${session.id}/events` },
      };
      return c.json(body, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create example session';
      return c.json(
        { ok: false, error: { code: 'EXAMPLE_ERROR', message } } satisfies ApiResponse,
        400,
      );
    }
  });

  router.get('/policy-presets', (c) => {
    const presets = POLICY_PRESETS.map(
      ({ id, name, description, category, policy, configurable, configFields }) => ({
        id,
        name,
        description,
        category,
        target: policy.target,
        type: policy.type,
        builtinId: policy.builtinId,
        rego: policy.rego,
        defaultConfig: policy.config,
        configurable,
        configFields,
      }),
    );
    return c.json({ ok: true, value: presets } satisfies ApiResponse);
  });

  router.patch('/sessions/:id/policies', async (c) => {
    const session = sessionStore.get(c.req.param('id'));
    if (!session) {
      return c.json(
        {
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' },
        } satisfies ApiResponse,
        404,
      );
    }

    const body = await c.req.json<{ policies: Policy[] }>();
    const sessionOnly = (body.policies ?? []).filter((p: Policy) => p.scope !== 'global');
    const merged = globalPolicyStore.mergeWithSession(sessionOnly);
    sessionStore.updatePolicies(c.req.param('id'), merged);
    return c.json({
      ok: true,
      value: sessionStore.get(c.req.param('id'))?.policies,
    } satisfies ApiResponse);
  });

  router.get('/policies/global', (c) => {
    return c.json({ ok: true, value: globalPolicyStore.getAll() } satisfies ApiResponse);
  });

  router.put('/policies/global', async (c) => {
    const body = await c.req.json<{ policies: Policy[] }>();
    globalPolicyStore.setAll(body.policies ?? []);
    return c.json({ ok: true, value: globalPolicyStore.getAll() } satisfies ApiResponse);
  });

  router.post('/policies/validate', async (c) => {
    const body = await c.req.json<{ rego?: string }>().catch(() => ({ rego: undefined }));
    const source = body.rego;
    if (typeof source !== 'string' || source.trim().length === 0) {
      return c.json(
        {
          ok: false,
          error: { code: 'INVALID_INPUT', message: 'rego source is required' },
        } satisfies ApiResponse,
        400,
      );
    }

    const sidecarUrl = process.env.CA_POLICY_SERVICE_URL?.trim();
    if (!sidecarUrl) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'SIDECAR_UNAVAILABLE',
            message:
              'Custom Rego validation requires the policy sidecar. Run via docker-compose, or set CA_POLICY_SERVICE_URL.',
          },
        } satisfies ApiResponse,
        503,
      );
    }

    try {
      const res = await fetch(`${sidecarUrl.replace(/\/$/, '')}/v1/compile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rego: source }),
      });
      const text = await res.text();
      if (res.ok) {
        return c.json({ ok: true, value: { valid: true } } satisfies ApiResponse);
      }
      let detail: { message?: string; line?: number; col?: number; code?: string } = {};
      try {
        detail = JSON.parse(text) as typeof detail;
      } catch {
        detail = { message: text };
      }
      return c.json({
        ok: true,
        value: {
          valid: false,
          message: detail.message ?? 'Rego compile error',
          line: detail.line,
          col: detail.col,
          code: detail.code,
        },
      } satisfies ApiResponse);
    } catch (err) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'SIDECAR_ERROR',
            message: err instanceof Error ? err.message : 'Policy sidecar request failed',
          },
        } satisfies ApiResponse,
        502,
      );
    }
  });

  return router;
}
