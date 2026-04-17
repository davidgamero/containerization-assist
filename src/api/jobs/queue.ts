/**
 * Job Queue Manager
 *
 * In-memory job queue backed by SQLite persistence.
 * Processes containerization jobs by running the AI agent loop.
 */

import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { AppRuntime } from '@/types/runtime.js';
import type { JobStore } from './store.js';
import type { Job, JobInput, JobListItem } from './types.js';
import type { LLMClient } from '../agent/llm-client.js';
import { runAgentLoop } from '../agent/agent-loop.js';

export interface JobQueue {
  createJob(input: JobInput): Job;
  getJob(id: string): Job | null;
  listJobs(limit?: number, offset?: number): JobListItem[];
  cancelJob(id: string): boolean;
  deleteJob(id: string): boolean;
  shutdown(): void;
}

export function createJobQueue(
  store: JobStore,
  app: AppRuntime,
  llmClient: LLMClient,
  logger: Logger,
  maxConcurrent = 1,
): JobQueue {
  const runningJobs = new Map<string, AbortController>();
  let processingCount = 0;
  const pendingQueue: string[] = [];

  function processNext(): void {
    if (processingCount >= maxConcurrent || pendingQueue.length === 0) {
      return;
    }

    const jobId = pendingQueue.shift();
    if (!jobId) {
      return;
    }
    const job = store.getJob(jobId);

    if (!job?.status || job.status !== 'pending') {
      processNext();
      return;
    }

    processingCount++;
    const abortController = new AbortController();
    runningJobs.set(jobId, abortController);

    store.updateJobStatus(jobId, 'running');
    logger.info({ jobId }, 'Starting job processing');

    runAgentLoop(
      app,
      llmClient,
      job.input,
      {
        maxIterations: 30,
        signal: abortController.signal,
        onStep: (step) => {
          const currentJob = store.getJob(jobId);
          if (currentJob) {
            const steps = [...currentJob.steps, step];
            store.updateJobProgress(
              jobId,
              steps,
              currentJob.messages,
              currentJob.totalTokens,
              currentJob.pipelineContext,
            );
          }
        },
        onPipelineUpdate: (pipelineCtx) => {
          const currentJob = store.getJob(jobId);
          if (currentJob) {
            store.updateJobProgress(
              jobId,
              currentJob.steps,
              currentJob.messages,
              currentJob.totalTokens,
              pipelineCtx,
            );
          }
        },
      },
      logger,
    )
      .then((result) => {
        store.updateJobResult(
          jobId,
          result.success ? 'success' : 'failed',
          result.steps,
          result.messages,
          result.summary,
          result.totalTokens,
          result.pipelineContext,
          result.error,
        );
        logger.info(
          { jobId, success: result.success, steps: result.steps.length },
          'Job completed',
        );
      })
      .catch((error) => {
        const errorMsg = error instanceof Error ? error.message : String(error);
        store.updateJobStatus(jobId, 'failed', errorMsg);
        logger.error({ jobId, error: errorMsg }, 'Job failed with unhandled error');
      })
      .finally(() => {
        runningJobs.delete(jobId);
        processingCount--;
        processNext();
      });
  }

  return {
    createJob(input: JobInput): Job {
      const id = randomUUID();
      const job = store.createJob(id, input);
      pendingQueue.push(id);
      logger.info({ jobId: id, input }, 'Job queued');
      processNext();
      return job;
    },

    getJob(id: string): Job | null {
      return store.getJob(id);
    },

    listJobs(limit?: number, offset?: number): JobListItem[] {
      return store.listJobs(limit, offset);
    },

    cancelJob(id: string): boolean {
      const controller = runningJobs.get(id);
      if (controller) {
        controller.abort();
        store.updateJobStatus(id, 'cancelled', 'Cancelled by user');
        runningJobs.delete(id);
        logger.info({ jobId: id }, 'Job cancelled');
        return true;
      }

      // Check if it's in the pending queue
      const pendingIndex = pendingQueue.indexOf(id);
      if (pendingIndex !== -1) {
        pendingQueue.splice(pendingIndex, 1);
        store.updateJobStatus(id, 'cancelled', 'Cancelled before processing');
        logger.info({ jobId: id }, 'Pending job cancelled');
        return true;
      }

      return false;
    },

    deleteJob(id: string): boolean {
      // Cancel first if running
      this.cancelJob(id);
      return store.deleteJob(id);
    },

    shutdown(): void {
      logger.info('Shutting down job queue');
      for (const [jobId, controller] of runningJobs) {
        controller.abort();
        store.updateJobStatus(jobId, 'failed', 'Server shutdown');
      }
      runningJobs.clear();
      pendingQueue.length = 0;
      store.close();
    },
  };
}
