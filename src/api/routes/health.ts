/**
 * Health Routes
 *
 * Liveness and readiness probe endpoints for Kubernetes.
 */

import type { FastifyInstance } from 'fastify';
import type { AppRuntime } from '@/types/runtime.js';

export function registerHealthRoutes(
  fastify: FastifyInstance,
  app: AppRuntime,
): void {
  // Liveness probe — always returns 200 if the process is alive
  fastify.get('/health', async () => {
    return { status: 'ok' };
  });

  // Readiness probe — checks Docker + K8s connectivity
  fastify.get('/ready', async (_request, reply) => {
    const health = await app.healthCheck();
    const statusCode = health.status === 'healthy' ? 200 : 503;

    return reply.status(statusCode).send({
      status: health.status,
      tools: health.tools,
      message: health.message,
      dependencies: health.dependencies,
    });
  });
}
