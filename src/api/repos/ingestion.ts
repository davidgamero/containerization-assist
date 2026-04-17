/**
 * Repository Ingestion
 *
 * Gets repository contents into the container for the pipeline to work on.
 * Supports three modes:
 *
 * 1. **Git clone** — Public repos work without auth. Private repos use a
 *    GitHub token (PAT or GitHub App installation token) injected into the
 *    HTTPS URL.  Shallow-clones by default for speed.
 *
 * 2. **Zip/tar upload** — Multipart file upload extracted into a temp dir.
 *
 * 3. **Local path** — For dev/testing when the repo is already on disk.
 */

import { execFile } from 'node:child_process';
import { promises as fs, createWriteStream } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import * as tar from 'tar';
import type { Logger } from 'pino';
import type { RepoSource, GitCloneOptions } from './types.js';

const WORKSPACES_DIR = process.env.WORKSPACES_DIR || join(process.cwd(), '.data', 'workspaces');

function ensureWorkspacesDir(): void {
  fs.mkdir(WORKSPACES_DIR, { recursive: true }).catch(() => {});
}

/**
 * Clone a Git repository into a temp workspace directory.
 *
 * Public repos need no token.  For private repos pass a GitHub PAT or
 * GitHub App installation token — it is injected into the HTTPS URL as
 * `https://x-access-token:<token>@github.com/...`.
 */
export async function cloneRepo(
  options: GitCloneOptions,
  logger: Logger,
): Promise<RepoSource> {
  ensureWorkspacesDir();

  const workDir = join(WORKSPACES_DIR, `git-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(workDir, { recursive: true });

  // Build the clone URL — inject token for private repos
  let cloneUrl = options.url;
  if (options.token) {
    try {
      const parsed = new URL(cloneUrl);
      parsed.username = 'x-access-token';
      parsed.password = options.token;
      cloneUrl = parsed.toString();
    } catch {
      // If URL parsing fails (e.g., SSH URL), skip token injection
      logger.warn('Could not inject token into URL — attempting clone without auth');
    }
  }

  const args = ['clone', '--single-branch'];

  // Shallow clone by default
  const depth = options.depth ?? 1;
  if (depth > 0) {
    args.push('--depth', String(depth));
  }

  if (options.ref) {
    args.push('--branch', options.ref);
  }

  args.push(cloneUrl, workDir);

  logger.info(
    { url: options.url, ref: options.ref, depth, workDir, hasToken: !!options.token },
    'Cloning repository',
  );

  await execPromise('git', args, logger);

  // Determine the repo name from the URL
  const repoName = basename(options.url).replace(/\.git$/, '');
  logger.info({ workDir, repoName }, 'Repository cloned successfully');

  return {
    type: 'git',
    gitUrl: options.url,
    gitRef: options.ref,
    localPath: workDir,
    isTemp: true,
  };
}

/**
 * Extract an uploaded zip or tar.gz archive into a temp workspace.
 */
export async function extractUpload(
  fileStream: NodeJS.ReadableStream,
  filename: string,
  logger: Logger,
): Promise<RepoSource> {
  ensureWorkspacesDir();

  const workDir = join(WORKSPACES_DIR, `upload-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(workDir, { recursive: true });

  const lower = filename.toLowerCase();

  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    logger.info({ filename, workDir }, 'Extracting tar.gz upload');
    await pipeline(fileStream, createGunzip(), tar.extract({ cwd: workDir, strip: 1 }));
  } else if (lower.endsWith('.tar')) {
    logger.info({ filename, workDir }, 'Extracting tar upload');
    await pipeline(fileStream, tar.extract({ cwd: workDir, strip: 1 }));
  } else if (lower.endsWith('.zip')) {
    // Write zip to disk then extract (node doesn't have streaming zip extract)
    const zipPath = join(workDir, '_upload.zip');
    logger.info({ filename, workDir }, 'Extracting zip upload');
    await pipeline(fileStream, createWriteStream(zipPath));
    await execPromise('unzip', ['-o', '-q', zipPath, '-d', workDir], logger);
    await fs.unlink(zipPath).catch(() => {});

    // If the zip contained a single top-level directory, use that as root
    const entries = await fs.readdir(workDir);
    if (entries.length === 1) {
      const singleDir = join(workDir, entries[0]!);
      const stat = await fs.stat(singleDir);
      if (stat.isDirectory()) {
        return {
          type: 'upload',
          uploadFilename: filename,
          localPath: singleDir,
          isTemp: true,
        };
      }
    }
  } else {
    throw new Error(
      `Unsupported archive format: ${filename}. Use .zip, .tar.gz, or .tgz`,
    );
  }

  return {
    type: 'upload',
    uploadFilename: filename,
    localPath: workDir,
    isTemp: true,
  };
}

/**
 * Validate a local path exists and return a RepoSource for it.
 */
export async function resolveLocalPath(
  localPath: string,
  logger: Logger,
): Promise<RepoSource> {
  try {
    const stat = await fs.stat(localPath);
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${localPath}`);
    }
  } catch (error) {
    throw new Error(
      `Local path not accessible: ${localPath} — ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  logger.info({ localPath }, 'Using local repository path');

  return {
    type: 'local',
    localPath,
    isTemp: false,
  };
}

/**
 * Clean up a temporary workspace directory.
 */
export async function cleanupWorkspace(source: RepoSource, logger: Logger): Promise<void> {
  if (!source.isTemp) return;

  try {
    await fs.rm(source.localPath, { recursive: true, force: true });
    logger.debug({ path: source.localPath }, 'Cleaned up workspace');
  } catch (error) {
    logger.warn({ path: source.localPath, error }, 'Failed to clean up workspace');
  }
}

// --- Helpers ---

function execPromise(cmd: string, args: string[], logger: Logger): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 50 * 1024 * 1024, timeout: 120_000 }, (error, stdout, stderr) => {
      if (error) {
        // Redact tokens from error messages
        const safeMsg = (stderr || error.message).replace(
          /x-access-token:[^@]+@/g,
          'x-access-token:***@',
        );
        logger.error({ cmd, error: safeMsg }, 'Command failed');
        reject(new Error(`${cmd} failed: ${safeMsg}`));
        return;
      }
      resolve(stdout);
    });
  });
}
