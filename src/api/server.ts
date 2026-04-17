/**
 * Containerization Assist — HTTP API Server
 *
 * Fastify-based REST API that wraps the SDK executor and provides:
 * - Tool execution endpoints (11 containerization tools)
 * - AI agent loop for autonomous containerization pipelines
 * - Job queue with SQLite persistence
 * - Health/readiness probes for Kubernetes
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createApp } from '@/app/index.js';
import { createLogger } from '@/lib/logger.js';
import { createJobStore } from './jobs/store.js';
import { createJobQueue } from './jobs/queue.js';
import { createLLMClient } from './agent/llm-client.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerToolRoutes } from './routes/tools.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerAgentRoutes } from './routes/agent.js';
import { registerPolicyRoutes } from './routes/policy.js';
import { authMiddleware } from './middleware/auth.js';
import { DEFAULT_AGENT_CONFIG } from './agent/types.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), '.data');

async function main(): Promise<void> {
  const logger = createLogger({ name: 'api-server' });

  // Ensure data directory exists for SQLite
  mkdirSync(DATA_DIR, { recursive: true });

  // Validate LLM configuration
  const baseUrl = process.env.OPENAI_BASE_URL;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!baseUrl || !apiKey) {
    logger.warn(
      'OPENAI_BASE_URL and OPENAI_API_KEY are not set. Agent loop will not be available. ' +
        'Tool execution endpoints will still work.',
    );
  }

  // Create the core application runtime
  const app = createApp({ logger });
  logger.info('Application runtime created');

  // Create LLM client (if configured)
  const agentConfig = {
    baseUrl: baseUrl || '',
    apiKey: apiKey || '',
    model: process.env.OPENAI_MODEL || DEFAULT_AGENT_CONFIG.model,
    apiVersion: process.env.OPENAI_API_VERSION,
    maxIterations: DEFAULT_AGENT_CONFIG.maxIterations,
    temperature: DEFAULT_AGENT_CONFIG.temperature,
  };

  const llmClient = createLLMClient(agentConfig, logger);

  // Create job store and queue
  const dbPath = join(DATA_DIR, 'jobs.db');
  const jobStore = createJobStore(dbPath, logger);
  const jobQueue = createJobQueue(jobStore, app, llmClient, logger);

  // Create Fastify instance
  const fastify = Fastify({
    logger: false, // We use our own pino logger
  });

  // Register CORS
  await fastify.register(cors, {
    origin: true, // Allow all origins (configure for production)
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });

  // Register multipart for file uploads (zip/tar.gz)
  await fastify.register(multipart, {
    limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB max
  });

  // Register auth middleware
  fastify.addHook('onRequest', authMiddleware);

  // Register routes
  registerHealthRoutes(fastify, app);
  registerToolRoutes(fastify, app);
  registerJobRoutes(fastify, jobQueue);
  registerAgentRoutes(fastify, jobQueue, logger);
  registerPolicyRoutes(fastify, logger);

  // Configuration endpoint (sanitized)
  fastify.get('/api/config', async () => {
    const health = await app.healthCheck();
    return {
      tools: app.listTools().map((t) => t.name),
      toolCount: health.tools,
      dependencies: health.dependencies,
      llm: {
        configured: !!baseUrl && !!apiKey,
        model: agentConfig.model,
        baseUrl: baseUrl ? new URL(baseUrl).hostname : null,
      },
    };
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    jobQueue.shutdown();
    await app.stop();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Start the server
  try {
    await fastify.listen({ port: PORT, host: HOST });
    logger.info({ port: PORT, host: HOST }, 'API server started');

    const health = await app.healthCheck();
    logger.info(
      {
        tools: health.tools,
        docker: health.dependencies?.docker?.available,
        kubernetes: health.dependencies?.kubernetes?.available,
        llmConfigured: !!baseUrl && !!apiKey,
      },
      'Server ready',
    );
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

void main();
