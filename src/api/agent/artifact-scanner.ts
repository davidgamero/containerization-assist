/**
 * Artifact Scanner
 *
 * Scans a repository for existing containerization artifacts before
 * the agent loop starts. Detects Dockerfiles, K8s manifests, Helm charts,
 * docker-compose files, and Kustomize overlays.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ArtifactInventory, ArtifactEntry } from './pipeline-context.js';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.vscode',
  '.idea',
  'dist',
  'build',
  'target',
  'bin',
  'obj',
  '__pycache__',
  '.tox',
  'vendor',
  'coverage',
]);

const MAX_DEPTH = 4;

/**
 * Scan a repository directory for containerization artifacts.
 */
export async function scanArtifacts(repoPath: string): Promise<ArtifactInventory> {
  const inventory: ArtifactInventory = {
    dockerfiles: [],
    dockerCompose: [],
    k8sManifests: [],
    helmCharts: [],
    kustomize: [],
  };

  await walkDirectory(repoPath, repoPath, 0, inventory);
  return inventory;
}

async function walkDirectory(
  rootPath: string,
  dirPath: string,
  depth: number,
  inventory: ArtifactInventory,
): Promise<void> {
  if (depth > MAX_DEPTH) return;

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(rootPath, fullPath);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;

      // Detect Helm charts by Chart.yaml
      if (entry.name === 'templates') {
        const chartYaml = path.join(dirPath, 'Chart.yaml');
        try {
          const stat = await fs.stat(chartYaml);
          inventory.helmCharts.push({
            path: dirPath,
            relativePath: path.relative(rootPath, dirPath),
            size: stat.size,
          });
        } catch {
          // Not a Helm chart directory
        }
      }

      await walkDirectory(rootPath, fullPath, depth + 1, inventory);
      continue;
    }

    // File-level detection
    const name = entry.name;
    const nameLower = name.toLowerCase();

    try {
      const stat = await fs.stat(fullPath);
      const artifactEntry: ArtifactEntry = {
        path: fullPath,
        relativePath,
        size: stat.size,
      };

      // Dockerfiles
      if (
        nameLower === 'dockerfile' ||
        nameLower.startsWith('dockerfile.') ||
        nameLower.endsWith('.dockerfile')
      ) {
        inventory.dockerfiles.push(artifactEntry);
      }

      // Docker Compose
      if (
        nameLower === 'docker-compose.yml' ||
        nameLower === 'docker-compose.yaml' ||
        nameLower === 'compose.yml' ||
        nameLower === 'compose.yaml' ||
        nameLower.startsWith('docker-compose.')
      ) {
        inventory.dockerCompose.push(artifactEntry);
      }

      // Kustomize
      if (nameLower === 'kustomization.yaml' || nameLower === 'kustomization.yml') {
        inventory.kustomize.push(artifactEntry);
      }

      // K8s manifests (YAML files in common K8s directories or with K8s-like names)
      if (
        (nameLower.endsWith('.yaml') || nameLower.endsWith('.yml')) &&
        !nameLower.startsWith('docker-compose') &&
        !nameLower.startsWith('compose') &&
        nameLower !== 'kustomization.yaml' &&
        nameLower !== 'kustomization.yml'
      ) {
        const dirName = path.basename(dirPath).toLowerCase();
        const isK8sDir =
          dirName === 'k8s' ||
          dirName === 'kubernetes' ||
          dirName === 'manifests' ||
          dirName === 'deploy' ||
          dirName === 'deployment' ||
          dirName === 'deployments';

        const isK8sName =
          nameLower.includes('deployment') ||
          nameLower.includes('service') ||
          nameLower.includes('ingress') ||
          nameLower.includes('configmap') ||
          nameLower.includes('namespace') ||
          nameLower.includes('rbac') ||
          nameLower.includes('secret') ||
          nameLower.includes('statefulset') ||
          nameLower.includes('daemonset') ||
          nameLower.includes('cronjob') ||
          nameLower.includes('hpa');

        if (isK8sDir || isK8sName) {
          // Quick content check — look for apiVersion which indicates K8s manifest
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const firstChunk = content.substring(0, 500);
            if (firstChunk.includes('apiVersion:') || firstChunk.includes('kind:')) {
              inventory.k8sManifests.push(artifactEntry);
            }
          } catch {
            // Can't read, skip
          }
        }
      }
    } catch {
      // Can't stat, skip
    }
  }
}

/**
 * Format artifact inventory as a human-readable summary
 * for inclusion in the agent prompt.
 */
export function formatArtifactSummary(inventory: ArtifactInventory): string {
  const sections: string[] = [];

  if (inventory.dockerfiles.length > 0) {
    sections.push(
      `**Dockerfiles (${inventory.dockerfiles.length}):**\n${
        inventory.dockerfiles.map((a) => `  - ${a.relativePath}`).join('\n')}`,
    );
  }

  if (inventory.dockerCompose.length > 0) {
    sections.push(
      `**Docker Compose (${inventory.dockerCompose.length}):**\n${
        inventory.dockerCompose.map((a) => `  - ${a.relativePath}`).join('\n')}`,
    );
  }

  if (inventory.k8sManifests.length > 0) {
    sections.push(
      `**K8s Manifests (${inventory.k8sManifests.length}):**\n${
        inventory.k8sManifests.map((a) => `  - ${a.relativePath}`).join('\n')}`,
    );
  }

  if (inventory.helmCharts.length > 0) {
    sections.push(
      `**Helm Charts (${inventory.helmCharts.length}):**\n${
        inventory.helmCharts.map((a) => `  - ${a.relativePath}`).join('\n')}`,
    );
  }

  if (inventory.kustomize.length > 0) {
    sections.push(
      `**Kustomize (${inventory.kustomize.length}):**\n${
        inventory.kustomize.map((a) => `  - ${a.relativePath}`).join('\n')}`,
    );
  }

  if (sections.length === 0) {
    return 'No existing containerization artifacts found.';
  }

  return sections.join('\n\n');
}
