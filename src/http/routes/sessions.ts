import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppRuntime } from '@/types/runtime';
import type { HonoEnv, ApiResponse, LlmConfig, SessionPolicies } from '../types';
import type { SessionStore } from '../sessions/store';
import type { WorkspaceManager } from '../workspace/manager';
import { runBuildWorkflow } from '../workflows/build-workflow';
import { EXAMPLE_APPS, getExample } from '../examples/catalog';
import { POLICY_PRESETS } from '../policies/presets';

interface SessionRouteConfig {
  githubClientId?: string | undefined;
  githubClientSecret?: string | undefined;
  demoMode?: boolean | undefined;
  llmConfig?: LlmConfig | undefined;
}

export function sessionRoutes(
  runtime: AppRuntime,
  sessionStore: SessionStore,
  workspaceManager: WorkspaceManager,
  _config: SessionRouteConfig,
): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const demoMode = _config.demoMode ?? false;
  const llmConfig = _config.llmConfig;

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
      const session = sessionStore.create({ type: 'zip', filename }, workspace.srcPath);

      runBuildWorkflow(
        runtime,
        sessionStore,
        session.id,
        workspace.srcPath,
        session.policies,
        demoMode,
        llmConfig,
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
      const session = sessionStore.create(
        { type: 'github', repoUrl, ref: ref ?? 'HEAD' },
        workspace.srcPath,
      );

      runBuildWorkflow(
        runtime,
        sessionStore,
        session.id,
        workspace.srcPath,
        session.policies,
        demoMode,
        llmConfig,
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
      const session = sessionStore.create(
        { type: 'example' as const, exampleId: example.id, exampleName: example.name },
        workspace.srcPath,
      );

      runBuildWorkflow(
        runtime,
        sessionStore,
        session.id,
        workspace.srcPath,
        session.policies,
        demoMode,
        llmConfig,
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
      ({ id, name, description, category, configurable, configFields }) => ({
        id,
        name,
        description,
        category,
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

    const body = await c.req.json<SessionPolicies>();
    sessionStore.updatePolicies(c.req.param('id'), body);
    return c.json({
      ok: true,
      value: sessionStore.get(c.req.param('id'))?.policies,
    } satisfies ApiResponse);
  });

  return router;
}
