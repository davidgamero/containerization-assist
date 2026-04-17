/**
 * Job Store — SQLite Persistence
 *
 * Durable storage for containerization jobs using better-sqlite3.
 * Stores job metadata, agent steps, and conversation history.
 */

import Database from 'better-sqlite3';
import type { Logger } from 'pino';
import type { Job, JobStatus, JobInput, JobListItem } from './types.js';
import type { AgentStep, LLMMessage } from '../agent/types.js';
import type { PipelineContext } from '../agent/pipeline-context.js';

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    input_json TEXT NOT NULL,
    steps_json TEXT NOT NULL DEFAULT '[]',
    messages_json TEXT NOT NULL DEFAULT '[]',
    summary TEXT,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    pipeline_context_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
`;

export interface JobStore {
  createJob(id: string, input: JobInput): Job;
  getJob(id: string): Job | null;
  listJobs(limit?: number, offset?: number): JobListItem[];
  updateJobStatus(id: string, status: JobStatus, error?: string): void;
  updateJobProgress(
    id: string,
    steps: AgentStep[],
    messages: LLMMessage[],
    totalTokens: number,
    pipelineContext?: PipelineContext | null,
  ): void;
  updateJobResult(
    id: string,
    status: JobStatus,
    steps: AgentStep[],
    messages: LLMMessage[],
    summary: string,
    totalTokens: number,
    pipelineContext?: PipelineContext | null,
    error?: string,
  ): void;
  deleteJob(id: string): boolean;
  close(): void;
}

export function createJobStore(dbPath: string, logger: Logger): JobStore {
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL');
  db.exec(CREATE_TABLES_SQL);

  logger.info({ dbPath }, 'Job store initialized');

  // Prepared statements for performance
  const insertStmt = db.prepare(`
    INSERT INTO jobs (id, status, input_json, steps_json, messages_json, summary, total_tokens, pipeline_context_json, error, created_at, updated_at)
    VALUES (?, 'pending', ?, '[]', '[]', NULL, 0, NULL, NULL, ?, ?)
  `);

  const getStmt = db.prepare('SELECT * FROM jobs WHERE id = ?');

  const listStmt = db.prepare(
    'SELECT id, status, input_json, steps_json, pipeline_context_json, summary, total_tokens, error, created_at, updated_at FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?',
  );

  const updateStatusStmt = db.prepare(
    'UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?',
  );

  const updateProgressStmt = db.prepare(
    'UPDATE jobs SET steps_json = ?, messages_json = ?, total_tokens = ?, pipeline_context_json = ?, updated_at = ? WHERE id = ?',
  );

  const updateResultStmt = db.prepare(
    'UPDATE jobs SET status = ?, steps_json = ?, messages_json = ?, summary = ?, total_tokens = ?, pipeline_context_json = ?, error = ?, updated_at = ? WHERE id = ?',
  );

  const deleteStmt = db.prepare('DELETE FROM jobs WHERE id = ?');

  function rowToJob(row: Record<string, unknown>): Job {
    return {
      id: row.id as string,
      status: row.status as JobStatus,
      input: JSON.parse(row.input_json as string) as JobInput,
      steps: JSON.parse(row.steps_json as string) as AgentStep[],
      messages: JSON.parse(row.messages_json as string) as LLMMessage[],
      summary: row.summary as string | null,
      totalTokens: row.total_tokens as number,
      pipelineContext: row.pipeline_context_json
        ? (JSON.parse(row.pipeline_context_json as string) as PipelineContext)
        : null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      error: row.error as string | null,
    };
  }

  function rowToListItem(row: Record<string, unknown>): JobListItem {
    const steps = JSON.parse(row.steps_json as string) as AgentStep[];
    const pipelineCtx = row.pipeline_context_json
      ? (JSON.parse(row.pipeline_context_json as string) as PipelineContext)
      : null;

    return {
      id: row.id as string,
      status: row.status as JobStatus,
      input: JSON.parse(row.input_json as string) as JobInput,
      stepCount: steps.length,
      summary: row.summary as string | null,
      artifactCounts: pipelineCtx
        ? {
            dockerfiles: pipelineCtx.artifacts.dockerfiles.length,
            k8sManifests: pipelineCtx.artifacts.k8sManifests.length,
            helmCharts: pipelineCtx.artifacts.helmCharts.length,
          }
        : null,
      validationIssues: pipelineCtx
        ? pipelineCtx.validations.filter((v) => !v.passed).length
        : 0,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      error: row.error as string | null,
    };
  }

  return {
    createJob(id: string, input: JobInput): Job {
      const now = new Date().toISOString();
      insertStmt.run(id, JSON.stringify(input), now, now);
      logger.debug({ jobId: id }, 'Job created');
      return {
        id,
        status: 'pending',
        input,
        steps: [],
        messages: [],
        summary: null,
        totalTokens: 0,
        pipelineContext: null,
        createdAt: now,
        updatedAt: now,
        error: null,
      };
    },

    getJob(id: string): Job | null {
      const row = getStmt.get(id) as Record<string, unknown> | undefined;
      return row ? rowToJob(row) : null;
    },

    listJobs(limit = 50, offset = 0): JobListItem[] {
      const rows = listStmt.all(limit, offset) as Array<Record<string, unknown>>;
      return rows.map(rowToListItem);
    },

    updateJobStatus(id: string, status: JobStatus, error?: string): void {
      updateStatusStmt.run(status, error ?? null, new Date().toISOString(), id);
    },

    updateJobProgress(
      id: string,
      steps: AgentStep[],
      messages: LLMMessage[],
      totalTokens: number,
      pipelineContext?: PipelineContext | null,
    ): void {
      updateProgressStmt.run(
        JSON.stringify(steps),
        JSON.stringify(messages),
        totalTokens,
        pipelineContext ? JSON.stringify(pipelineContext) : null,
        new Date().toISOString(),
        id,
      );
    },

    updateJobResult(
      id: string,
      status: JobStatus,
      steps: AgentStep[],
      messages: LLMMessage[],
      summary: string,
      totalTokens: number,
      pipelineContext?: PipelineContext | null,
      error?: string,
    ): void {
      updateResultStmt.run(
        status,
        JSON.stringify(steps),
        JSON.stringify(messages),
        summary,
        totalTokens,
        pipelineContext ? JSON.stringify(pipelineContext) : null,
        error ?? null,
        new Date().toISOString(),
        id,
      );
    },

    deleteJob(id: string): boolean {
      const result = deleteStmt.run(id);
      return result.changes > 0;
    },

    close(): void {
      db.close();
      logger.info('Job store closed');
    },
  };
}
