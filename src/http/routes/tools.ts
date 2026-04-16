/**
 * Generic tool execution route.
 *
 * POST /v1/tools/:toolName  — execute any registered tool with JSON params.
 *
 * All calls flow through AppRuntime.execute() which applies Zod validation,
 * OPA policy enforcement, knowledge loading, and consistent logging.
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type { HonoEnv, ApiResponse } from '../types';

export function toolRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/tools/:toolName', async (c) => {
    const runtime = c.get('runtime');
    const toolName = c.req.param('toolName');
    const body = await c.req.json().catch(() => ({}));

    const params = body.params ?? body;
    const requestId = c.req.header('x-request-id') ?? randomUUID();

    const controller = new AbortController();
    c.req.raw.signal.addEventListener('abort', () => controller.abort());

    const result = await runtime.execute(toolName as never, params as never, {
      transport: 'http',
      requestId,
      signal: controller.signal,
    });

    if (!result.ok) {
      const response: ApiResponse = {
        ok: false,
        error: {
          code: 'TOOL_ERROR',
          message: result.error,
          ...(result.guidance && { details: result.guidance.hint }),
        },
      };
      return c.json(response, 400);
    }

    const response: ApiResponse = { ok: true, value: result.value };
    return c.json(response);
  });

  return router;
}
