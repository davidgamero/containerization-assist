/**
 * Job Management Routes
 *
 * CRUD endpoints for containerization jobs.
 */

import type { FastifyInstance } from 'fastify';
import type { JobQueue } from '../jobs/queue.js';
import type { JobCreateRequest } from '../jobs/types.js';

export function registerJobRoutes(
  fastify: FastifyInstance,
  jobQueue: JobQueue,
): void {
  // Create a new containerization job (prefer /api/agent/run for git clone support)
  fastify.post<{ Body: JobCreateRequest }>('/api/jobs', async (request, reply) => {
    const { repositoryUrl, repositoryPath, registry, namespace, imageName, clusterName, resourceGroup } =
      request.body;

    if ((!repositoryUrl && !repositoryPath) || !registry || !namespace) {
      return reply.status(400).send({
        error: 'Missing required fields: (repositoryUrl or repositoryPath), registry, namespace',
      });
    }

    const job = jobQueue.createJob({
      repositoryPath: repositoryPath || repositoryUrl || '',
      registry,
      namespace,
      imageName,
      clusterName,
      resourceGroup,
    });

    return reply.status(201).send(job);
  });

  // List all jobs
  fastify.get<{
    Querystring: { limit?: string; offset?: string };
  }>('/api/jobs', async (request) => {
    const limit = parseInt(request.query.limit || '50', 10);
    const offset = parseInt(request.query.offset || '0', 10);

    const jobs = jobQueue.listJobs(limit, offset);
    return { jobs, limit, offset };
  });

  // Get a specific job by ID
  fastify.get<{ Params: { id: string } }>('/api/jobs/:id', async (request, reply) => {
    const job = jobQueue.getJob(request.params.id);

    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    return job;
  });

  // Cancel a running job
  fastify.post<{ Params: { id: string } }>('/api/jobs/:id/cancel', async (request, reply) => {
    const cancelled = jobQueue.cancelJob(request.params.id);

    if (!cancelled) {
      return reply.status(404).send({
        error: 'Job not found or not in a cancellable state',
      });
    }

    return { success: true, message: 'Job cancelled' };
  });

  // Delete a completed job
  fastify.delete<{ Params: { id: string } }>('/api/jobs/:id', async (request, reply) => {
    const deleted = jobQueue.deleteJob(request.params.id);

    if (!deleted) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    return { success: true, message: 'Job deleted' };
  });
}
