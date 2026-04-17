/**
 * Prepare Cluster Tool - Context-Only Implementation
 *
 * Inspects current Kubernetes cluster state and returns structured setup steps
 * and validation commands for the agent to execute. Does NOT take direct action.
 *
 * @example
 * ```typescript
 * const result = await prepareCluster({
 *   namespace: 'my-app',
 *   environment: 'production'
 * }, context);
 *
 * if (result.ok) {
 *   // Agent executes result.value.setupSteps[].commands
 *   // Then runs result.value.validationSteps[].command
 * }
 * ```
 */

import { setupToolContext } from '@/lib/tool-context-helpers';
import { validateNamespace } from '@/lib/validation';
import type { ToolContext } from '@/core/context';
import { DOCKER, KUBERNETES } from '@/config/constants';
import { prepareClusterToolDefinition } from './types';
import { createKubernetesClient, type KubernetesClient } from '@/infra/kubernetes/client';
import {
  getSystemInfo,
  getDownloadOS,
  getDownloadArch,
  mapNodeArchToPlatform,
  isPlatformCompatible,
} from '@/lib/platform';
import { findRegistryPort } from '@/lib/port-utils';
import type { DockerPlatform } from '@/tools/shared/schemas';

import type * as pino from 'pino';
import { Success, Failure, type Result } from '@/types';
import { type PrepareClusterParams } from './schema';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const KIND_VERSION = 'v0.20.0';
const KIND_AMD64_NODE_IMAGE =
  'kindest/node:v1.27.3@sha256:3966ac761ae0136263ffdb6cfd4db23ef8a83cba8a463690e98317add2c9ba72';

// ─── Result Types ────────────────────────────────────────────────────────────

export interface SetupStep {
  /** Unique step identifier */
  id: string;
  /** Human-readable description of what this step does */
  description: string;
  /** Whether this step is required for the cluster to work */
  required: boolean;
  /** Whether inspection detected this step is already done */
  alreadyDone: boolean;
  /** Shell commands to execute (in order) */
  commands: string[];
  /** YAML manifests to apply (via kubectl apply -f) */
  manifests?: string[];
  /** What the agent should expect after this step succeeds */
  expectedOutcome: string;
  /** Command to verify this step worked */
  validationCommand?: string;
  /** What success looks like for the validation command */
  validationExpected?: string;
  /** Kind config customizations (diff from default, not the full config) */
  kindConfigPatches?: string;
}

export interface ValidationStep {
  /** Unique step identifier */
  id: string;
  /** Human-readable description */
  description: string;
  /** Shell command to run */
  command: string;
  /** What the output should contain/look like on success */
  expectedOutput: string;
}

export interface PrepareClusterResult {
  /**
   * Natural language summary for user display.
   * @example "Cluster inspected. 3 setup steps needed, 2 already done. 4 validation steps provided."
   */
  summary: string;
  success: boolean;

  /** Current observed state of the cluster infrastructure */
  currentState: {
    clusterType: 'kind' | 'generic';
    connectivity: boolean;
    permissions: boolean;
    namespaceExists: boolean;
    kindInstalled: boolean | null;
    kindClusterExists: boolean | null;
    registryExists: boolean | null;
    registryPort: number | null;
    registryHealthy: boolean | null;
    registryConnectedToKind: boolean | null;
    containerdMirrorConfigured: boolean | null;
    ingressController: boolean | null;
    platform: {
      target: DockerPlatform;
      cluster: DockerPlatform | null;
      compatible: boolean;
      requiresEmulation: boolean;
    };
  };

  /** Ordered steps the agent must execute to set up the cluster */
  setupSteps: SetupStep[];

  /** Validation steps to confirm everything works end-to-end */
  validationSteps: ValidationStep[];

  warnings: string[];
}

// ─── Read-Only Inspection Functions ──────────────────────────────────────────

async function checkConnectivity(
  k8sClient: KubernetesClient,
  logger: pino.Logger,
): Promise<boolean> {
  try {
    const connected = await k8sClient.ping();
    logger.debug({ connected }, 'Cluster connectivity check');
    return connected;
  } catch (error) {
    logger.warn({ error }, 'Cluster connectivity check failed');
    return false;
  }
}

async function checkNamespace(
  k8sClient: KubernetesClient,
  namespace: string,
  logger: pino.Logger,
): Promise<boolean> {
  try {
    const exists = await k8sClient.namespaceExists(namespace);
    logger.debug({ namespace, exists }, 'Checking namespace');
    return exists;
  } catch (error) {
    logger.warn({ namespace, error }, 'Namespace check failed');
    return false;
  }
}

async function checkIngressController(
  k8sClient: KubernetesClient,
  logger: pino.Logger,
): Promise<boolean> {
  try {
    const hasIngress = await k8sClient.checkIngressController();
    logger.debug({ hasIngress }, 'Checking for ingress controller');
    return hasIngress;
  } catch (error) {
    logger.warn({ error }, 'Ingress controller check failed');
    return false;
  }
}

async function checkKindInstalled(logger: pino.Logger): Promise<boolean> {
  try {
    await execAsync('kind version');
    logger.debug('Kind is already installed');
    return true;
  } catch {
    logger.debug('Kind is not installed');
    return false;
  }
}

async function checkKindClusterExists(clusterName: string, logger: pino.Logger): Promise<boolean> {
  try {
    const { stdout } = await execAsync('kind get clusters');
    const clusters = stdout
      .trim()
      .split('\n')
      .filter((line: string) => line.trim());
    const exists = clusters.includes(clusterName);
    logger.debug({ clusterName, exists, clusters }, 'Checking kind cluster existence');
    return exists;
  } catch (error) {
    logger.debug({ error }, 'Error checking kind clusters');
    return false;
  }
}

async function checkLocalRegistryExists(logger: pino.Logger): Promise<{
  exists: boolean;
  running: boolean;
  port: number | null;
}> {
  try {
    const { stdout: allContainers } = await execAsync(
      `docker ps -a --filter "name=${DOCKER.REGISTRY_CONTAINER_NAME}" --format "{{.Names}}"`,
    );
    const containerExists = allContainers.trim() === DOCKER.REGISTRY_CONTAINER_NAME;

    if (!containerExists) {
      return { exists: false, running: false, port: null };
    }

    const { stdout: portMapping } = await execAsync(
      `docker inspect ${DOCKER.REGISTRY_CONTAINER_NAME} --format '{{range $p, $conf := .NetworkSettings.Ports}}{{if eq $p "5000/tcp"}}{{(index $conf 0).HostPort}}{{end}}{{end}}'`,
    );
    const port = parseInt(portMapping.trim(), 10);

    const { stdout: runningContainers } = await execAsync(
      `docker ps --filter "name=${DOCKER.REGISTRY_CONTAINER_NAME}" --format "{{.Names}}"`,
    );
    const isRunning = runningContainers.trim() === DOCKER.REGISTRY_CONTAINER_NAME;

    return { exists: true, running: isRunning, port: isNaN(port) ? null : port };
  } catch (error) {
    logger.debug({ error }, 'Error checking local registry');
    return { exists: false, running: false, port: null };
  }
}

async function checkRegistryHealthy(port: number, logger: pino.Logger): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `curl -sf --max-time 3 http://${DOCKER.REGISTRY_HOST}:${port}/v2/ || echo "failed"`,
      { timeout: 4000 },
    );
    return !stdout.includes('failed');
  } catch {
    logger.debug('Registry health check failed');
    return false;
  }
}

async function checkDockerNetworkExists(
  networkName: string,
  logger: pino.Logger,
): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `docker network ls --filter "name=${networkName}" --format "{{.Name}}"`,
    );
    const exists = stdout.split('\n').includes(networkName);
    logger.debug({ networkName, exists }, 'Checking Docker network existence');
    return exists;
  } catch (error) {
    logger.debug({ networkName, error }, 'Error checking Docker network');
    return false;
  }
}

async function checkContainerNetworkConnection(
  containerName: string,
  networkName: string,
  logger: pino.Logger,
): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `docker inspect ${containerName} --format '{{range $net, $v := .NetworkSettings.Networks}}{{$net}} {{end}}'`,
    );
    const networks = stdout.trim().split(' ').filter(Boolean);
    const connected = networks.includes(networkName);
    logger.debug(
      { containerName, networkName, connected },
      'Checking container network connection',
    );
    return connected;
  } catch (error) {
    logger.debug(
      { containerName, networkName, error },
      'Error checking container network connection',
    );
    return false;
  }
}

async function checkContainerdConfig(
  clusterName: string,
  port: number,
  logger: pino.Logger,
): Promise<boolean> {
  try {
    const nodeContainerName = `${clusterName}-control-plane`;
    const { stdout } = await execAsync(
      `docker exec ${nodeContainerName} cat /etc/containerd/config.toml`,
    );

    const mirrorHostPattern = new RegExp(
      `\\[plugins\\."io\\.containerd\\.grpc\\.v1\\.cri"\\.registry\\.mirrors\\."${DOCKER.REGISTRY_HOST}:${port}"\\]`,
    );
    const endpointPattern = new RegExp(
      `endpoint\\s*=\\s*\\["http://${DOCKER.REGISTRY_CONTAINER_NAME}:${DOCKER.REGISTRY_INTERNAL_PORT}"\\]`,
    );

    return mirrorHostPattern.test(stdout) && endpointPattern.test(stdout);
  } catch (error) {
    logger.debug({ clusterName, error }, 'Error checking containerd config');
    return false;
  }
}

async function detectClusterPlatform(logger: pino.Logger): Promise<DockerPlatform | null> {
  try {
    const { stdout } = await execAsync(
      "kubectl get nodes -o jsonpath='{.items[0].status.nodeInfo.architecture}'",
    );
    const arch = stdout.trim().replace(/'/g, '');
    if (!arch) return null;

    let os = 'linux';
    try {
      const { stdout: osOutput } = await execAsync(
        "kubectl get nodes -o jsonpath='{.items[0].status.nodeInfo.operatingSystem}'",
      );
      const detectedOS = osOutput.trim().replace(/'/g, '').toLowerCase();
      if (detectedOS) os = detectedOS;
    } catch {
      logger.debug('Could not detect OS, defaulting to linux');
    }

    return mapNodeArchToPlatform(arch, os);
  } catch (error) {
    logger.warn({ error }, 'Failed to detect cluster platform');
    return null;
  }
}

// ─── Step Builder Functions ──────────────────────────────────────────────────

function buildKindInstallStep(isInstalled: boolean): SetupStep {
  const systemInfo = getSystemInfo();
  const downloadOS = getDownloadOS();
  const downloadArch = getDownloadArch();

  const ext = systemInfo.isWindows ? '.exe' : '';
  const kindUrl = systemInfo.isWindows
    ? `https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-windows-${downloadArch}.exe`
    : `https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-${downloadOS}-${downloadArch}`;

  const commands: string[] = [];
  if (systemInfo.isWindows) {
    commands.push(`curl -Lo kind${ext} "${kindUrl}"`);
    commands.push(`move kind${ext} "%ProgramFiles%\\kind\\kind${ext}"`);
  } else {
    commands.push(`curl -Lo ./kind "${kindUrl}"`);
    commands.push('chmod +x ./kind');
    commands.push('sudo mv ./kind /usr/local/bin/kind');
  }

  return {
    id: 'install-kind',
    description: `Install kind ${KIND_VERSION} for ${downloadOS}/${downloadArch}`,
    required: true,
    alreadyDone: isInstalled,
    commands,
    expectedOutcome: 'kind binary available on PATH',
    validationCommand: 'kind version',
    validationExpected: `kind ${KIND_VERSION}`,
  };
}

function buildKindClusterStep(
  clusterName: string,
  exists: boolean,
  port: number,
  _platform: DockerPlatform,
  strictMode: boolean,
): SetupStep {
  const systemInfo = getSystemInfo();
  const hostArch = process.arch;
  const shouldUseAMD64Node = !strictMode && systemInfo.isMac && hostArch === 'arm64';

  // Describe the config patches needed (diff from default kind config)
  const patches: string[] = [];
  patches.push(
    `containerdConfigPatches: registry mirror for ${DOCKER.REGISTRY_HOST}:${port} → http://${DOCKER.REGISTRY_CONTAINER_NAME}:${DOCKER.REGISTRY_INTERNAL_PORT}`,
  );
  patches.push(
    `nodes[0].extraPortMappings: containerPort ${KUBERNETES.DEFAULT_HTTP_PORT} → hostPort ${KUBERNETES.DEFAULT_HTTP_PORT} (TCP), containerPort ${KUBERNETES.DEFAULT_HTTPS_PORT} → hostPort ${KUBERNETES.DEFAULT_HTTPS_PORT} (TCP)`,
  );
  patches.push(`nodes[0].kubeadmConfigPatches: node-labels "ingress-ready=true"`);
  if (shouldUseAMD64Node) {
    patches.push(
      `nodes[0].image: ${KIND_AMD64_NODE_IMAGE} (AMD64 on ARM Mac for cross-platform compatibility)`,
    );
  }

  return {
    id: 'create-kind-cluster',
    description: `Create kind cluster '${clusterName}' with registry mirror and port mappings`,
    required: true,
    alreadyDone: exists,
    commands: [`kind create cluster --name ${clusterName} --config <kind-config.yaml>`],
    kindConfigPatches: patches.join('\n'),
    expectedOutcome: `Kind cluster '${clusterName}' running with kubectl context set`,
    validationCommand: `kind get clusters | grep ${clusterName}`,
    validationExpected: clusterName,
  };
}

function buildExportKubeconfigStep(clusterName: string, _clusterExists: boolean): SetupStep {
  return {
    id: 'export-kubeconfig',
    description: `Export kubeconfig for kind cluster '${clusterName}'`,
    required: true,
    alreadyDone: false, // Always run after cluster creation to ensure fresh config
    commands: [`kind export kubeconfig --name ${clusterName}`],
    expectedOutcome: 'kubectl context set to kind cluster',
    validationCommand: 'kubectl cluster-info',
    validationExpected: 'Kubernetes control plane is running',
  };
}

function buildRegistryContainerStep(
  registryState: { exists: boolean; running: boolean; port: number | null },
  port: number,
): SetupStep {
  const commands: string[] = [];
  if (!registryState.exists) {
    commands.push(
      `docker run -d --restart=always -p ${port}:${DOCKER.REGISTRY_INTERNAL_PORT} --name ${DOCKER.REGISTRY_CONTAINER_NAME} registry:2`,
    );
  } else if (!registryState.running) {
    commands.push(`docker start ${DOCKER.REGISTRY_CONTAINER_NAME}`);
  }

  return {
    id: 'create-registry',
    description: 'Create or start local Docker registry container',
    required: true,
    alreadyDone: registryState.exists && registryState.running,
    commands,
    expectedOutcome: `Registry container '${DOCKER.REGISTRY_CONTAINER_NAME}' running on port ${port}`,
    validationCommand: `curl -sf http://${DOCKER.REGISTRY_HOST}:${port}/v2/`,
    validationExpected: 'HTTP 200 (empty JSON object {})',
  };
}

function buildRegistryNetworkStep(isConnected: boolean, _kindNetworkExists: boolean): SetupStep {
  return {
    id: 'connect-registry-network',
    description: `Connect registry container to kind Docker network`,
    required: true,
    alreadyDone: isConnected,
    commands: [`docker network connect kind ${DOCKER.REGISTRY_CONTAINER_NAME}`],
    expectedOutcome: 'Registry container connected to kind network, accessible from cluster pods',
    validationCommand: `docker inspect ${DOCKER.REGISTRY_CONTAINER_NAME} --format '{{range $net, $v := .NetworkSettings.Networks}}{{$net}} {{end}}'`,
    validationExpected: 'Output includes "kind"',
  };
}

function buildRegistryConfigMapStep(): SetupStep {
  const configMapYaml = `apiVersion: v1
kind: ConfigMap
metadata:
  name: local-registry-hosting
  namespace: kube-public
data:
  localRegistryHosting.v1: |
    host: "${DOCKER.REGISTRY_HOST}:PORT"
    help: "https://kind.sigs.k8s.io/docs/user/local-registry/"`;

  return {
    id: 'create-registry-configmap',
    description:
      'Create local-registry-hosting ConfigMap in kube-public namespace (kind best practice)',
    required: false,
    alreadyDone: false,
    commands: ['kubectl apply -f <configmap.yaml>'],
    manifests: [configMapYaml],
    expectedOutcome: 'ConfigMap created in kube-public namespace documenting registry location',
    validationCommand: 'kubectl get configmap local-registry-hosting -n kube-public',
    validationExpected: 'ConfigMap exists',
  };
}

function buildNamespaceStep(namespace: string, exists: boolean): SetupStep {
  return {
    id: 'create-namespace',
    description: `Create Kubernetes namespace '${namespace}'`,
    required: true,
    alreadyDone: exists,
    commands: [`kubectl create namespace ${namespace}`],
    expectedOutcome: `Namespace '${namespace}' exists`,
    validationCommand: `kubectl get namespace ${namespace}`,
    validationExpected: `namespace/${namespace} listed with Active status`,
  };
}

function buildRbacStep(namespace: string): SetupStep {
  const saYaml = `apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-service-account
  namespace: ${namespace}`;

  return {
    id: 'setup-rbac',
    description: `Create app-service-account ServiceAccount in '${namespace}'`,
    required: false,
    alreadyDone: false,
    commands: ['kubectl apply -f <service-account.yaml>'],
    manifests: [saYaml],
    expectedOutcome: 'ServiceAccount created for application workloads',
    validationCommand: `kubectl get serviceaccount app-service-account -n ${namespace}`,
    validationExpected: 'ServiceAccount exists',
  };
}

// ─── Validation Step Builders ────────────────────────────────────────────────

function buildValidationSteps(
  clusterType: 'kind' | 'generic',
  namespace: string,
  port: number | null,
): ValidationStep[] {
  const steps: ValidationStep[] = [
    {
      id: 'verify-connectivity',
      description: 'Verify kubectl can reach the cluster',
      command: 'kubectl cluster-info',
      expectedOutput: 'Kubernetes control plane is running',
    },
    {
      id: 'verify-nodes-ready',
      description: 'Verify cluster nodes are ready',
      command: 'kubectl get nodes',
      expectedOutput: 'All nodes show Ready status',
    },
    {
      id: 'verify-namespace',
      description: `Verify namespace '${namespace}' exists`,
      command: `kubectl get namespace ${namespace}`,
      expectedOutput: `${namespace} listed with Active status`,
    },
  ];

  if (clusterType === 'kind' && port !== null) {
    steps.push(
      {
        id: 'verify-registry-health',
        description: 'Verify local registry is healthy',
        command: `curl -sf http://${DOCKER.REGISTRY_HOST}:${port}/v2/`,
        expectedOutput: 'HTTP 200 response',
      },
      {
        id: 'verify-registry-from-cluster',
        description: 'Verify registry is reachable from within the cluster',
        command: `kubectl run registry-test-$(date +%s) --image=curlimages/curl:latest --restart=Never --rm -i --timeout=30s -- sh -c 'curl -sf http://${DOCKER.REGISTRY_CONTAINER_NAME}:${DOCKER.REGISTRY_INTERNAL_PORT}/v2/ && echo "success" || echo "failed"'`,
        expectedOutput: 'Output contains "success"',
      },
      {
        id: 'verify-registry-dns',
        description: 'Verify registry DNS resolution from within the cluster',
        command: `kubectl run registry-dns-test-$(date +%s) --image=busybox:latest --restart=Never --rm -i --timeout=30s -- sh -c 'nslookup ${DOCKER.REGISTRY_CONTAINER_NAME} && echo "DNS_SUCCESS" || echo "DNS_FAILED"'`,
        expectedOutput: 'Output contains "DNS_SUCCESS" and a resolved IP address',
      },
    );
  }

  return steps;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

async function handlePrepareCluster(
  params: PrepareClusterParams,
  context: ToolContext,
): Promise<Result<PrepareClusterResult>> {
  const { logger, timer } = setupToolContext(context, 'prepare-cluster');

  const {
    clusterType: explicitClusterType,
    environment = 'development',
    namespace = 'default',
    targetPlatform = 'linux/amd64',
    strictPlatformValidation = true,
  } = params;

  const effectiveClusterType =
    explicitClusterType ?? (environment === 'development' ? 'kind' : 'generic');

  // Validate namespace
  const namespaceValidation = validateNamespace(namespace);
  if (!namespaceValidation.ok) {
    return namespaceValidation;
  }

  const clusterName = effectiveClusterType === 'kind' ? 'containerization-assist' : 'default';
  const isKind = effectiveClusterType === 'kind';

  try {
    logger.info({ environment, namespace, effectiveClusterType }, 'Inspecting cluster state');

    const warnings: string[] = [];
    const setupSteps: SetupStep[] = [];

    // ── Inspect Kind Infrastructure ──────────────────────────────────────

    let kindInstalled: boolean | null = null;
    let kindClusterExists: boolean | null = null;
    let registryState: { exists: boolean; running: boolean; port: number | null } = {
      exists: false,
      running: false,
      port: null,
    };
    let registryPort: number | null = null;
    let registryHealthy: boolean | null = null;
    let registryConnectedToKind: boolean | null = null;
    let containerdMirrorConfigured: boolean | null = null;

    if (isKind) {
      // Check kind installation
      kindInstalled = await checkKindInstalled(logger);

      // Check registry state and determine port
      registryState = await checkLocalRegistryExists(logger);
      if (registryState.port !== null) {
        registryPort = registryState.port;
      } else {
        registryPort = await findRegistryPort();
      }

      // Check kind cluster
      if (kindInstalled) {
        kindClusterExists = await checkKindClusterExists(clusterName, logger);
      } else {
        kindClusterExists = false;
      }

      // Check registry health if it's running
      if (registryState.running && registryPort !== null) {
        registryHealthy = await checkRegistryHealthy(registryPort, logger);
      }

      // Check registry network connectivity if cluster exists
      if (kindClusterExists && registryState.exists) {
        const kindNetworkExists = await checkDockerNetworkExists('kind', logger);
        if (kindNetworkExists) {
          registryConnectedToKind = await checkContainerNetworkConnection(
            DOCKER.REGISTRY_CONTAINER_NAME,
            'kind',
            logger,
          );
        } else {
          registryConnectedToKind = false;
        }

        // Check containerd mirror config
        if (registryPort !== null) {
          containerdMirrorConfigured = await checkContainerdConfig(
            clusterName,
            registryPort,
            logger,
          );
        }
      }

      // ── Build Kind Setup Steps ───────────────────────────────────────

      setupSteps.push(buildKindInstallStep(kindInstalled));
      setupSteps.push(buildRegistryContainerStep(registryState, registryPort));
      setupSteps.push(
        buildKindClusterStep(
          clusterName,
          kindClusterExists,
          registryPort,
          targetPlatform,
          strictPlatformValidation,
        ),
      );
      setupSteps.push(buildExportKubeconfigStep(clusterName, false));
      setupSteps.push(
        buildRegistryNetworkStep(registryConnectedToKind === true, kindClusterExists),
      );
      setupSteps.push(buildRegistryConfigMapStep());
    }

    // ── Inspect Cluster Connectivity (requires a running cluster) ────────

    const k8sClient = createKubernetesClient(logger);
    const connectivity = await checkConnectivity(k8sClient, logger);
    let permissions = false;
    let namespaceExists = false;
    let ingressController: boolean | null = null;

    if (connectivity) {
      permissions = await k8sClient.checkPermissions(namespace);
      namespaceExists = await checkNamespace(k8sClient, namespace, logger);
      ingressController = await checkIngressController(k8sClient, logger);

      if (!permissions) {
        warnings.push('Insufficient permissions for Kubernetes operations in this namespace');
      }
      if (!ingressController) {
        warnings.push('No ingress controller found - external access may not work');
      }
    } else if (!isKind) {
      // For generic clusters, no connectivity is an error
      return Failure('Cannot connect to Kubernetes cluster', {
        message: 'Kubernetes cluster connection failed',
        hint: 'Could not establish connection to any Kubernetes cluster',
        resolution:
          'Ensure Kubernetes is installed and a cluster is accessible (kubectl cluster-info)',
      });
    } else {
      // For kind, no connectivity just means we need to create the cluster first
      warnings.push(
        'No cluster connectivity yet - kind cluster setup steps will establish connection',
      );
    }

    // ── Build Generic Steps ──────────────────────────────────────────────

    if (!namespaceExists && namespace !== 'default') {
      setupSteps.push(buildNamespaceStep(namespace, namespaceExists));
    }

    if (effectiveClusterType === 'generic') {
      setupSteps.push(buildRbacStep(namespace));
    }

    // ── Platform Compatibility ───────────────────────────────────────────

    let clusterPlatform: DockerPlatform | null = null;
    let platformCompatible = false;
    let requiresEmulation = false;

    if (connectivity) {
      clusterPlatform = await detectClusterPlatform(logger);
      if (clusterPlatform) {
        platformCompatible = isPlatformCompatible(targetPlatform, clusterPlatform);
        requiresEmulation = !platformCompatible && targetPlatform !== clusterPlatform;

        if (!platformCompatible && strictPlatformValidation) {
          warnings.push(
            `Platform mismatch: cluster is ${clusterPlatform} but target is ${targetPlatform}. In strict mode, deployment will fail.`,
          );
        } else if (requiresEmulation) {
          const systemInfo = getSystemInfo();
          const isArmMacWithAmd64 =
            systemInfo.isMac &&
            process.arch === 'arm64' &&
            targetPlatform === 'linux/amd64' &&
            clusterPlatform === 'linux/amd64';

          if (isArmMacWithAmd64) {
            warnings.push(
              'Running AMD64 cluster on ARM Mac - images will use Docker emulation (may have performance impact)',
            );
            platformCompatible = true; // Allow in non-strict
          } else {
            warnings.push(
              `Platform mismatch: building for ${targetPlatform} but cluster runs ${clusterPlatform}. May require emulation.`,
            );
          }
        }
      } else {
        warnings.push(
          `Could not detect cluster platform - unable to verify compatibility with ${targetPlatform}`,
        );
      }
    }

    // ── Build Validation Steps ───────────────────────────────────────────

    const validationSteps = buildValidationSteps(effectiveClusterType, namespace, registryPort);

    // ── Build Summary ────────────────────────────────────────────────────

    const pendingSteps = setupSteps.filter((s) => !s.alreadyDone);
    const doneSteps = setupSteps.filter((s) => s.alreadyDone);
    const summary = `Cluster inspected. ${pendingSteps.length} setup ${pendingSteps.length === 1 ? 'step' : 'steps'} needed, ${doneSteps.length} already done. ${validationSteps.length} validation ${validationSteps.length === 1 ? 'step' : 'steps'} provided.`;

    const result: PrepareClusterResult = {
      summary,
      success: true,
      currentState: {
        clusterType: effectiveClusterType,
        connectivity,
        permissions,
        namespaceExists,
        kindInstalled,
        kindClusterExists,
        registryExists: registryState.exists || null,
        registryPort,
        registryHealthy,
        registryConnectedToKind,
        containerdMirrorConfigured,
        ingressController,
        platform: {
          target: targetPlatform,
          cluster: clusterPlatform,
          compatible: platformCompatible,
          requiresEmulation,
        },
      },
      setupSteps,
      validationSteps,
      warnings,
    };

    logger.info(
      { pendingSteps: pendingSteps.length, doneSteps: doneSteps.length },
      'Cluster inspection completed',
    );
    timer.end({ effectiveClusterType, environment });

    return Success(result);
  } catch (error) {
    timer.error(error);

    const errorMessage = error instanceof Error ? error.message : String(error);
    return Failure(errorMessage, {
      message: errorMessage,
      hint: 'An unexpected error occurred during cluster inspection',
      resolution:
        'Check the error message for details. Common issues include Docker not running (for kind clusters), kubectl not configured, or insufficient permissions',
    });
  }
}

export const prepareCluster = handlePrepareCluster;

import { tool } from '@/types/tool';

export default tool({
  ...prepareClusterToolDefinition,
  handler: handlePrepareCluster,
});
