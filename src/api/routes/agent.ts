/**
 * Agent Loop Routes
 *
 * Endpoint for starting an AI-driven containerization pipeline.
 * Supports three repo source modes:
 *   1. repositoryUrl (git clone — public or private with token)
 *   2. /api/agent/upload (multipart file upload — zip/tar.gz)
 *   3. repositoryPath (local filesystem — dev/testing)
 */

import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { JobQueue } from '../jobs/queue.js';
import type { JobCreateRequest } from '../jobs/types.js';
import { cloneRepo, extractUpload, resolveLocalPath } from '../repos/ingestion.js';

export function registerAgentRoutes(
  fastify: FastifyInstance,
  jobQueue: JobQueue,
  logger: Logger,
): void {
  // Start an AI agent loop job (JSON body — git clone or local path)
  fastify.post<{ Body: JobCreateRequest }>('/api/agent/run', async (request, reply) => {
    const { repositoryUrl, repositoryPath, gitRef, gitToken, registry, namespace, imageName, clusterName, resourceGroup } =
      request.body;

    if (!registry || !namespace) {
      return reply.status(400).send({ error: 'Missing required fields: registry, namespace' });
    }

    if (!repositoryUrl && !repositoryPath) {
      return reply.status(400).send({
        error: 'Provide either repositoryUrl (git URL) or repositoryPath (local path)',
      });
    }

    try {
      // Resolve repo source
      const source = repositoryUrl
        ? await cloneRepo({ url: repositoryUrl, ref: gitRef, token: gitToken }, logger)
        : await resolveLocalPath(repositoryPath!, logger);

      const job = jobQueue.createJob({
        repositoryPath: source.localPath,
        registry,
        namespace,
        imageName,
        clusterName,
        resourceGroup,
        sourceType: source.type,
        gitUrl: source.gitUrl,
        gitRef: source.gitRef,
      });

      return reply.status(202).send({
        jobId: job.id,
        status: job.status,
        source: {
          type: source.type,
          gitUrl: source.gitUrl,
          localPath: source.localPath,
        },
        message: 'Agent loop job created and queued',
        pollUrl: `/api/jobs/${job.id}`,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ error: msg }, 'Failed to ingest repository');
      return reply.status(422).send({ error: `Repository ingestion failed: ${msg}` });
    }
  });

  // Upload a zip/tar.gz and start a job
  fastify.post('/api/agent/upload', async (request, reply) => {
    const parts = request.parts();
    let fileStream: NodeJS.ReadableStream | null = null;
    let filename = '';
    const fields: Record<string, string> = {};

    for await (const part of parts) {
      if (part.type === 'file') {
        fileStream = part.file;
        filename = part.filename;
      } else {
        fields[part.fieldname] = (part as { value: string }).value;
      }
    }

    if (!fileStream || !filename) {
      return reply.status(400).send({ error: 'No file uploaded. Send a zip or tar.gz archive.' });
    }

    if (!fields.registry || !fields.namespace) {
      return reply.status(400).send({ error: 'Missing required fields: registry, namespace' });
    }

    try {
      const source = await extractUpload(fileStream, filename, logger);

      const job = jobQueue.createJob({
        repositoryPath: source.localPath,
        registry: fields.registry,
        namespace: fields.namespace,
        imageName: fields.imageName,
        clusterName: fields.clusterName,
        resourceGroup: fields.resourceGroup,
        sourceType: source.type,
      });

      return reply.status(202).send({
        jobId: job.id,
        status: job.status,
        source: { type: 'upload', filename },
        message: 'Archive extracted and job queued',
        pollUrl: `/api/jobs/${job.id}`,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ error: msg }, 'Upload extraction failed');
      return reply.status(422).send({ error: msg });
    }
  });
}
