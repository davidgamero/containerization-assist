/**
 * Repository Source Types
 *
 * Defines how repositories are provided to the containerization pipeline.
 */

export type RepoSourceType = 'git' | 'upload' | 'local';

export interface RepoSource {
  /** How the repo was provided */
  type: RepoSourceType;
  /** Git URL (for git sources) */
  gitUrl?: string | undefined;
  /** Git ref to checkout (branch, tag, commit) */
  gitRef?: string | undefined;
  /** Original filename (for uploads) */
  uploadFilename?: string | undefined;
  /** Local filesystem path to the repo working directory */
  localPath: string;
  /** Whether this is a temp directory that should be cleaned up */
  isTemp: boolean;
}

export interface GitCloneOptions {
  /** Repository URL (HTTPS or SSH) */
  url: string;
  /** Branch, tag, or commit to checkout */
  ref?: string | undefined;
  /** GitHub personal access token or app installation token */
  token?: string | undefined;
  /** Shallow clone depth (default: 1) */
  depth?: number | undefined;
}
