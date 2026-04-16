/**
 * Global error handler middleware.
 * Catches unhandled exceptions and returns a consistent JSON envelope.
 */

import type { MiddlewareHandler } from 'hono';
import type { HonoEnv, ApiResponse } from '../types';

export function errorHandler(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    try {
      await next();
      return undefined;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      const status = (err as { status?: number }).status ?? 500;

      const body: ApiResponse = {
        ok: false,
        error: {
          code: status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
          message,
        },
      };

      return c.json(body, status as 400);
    }
  };
}
