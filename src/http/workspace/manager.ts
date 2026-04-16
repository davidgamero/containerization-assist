import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { extract as tarExtract } from 'tar';

const MAX_UPLOAD_BYTES = 250 * 1024 * 1024; // 250 MB
const MAX_EXTRACTED_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const MAX_FILES = 50_000;
const WORKSPACE_TTL_MS = 30 * 60 * 1000; // 30 min
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 min

interface WorkspaceMetadata {
  id: string;
  createdAt: number;
  srcPath: string;
}

export class WorkspaceManager {
  private workspaces = new Map<string, WorkspaceMetadata>();
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(tmpdir(), 'containerization-assist');
  }

  async createFromZipStream(
    stream: ReadableStream<Uint8Array>,
    _filename: string,
  ): Promise<WorkspaceMetadata> {
    const id = randomUUID();
    const wsDir = join(this.baseDir, id);
    const srcDir = join(wsDir, 'src');
    const zipPath = join(wsDir, 'upload.zip');

    await fs.mkdir(srcDir, { recursive: true });

    // Stream zip to disk with size enforcement.
    let written = 0;
    const dest = createWriteStream(zipPath);
    const reader = stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        written += value.byteLength;
        if (written > MAX_UPLOAD_BYTES) {
          dest.destroy();
          await fs.rm(wsDir, { recursive: true, force: true });
          throw new Error(`Upload exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit`);
        }
        dest.write(value);
      }
      await new Promise<void>((res) => dest.end(() => res()));
    } catch (err) {
      dest.destroy();
      throw err;
    }

    // Extract using tar (Node built-in handles .tar.gz; for zip we shell out).
    await this.extractZip(zipPath, srcDir);
    await fs.rm(zipPath, { force: true });

    const meta: WorkspaceMetadata = { id, createdAt: Date.now(), srcPath: srcDir };
    this.workspaces.set(id, meta);
    return meta;
  }

  async createFromGitHub(repoUrl: string, token: string, ref = 'HEAD'): Promise<WorkspaceMetadata> {
    const id = randomUUID();
    const wsDir = join(this.baseDir, id);
    const srcDir = join(wsDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    // Parse owner/repo from URL.
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
    if (!match) throw new Error(`Invalid GitHub URL: ${repoUrl}`);
    const [, owner, repo] = match;

    const archiveUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`;
    const response = await fetch(archiveUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'containerization-assist',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      await fs.rm(wsDir, { recursive: true, force: true });
      throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`);
    }

    // GitHub returns .tar.gz — extract directly via streaming.
    const tarPath = join(wsDir, 'repo.tar.gz');
    const dest = createWriteStream(tarPath);
    // @ts-expect-error ReadableStream compatibility between web and node
    await pipeline(response.body, dest);

    await tarExtract({ file: tarPath, cwd: srcDir, strip: 1 });
    await fs.rm(tarPath, { force: true });

    const meta: WorkspaceMetadata = { id, createdAt: Date.now(), srcPath: srcDir };
    this.workspaces.set(id, meta);
    return meta;
  }

  async createFromExample(files: Record<string, string>): Promise<WorkspaceMetadata> {
    const id = randomUUID();
    const wsDir = join(this.baseDir, id);
    const srcDir = join(wsDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = join(srcDir, filePath);
      await fs.mkdir(resolve(fullPath, '..'), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
    }

    const meta: WorkspaceMetadata = { id, createdAt: Date.now(), srcPath: srcDir };
    this.workspaces.set(id, meta);
    return meta;
  }

  getPath(id: string): string | undefined {
    return this.workspaces.get(id)?.srcPath;
  }

  async cleanup(id: string): Promise<void> {
    const meta = this.workspaces.get(id);
    if (!meta) return;
    const wsDir = resolve(meta.srcPath, '..');
    await fs.rm(wsDir, { recursive: true, force: true }).catch(() => {});
    this.workspaces.delete(id);
  }

  async cleanupAll(): Promise<void> {
    const ids = Array.from(this.workspaces.keys());
    await Promise.all(ids.map((id) => this.cleanup(id)));
  }

  startSweeper(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, meta] of this.workspaces) {
        if (now - meta.createdAt > WORKSPACE_TTL_MS) {
          this.cleanup(id).catch(() => {});
        }
      }
    }, SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  stopSweeper(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  private async extractZip(zipPath: string, destDir: string): Promise<void> {
    // Use unzip CLI as a pragmatic v1 approach. Avoids heavy JS zip libraries.
    // Falls back to `tar` for .tar.gz files.
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    try {
      await execFileAsync('unzip', ['-o', '-q', zipPath, '-d', destDir]);
    } catch {
      // If unzip unavailable, try as .tar.gz
      try {
        await tarExtract({ file: zipPath, cwd: destDir, strip: 1 });
      } catch (tarErr) {
        throw new Error(
          `Failed to extract archive. Ensure 'unzip' is installed or upload .tar.gz. ${tarErr}`,
        );
      }
    }

    // ZipSlip protection: verify all extracted paths are under destDir.
    await this.validateExtractedPaths(destDir);
  }

  private async validateExtractedPaths(destDir: string): Promise<void> {
    const resolvedDest = resolve(destDir);
    let fileCount = 0;
    let totalSize = 0;

    async function walk(dir: string): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const resolved = resolve(fullPath);

        // ZipSlip check
        if (!resolved.startsWith(resolvedDest + sep) && resolved !== resolvedDest) {
          await fs.rm(fullPath, { recursive: true, force: true });
          throw new Error(`Path traversal detected: ${entry.name}`);
        }

        fileCount++;
        if (fileCount > MAX_FILES) {
          throw new Error(`Archive exceeds ${MAX_FILES} file limit`);
        }

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isSymbolicLink()) {
          // Remove symlinks for safety.
          await fs.rm(fullPath, { force: true });
        } else {
          const stat = await fs.stat(fullPath);
          totalSize += stat.size;
          if (totalSize > MAX_EXTRACTED_BYTES) {
            throw new Error(
              `Extracted content exceeds ${MAX_EXTRACTED_BYTES / 1024 / 1024 / 1024}GB limit`,
            );
          }
        }
      }
    }

    await walk(resolvedDest);
  }
}
