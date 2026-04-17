/**
 * Job Types
 *
 * Type definitions for the containerization job queue.
 */

import type { AgentStep, LLMMessage } from '../agent/types.js';
import type { PipelineContext } from '../agent/pipeline-context.js';
import type { RepoSourceType } from '../repos/types.js';

export type JobStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

export interface JobInput {
  /** Resolved local path (populated after ingestion) */
  repositoryPath: string;
  registry: string;
  namespace: string;
  imageName?: string | undefined;
  clusterName?: string | undefined;
  resourceGroup?: string | undefined;
  /** How the repo was provided */
  sourceType?: RepoSourceType | undefined;
  /** Original git URL if cloned */
  gitUrl?: string | undefined;
  /** Git ref that was checked out */
  gitRef?: string | undefined;
}

export interface Job {
  id: string;
  status: JobStatus;
  input: JobInput;
  steps: AgentStep[];
  messages: LLMMessage[];
  summary: string | null;
  totalTokens: number;
  pipelineContext: PipelineContext | null;
  createdAt: string;
  updatedAt: string;
  error: string | null;
}

export interface JobCreateRequest {
  /** Git URL (public or private), or local path */
  repositoryUrl?: string;
  /** Local filesystem path (dev/testing only) */
  repositoryPath?: string;
  /** Git ref: branch, tag, or commit */
  gitRef?: string;
  /** GitHub token for private repos (PAT or app installation token) */
  gitToken?: string;
  registry: string;
  namespace: string;
  imageName?: string;
  clusterName?: string;
  resourceGroup?: string;
}

export interface JobListItem {
  id: string;
  status: JobStatus;
  input: JobInput;
  stepCount: number;
  summary: string | null;
  /** Counts of existing artifacts found */
  artifactCounts: {
    dockerfiles: number;
    k8sManifests: number;
    helmCharts: number;
  } | null;
  /** Number of validation issues found across stages */
  validationIssues: number;
  createdAt: string;
  updatedAt: string;
  error: string | null;
}
