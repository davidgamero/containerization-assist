/**
 * Health & metadata routes.
 *
 * GET /v1/livez    — lightweight liveness probe (process is up)
 * GET /v1/health   — runtime health check (Docker, K8s connectivity)
 * GET /v1/tools    — list registered tools with schemas
 */

import { Hono } from 'hono';
import type { AppRuntime } from '@/types/runtime';
import type { HonoEnv, ApiResponse } from '../types';

export function healthRoutes(runtime: AppRuntime, demoMode = false): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/livez', (c) => {
    return c.json({ ok: true, value: { status: 'alive' } });
  });

  router.get('/config', (c) => {
    return c.json({
      ok: true,
      value: { demoMode },
    } satisfies ApiResponse);
  });

  router.get('/health', async (c) => {
    const health = await runtime.healthCheck();
    const status = health.status === 'healthy' ? 200 : 503;
    const body: ApiResponse<typeof health> = { ok: health.status === 'healthy', value: health };
    return c.json(body, status as 200);
  });

  router.get('/tools', (c) => {
    const tools = runtime.listTools();
    const body: ApiResponse<typeof tools> = { ok: true, value: tools };
    return c.json(body);
  });

  return router;
}
