/**
 * Safeguard Level Detector
 *
 * Detects AKS Deployment Safeguards level for a Kubernetes cluster.
 * Uses a three-tier fallback strategy:
 * 1. Azure CLI (az aks show) - most accurate, AKS-specific
 * 2. kubectl (constraint templates) - cluster-agnostic, less granular
 * 3. Offline fallback - no CLI tools available
 *
 * @module lib/safeguard-detector
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Logger } from 'pino';

const execAsync = promisify(exec);

/**
 * Safeguard level detected from cluster
 * - 'off': No deployment safeguards configured
 * - 'warn': Warning mode (audit/log only)
 * - 'enforce': Enforcement mode (blocks deployments)
 * - 'unknown': Unable to detect (offline/no access)
 */
export type SafeguardLevel = 'off' | 'warn' | 'enforce' | 'unknown';

/**
 * Detection source used to determine safeguard level
 * - 'az-cli': Azure CLI (az aks show)
 * - 'kubectl': kubectl API (constrainttemplates)
 * - 'offline': No CLI tools available
 */
export type DetectionSource = 'az-cli' | 'kubectl' | 'offline';

/**
 * Result of safeguard level detection
 */
export interface SafeguardDetection {
  /** Detected safeguard level */
  level: SafeguardLevel;
  /** Source used for detection */
  source: DetectionSource;
  /** Safeguards version (from az CLI only) */
  version?: string;
  /** Namespaces excluded from safeguards (from az CLI only) */
  excludedNamespaces?: string[];
}

/**
 * Options for safeguard detection
 */
export interface DetectSafeguardOptions {
  /** Kubernetes cluster context name (optional) */
  clusterContext?: string;
  /** Logger instance */
  logger: Logger;
  /** Mock exec function for testing (internal) */
  _mockExec?: (
    command: string,
    options?: { timeout: number },
  ) => Promise<{ stdout: string; stderr: string }>;
}

/**
 * Extract resource group and cluster name from AKS server URL
 * Example: https://my-rg-my-cluster-abc123.hcp.eastus.azmk8s.io:443
 * Returns: { resourceGroup: 'my-rg', clusterName: 'my-cluster' }
 */
function parseAksServerUrl(serverUrl: string): { resourceGroup?: string; clusterName?: string } {
  const match = serverUrl.match(/https:\/\/([^-]+)-([^-]+)-[^.]+\.hcp\.[^.]+\.azmk8s\.io/);
  if (match && match[1] && match[2]) {
    return {
      resourceGroup: match[1],
      clusterName: match[2],
    };
  }
  return {};
}

/**
 * Detect safeguard level via Azure CLI (most accurate)
 * Uses az aks show to query AKS-specific safeguards configuration.
 */
async function detectViaAzureCli(
  resourceGroup: string,
  clusterName: string,
  execFn: (
    command: string,
    options?: { timeout: number },
  ) => Promise<{ stdout: string; stderr: string }>,
  logger: Logger,
): Promise<SafeguardDetection | null> {
  try {
    logger.debug({ resourceGroup, clusterName }, 'Attempting Azure CLI detection');

    const { stdout } = await execFn(
      `az aks show -g ${resourceGroup} -n ${clusterName} --query safeguardsProfile -o json`,
      { timeout: 10000 },
    );

    const profile = JSON.parse(stdout);

    if (!profile || !profile.level) {
      logger.debug('Azure CLI returned empty or invalid safeguardsProfile');
      return null;
    }

    const level: SafeguardLevel = profile.level === 'Enforcement' ? 'enforce' : 'warn';

    logger.info({ level, version: profile.version }, 'Detected safeguard level via Azure CLI');

    return {
      level,
      source: 'az-cli',
      version: profile.version,
      excludedNamespaces: profile.excludedNamespaces,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.debug({ error: errorMsg }, 'Azure CLI detection failed');
    return null;
  }
}

/**
 * Detect safeguard level via kubectl (cluster-agnostic fallback)
 * Checks for Gatekeeper constrainttemplates to determine if Gatekeeper is present.
 * Cannot distinguish between warn/enforce modes without AKS metadata.
 */
async function detectViaKubectl(
  execFn: (
    command: string,
    options?: { timeout: number },
  ) => Promise<{ stdout: string; stderr: string }>,
  logger: Logger,
): Promise<SafeguardDetection | null> {
  try {
    logger.debug('Attempting kubectl detection');

    const { stdout } = await execFn('kubectl get constrainttemplates -o json', { timeout: 10000 });

    const result = JSON.parse(stdout);

    // If constrainttemplates exist, Gatekeeper is present
    const hasGatekeeper = result.items && result.items.length > 0;
    const level: SafeguardLevel = hasGatekeeper ? 'warn' : 'off';

    logger.info(
      { level, templateCount: result.items?.length || 0 },
      'Detected safeguard level via kubectl',
    );

    return {
      level,
      source: 'kubectl',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.debug({ error: errorMsg }, 'kubectl detection failed');
    return null;
  }
}

/**
 * Extract cluster context information from kubectl config
 * Returns resource group and cluster name if available (AKS clusters only)
 */
async function extractClusterContext(
  execFn: (
    command: string,
    options?: { timeout: number },
  ) => Promise<{ stdout: string; stderr: string }>,
  logger: Logger,
): Promise<{ resourceGroup?: string; clusterName?: string }> {
  try {
    // Get current context name
    const { stdout: contextName } = await execFn('kubectl config current-context', {
      timeout: 5000,
    });
    const context = contextName.trim();

    logger.debug({ context }, 'Current kubectl context');

    // Get cluster server URL from config
    const { stdout: configOutput } = await execFn('kubectl config view -o json', { timeout: 5000 });
    const config = JSON.parse(configOutput);

    // Find the cluster associated with the current context
    const currentContext = config.contexts?.find((ctx: { name: string }) => ctx.name === context);
    if (!currentContext) {
      logger.debug('Could not find current context in kubeconfig');
      return {};
    }

    const clusterName = currentContext.context?.cluster;
    const cluster = config.clusters?.find((c: { name: string }) => c.name === clusterName);

    if (!cluster?.cluster?.server) {
      logger.debug('Could not find cluster server URL');
      return {};
    }

    // Parse AKS-specific server URL pattern
    const serverUrl = cluster.cluster.server;
    const aksInfo = parseAksServerUrl(serverUrl);

    if (aksInfo.resourceGroup && aksInfo.clusterName) {
      logger.debug(aksInfo, 'Extracted AKS cluster information from context');
      return aksInfo;
    }

    logger.debug('Cluster is not AKS or server URL pattern not recognized');
    return {};
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.debug({ error: errorMsg }, 'Failed to extract cluster context');
    return {};
  }
}

/**
 * Detect AKS Deployment Safeguards level for a Kubernetes cluster.
 *
 * Detection strategy (falls back on failure):
 * 1. Azure CLI (az aks show) - most accurate, provides level, version, excluded namespaces
 * 2. kubectl (constrainttemplates) - cluster-agnostic, detects Gatekeeper presence
 * 3. Offline fallback - returns 'unknown' if both CLI tools unavailable
 *
 * @param options - Detection options including cluster context and logger
 * @returns Promise resolving to SafeguardDetection result
 *
 * @example
 * ```typescript
 * const detection = await detectSafeguardLevel({
 *   logger: pinoLogger,
 * });
 *
 * if (detection.level === 'enforce') {
 *   console.log('Deployment safeguards are enforcing');
 * }
 * ```
 */
export async function detectSafeguardLevel(
  options: DetectSafeguardOptions,
): Promise<SafeguardDetection> {
  const { clusterContext, logger, _mockExec } = options;
  const execFn = _mockExec || execAsync;

  logger.info('Starting safeguard level detection');

  // If clusterContext provided, try Azure CLI directly
  if (clusterContext) {
    // Attempt to parse as AKS format: <rg>-<cluster> or just <cluster>
    const parts = clusterContext.split('-');
    if (parts.length >= 2 && parts[0] && parts[1]) {
      const azResult = await detectViaAzureCli(
        parts[0],
        parts.slice(1).join('-'),
        execFn,
        logger,
      );
      if (azResult) {
        return azResult;
      }
    }
  }

  // Try to extract cluster context automatically from kubectl config
  const clusterInfo = await extractClusterContext(execFn, logger);
  
  // Try Azure CLI detection first (if we have AKS cluster info)
  if (clusterInfo.resourceGroup && clusterInfo.clusterName) {
    const azResult = await detectViaAzureCli(
      clusterInfo.resourceGroup,
      clusterInfo.clusterName,
      execFn,
      logger,
    );
    if (azResult) {
      return azResult;
    }
  }

  // Fall back to kubectl detection
  const kubectlResult = await detectViaKubectl(execFn, logger);
  if (kubectlResult) {
    return kubectlResult;
  }

  // Offline fallback - no CLI tools available
  logger.warn('All detection methods failed, returning unknown level');
  return {
    level: 'unknown',
    source: 'offline',
  };
}
