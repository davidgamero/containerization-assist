/**
 * HTTP API Server
 *
 * Creates a Hono application wired to an AppRuntime instance.
 * All tool calls flow through the orchestrator so policy enforcement,
 * validation, and logging are preserved.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { serve } from '@hono/node-server';
import type { AppRuntime } from '@/types/runtime';
import type { HonoEnv } from './types';
import { healthRoutes } from './routes/health';
import { toolRoutes } from './routes/tools';
import { sessionRoutes } from './routes/sessions';
import { authRoutes } from './routes/auth';
import { eventRoutes } from './routes/events';
import { errorHandler } from './middleware/error-handler';
import { SessionStore } from './sessions/store';
import { WorkspaceManager } from './workspace/manager';
import { GlobalPolicyStore } from './policies/global-store';
import { createRegoRunner } from './policies/rego-runner';
import type { LlmConfig } from './types';

export interface HttpServerOptions {
  port?: number;
  host?: string;
  corsOrigin?: string;
  githubClientId?: string | undefined;
  githubClientSecret?: string | undefined;
  llmApiKey?: string | undefined;
  llmBaseUrl?: string | undefined;
  llmModel?: string | undefined;
}

export interface HttpServer {
  app: Hono<HonoEnv>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Create the Hono-based HTTP server wired to the given AppRuntime.
 */
export function createHttpServer(runtime: AppRuntime, options: HttpServerOptions = {}): HttpServer {
  const {
    port = 3000,
    host = '0.0.0.0',
    corsOrigin = '*',
    githubClientId,
    githubClientSecret,
    llmApiKey,
    llmBaseUrl,
    llmModel,
  } = options;

  const demoMode = !githubClientId;
  const llmConfig: LlmConfig | undefined =
    llmApiKey && llmBaseUrl && llmModel
      ? { apiKey: llmApiKey, baseUrl: llmBaseUrl, model: llmModel }
      : undefined;

  const sessionStore = new SessionStore();
  const workspaceManager = new WorkspaceManager();
  const globalPolicyStore = new GlobalPolicyStore();
  const regoRunnerPromise = createRegoRunner((msg) => console.error(`[policies] ${msg}`));

  const app = new Hono<HonoEnv>();

  // ---------- Global middleware ----------
  app.use('*', honoLogger());
  app.use(
    '*',
    cors({
      origin: corsOrigin,
      allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
      credentials: true,
    }),
  );
  app.use('*', errorHandler());

  // Inject runtime into every request context.
  app.use('*', async (c, next) => {
    c.set('runtime', runtime);
    await next();
  });

  // ---------- Routes ----------
  app.route('/v1', healthRoutes(runtime, demoMode));
  app.route('/v1', toolRoutes());
  app.route(
    '/v1',
    sessionRoutes(
      runtime,
      sessionStore,
      workspaceManager,
      {
        githubClientId: githubClientId ?? '',
        githubClientSecret: githubClientSecret ?? '',
        demoMode,
        llmConfig,
        regoRunnerPromise,
      },
      globalPolicyStore,
    ),
  );
  app.route('/v1', eventRoutes(sessionStore));
  app.route(
    '/v1/auth',
    authRoutes({
      githubClientId: githubClientId ?? '',
      githubClientSecret: githubClientSecret ?? '',
    }),
  );

  let nodeServer: ReturnType<typeof serve> | undefined;

  return {
    app,
    async start() {
      workspaceManager.startSweeper();

      return new Promise<void>((resolve) => {
        nodeServer = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
          console.error(`🚀 API server listening on http://${host}:${info.port}`);
          resolve();
        });
      });
    },
    async stop() {
      workspaceManager.stopSweeper();
      await workspaceManager.cleanupAll();
      if (nodeServer) {
        nodeServer.close();
        nodeServer = undefined;
      }
    },
  };
}
