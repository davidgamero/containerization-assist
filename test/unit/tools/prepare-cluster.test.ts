/**
 * Unit Tests: Prepare Cluster Tool (Context-Only)
 * Tests that the tool inspects cluster state and returns correct setup/validation steps
 */

import { jest } from '@jest/globals';

function createMockLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as any;
}

const mockK8sClient = {
  ping: jest.fn<() => Promise<boolean>>(),
  namespaceExists: jest.fn<() => Promise<boolean>>(),
  ensureNamespace: jest.fn<() => Promise<any>>(),
  applyManifest: jest.fn<() => Promise<any>>(),
  checkIngressController: jest.fn<() => Promise<boolean>>(),
  checkPermissions: jest.fn<() => Promise<boolean>>(),
};

const mockTimer = {
  end: jest.fn(),
  error: jest.fn(),
};

jest.mock('@/infra/kubernetes/client', () => ({
  createKubernetesClient: jest.fn(() => mockK8sClient),
}));

jest.mock('@/lib/logger', () => ({
  createTimer: jest.fn(() => mockTimer),
  createLogger: jest.fn(() => createMockLogger()),
}));

jest.mock('@/lib/tool-helpers', () => ({
  getToolLogger: jest.fn(() => createMockLogger()),
  createToolTimer: jest.fn(() => mockTimer),
  createStandardizedToolTracker: jest.fn(() => ({
    complete: jest.fn(),
    fail: jest.fn(),
  })),
}));

jest.mock('@/lib/errors', () => ({
  extractErrorMessage: jest.fn((error: any) => error.message || String(error)),
  ERROR_MESSAGES: {},
}));

jest.mock('@/lib/platform', () => ({
  getSystemInfo: jest.fn(() => ({ isWindows: false, isMac: false, isLinux: true })),
  getDownloadOS: jest.fn(() => 'linux'),
  getDownloadArch: jest.fn(() => 'amd64'),
  mapNodeArchToPlatform: jest.fn(() => 'linux/amd64'),
  isPlatformCompatible: jest.fn(() => true),
}));

jest.mock('@/lib/port-utils', () => ({
  findRegistryPort: jest.fn(() => Promise.resolve(6000)),
  isPortAvailable: jest.fn(() => Promise.resolve(true)),
}));

let execAsyncMock: jest.Mock<(...args: any[]) => any>;

jest.mock('node:child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('node:util', () => {
  execAsyncMock = jest.fn<(...args: any[]) => any>(async () => ({ stdout: '', stderr: '' }));
  return {
    promisify: jest.fn(() => execAsyncMock),
  };
});

import { prepareCluster } from '../../../src/tools/prepare-cluster/tool';
import type { PrepareClusterParams } from '../../../src/tools/prepare-cluster/schema';

function createMockToolContext() {
  return { logger: createMockLogger() } as any;
}

function mockExecForKindExists() {
  (execAsyncMock as any).mockImplementation(async (cmd: string) => {
    if (cmd.includes('kind version')) return { stdout: 'kind v0.20.0', stderr: '' };
    if (cmd.includes('kind get clusters'))
      return { stdout: 'containerization-assist\n', stderr: '' };
    if (cmd.includes('docker ps -a') && cmd.includes('ca-registry'))
      return { stdout: 'ca-registry\n', stderr: '' };
    if (cmd.includes('docker ps') && cmd.includes('ca-registry') && !cmd.includes('-a'))
      return { stdout: 'ca-registry\n', stderr: '' };
    if (cmd.includes('docker inspect ca-registry') && cmd.includes('NetworkSettings.Ports'))
      return { stdout: '6000', stderr: '' };
    if (cmd.includes('docker inspect ca-registry') && cmd.includes('NetworkSettings.Networks'))
      return { stdout: 'bridge kind', stderr: '' };
    if (cmd.includes('docker inspect ca-registry') && cmd.includes('State.Status'))
      return { stdout: 'running', stderr: '' };
    if (cmd.includes('curl') && cmd.includes('/v2/')) return { stdout: '{}', stderr: '' };
    if (cmd.includes('docker network ls')) return { stdout: 'kind\n', stderr: '' };
    if (cmd.includes('docker exec') && cmd.includes('config.toml')) {
      return {
        stdout: `[plugins."io.containerd.grpc.v1.cri".registry.mirrors."localhost:6000"]\n  endpoint = ["http://ca-registry:5000"]`,
        stderr: '',
      };
    }
    if (cmd.includes('kubectl get nodes') && cmd.includes('architecture'))
      return { stdout: 'amd64', stderr: '' };
    if (cmd.includes('kubectl get nodes') && cmd.includes('operatingSystem'))
      return { stdout: 'linux', stderr: '' };
    return { stdout: '', stderr: '' };
  });
}

function mockExecForKindNotExists() {
  (execAsyncMock as any).mockImplementation(async (cmd: string) => {
    if (cmd.includes('kind version')) return { stdout: 'kind v0.20.0', stderr: '' };
    if (cmd.includes('kind get clusters')) return { stdout: '', stderr: '' };
    if (cmd.includes('docker ps')) return { stdout: '', stderr: '' };
    if (cmd.includes('kubectl get nodes') && cmd.includes('architecture'))
      return { stdout: 'amd64', stderr: '' };
    if (cmd.includes('kubectl get nodes') && cmd.includes('operatingSystem'))
      return { stdout: 'linux', stderr: '' };
    return { stdout: '', stderr: '' };
  });
}

describe('prepareCluster (context-only)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generic cluster type', () => {
    it('should return current state and no kind steps for generic cluster', async () => {
      mockK8sClient.ping.mockResolvedValue(true);
      mockK8sClient.checkPermissions.mockResolvedValue(true);
      mockK8sClient.namespaceExists.mockResolvedValue(true);
      mockK8sClient.checkIngressController.mockResolvedValue(true);

      (execAsyncMock as any).mockImplementation(async (cmd: string) => {
        if (cmd.includes('kubectl get nodes') && cmd.includes('architecture'))
          return { stdout: 'amd64', stderr: '' };
        if (cmd.includes('kubectl get nodes') && cmd.includes('operatingSystem'))
          return { stdout: 'linux', stderr: '' };
        return { stdout: '', stderr: '' };
      });

      const config: PrepareClusterParams = {
        clusterType: 'generic',
        namespace: 'test-ns',
        targetPlatform: 'linux/amd64',
      };
      const result = await prepareCluster(config, createMockToolContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.currentState.clusterType).toBe('generic');
      expect(result.value.currentState.connectivity).toBe(true);
      expect(result.value.currentState.permissions).toBe(true);
      expect(result.value.currentState.namespaceExists).toBe(true);
      expect(result.value.currentState.kindInstalled).toBeNull();
      expect(result.value.currentState.kindClusterExists).toBeNull();

      const kindSteps = result.value.setupSteps.filter((s) =>
        [
          'install-kind',
          'create-kind-cluster',
          'create-registry',
          'connect-registry-network',
        ].includes(s.id),
      );
      expect(kindSteps).toHaveLength(0);

      expect(result.value.setupSteps.some((s) => s.id === 'setup-rbac')).toBe(true);
    });

    it('should include namespace step when namespace does not exist', async () => {
      mockK8sClient.ping.mockResolvedValue(true);
      mockK8sClient.checkPermissions.mockResolvedValue(true);
      mockK8sClient.namespaceExists.mockResolvedValue(false);
      mockK8sClient.checkIngressController.mockResolvedValue(false);

      (execAsyncMock as any).mockImplementation(async (cmd: string) => {
        if (cmd.includes('kubectl get nodes') && cmd.includes('architecture'))
          return { stdout: 'amd64', stderr: '' };
        return { stdout: '', stderr: '' };
      });

      const config: PrepareClusterParams = {
        clusterType: 'generic',
        namespace: 'new-ns',
        targetPlatform: 'linux/amd64',
      };
      const result = await prepareCluster(config, createMockToolContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const nsStep = result.value.setupSteps.find((s) => s.id === 'create-namespace');
      expect(nsStep).toBeDefined();
      expect(nsStep!.alreadyDone).toBe(false);
      expect(nsStep!.commands[0]).toContain('kubectl create namespace new-ns');
    });

    it('should fail when cluster is not reachable for generic type', async () => {
      mockK8sClient.ping.mockResolvedValue(false);

      const config: PrepareClusterParams = {
        clusterType: 'generic',
        namespace: 'test-ns',
        targetPlatform: 'linux/amd64',
      };
      const result = await prepareCluster(config, createMockToolContext());

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Cannot connect to Kubernetes cluster');
    });
  });

  describe('kind cluster type', () => {
    it('should detect existing kind infrastructure and mark steps as done', async () => {
      mockK8sClient.ping.mockResolvedValue(true);
      mockK8sClient.checkPermissions.mockResolvedValue(true);
      mockK8sClient.namespaceExists.mockResolvedValue(true);
      mockK8sClient.checkIngressController.mockResolvedValue(true);
      mockExecForKindExists();

      const config: PrepareClusterParams = {
        clusterType: 'kind',
        namespace: 'default',
        targetPlatform: 'linux/amd64',
      };
      const result = await prepareCluster(config, createMockToolContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const state = result.value.currentState;
      expect(state.clusterType).toBe('kind');
      expect(state.kindInstalled).toBe(true);
      expect(state.kindClusterExists).toBe(true);
      expect(state.registryExists).toBe(true);
      expect(state.registryPort).toBe(6000);
      expect(state.registryHealthy).toBe(true);
      expect(state.registryConnectedToKind).toBe(true);
      expect(state.containerdMirrorConfigured).toBe(true);

      const installStep = result.value.setupSteps.find((s) => s.id === 'install-kind');
      expect(installStep?.alreadyDone).toBe(true);

      const clusterStep = result.value.setupSteps.find((s) => s.id === 'create-kind-cluster');
      expect(clusterStep?.alreadyDone).toBe(true);

      const registryStep = result.value.setupSteps.find((s) => s.id === 'create-registry');
      expect(registryStep?.alreadyDone).toBe(true);

      const networkStep = result.value.setupSteps.find((s) => s.id === 'connect-registry-network');
      expect(networkStep?.alreadyDone).toBe(true);
    });

    it('should return pending steps when kind cluster does not exist', async () => {
      mockK8sClient.ping.mockResolvedValue(false);
      mockK8sClient.checkPermissions.mockResolvedValue(false);
      mockK8sClient.namespaceExists.mockResolvedValue(false);
      mockK8sClient.checkIngressController.mockResolvedValue(false);
      mockExecForKindNotExists();

      const config: PrepareClusterParams = {
        clusterType: 'kind',
        namespace: 'default',
        targetPlatform: 'linux/amd64',
      };
      const result = await prepareCluster(config, createMockToolContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.currentState.kindClusterExists).toBe(false);
      expect(result.value.currentState.registryExists).toBeFalsy();

      const clusterStep = result.value.setupSteps.find((s) => s.id === 'create-kind-cluster');
      expect(clusterStep?.alreadyDone).toBe(false);
      expect(clusterStep?.kindConfigPatches).toBeDefined();
      expect(clusterStep?.kindConfigPatches).toContain('containerdConfigPatches');
      expect(clusterStep?.kindConfigPatches).toContain('extraPortMappings');

      const registryStep = result.value.setupSteps.find((s) => s.id === 'create-registry');
      expect(registryStep?.alreadyDone).toBe(false);
      expect(registryStep?.commands[0]).toContain('docker run');
    });

    it('should include validation steps for kind with registry', async () => {
      mockK8sClient.ping.mockResolvedValue(true);
      mockK8sClient.checkPermissions.mockResolvedValue(true);
      mockK8sClient.namespaceExists.mockResolvedValue(true);
      mockK8sClient.checkIngressController.mockResolvedValue(true);
      mockExecForKindExists();

      const config: PrepareClusterParams = {
        clusterType: 'kind',
        namespace: 'default',
        targetPlatform: 'linux/amd64',
      };
      const result = await prepareCluster(config, createMockToolContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const validationIds = result.value.validationSteps.map((s) => s.id);
      expect(validationIds).toContain('verify-connectivity');
      expect(validationIds).toContain('verify-nodes-ready');
      expect(validationIds).toContain('verify-namespace');
      expect(validationIds).toContain('verify-registry-health');
      expect(validationIds).toContain('verify-registry-from-cluster');
      expect(validationIds).toContain('verify-registry-dns');
    });

    it('should not include registry validation steps for generic cluster', async () => {
      mockK8sClient.ping.mockResolvedValue(true);
      mockK8sClient.checkPermissions.mockResolvedValue(true);
      mockK8sClient.namespaceExists.mockResolvedValue(true);
      mockK8sClient.checkIngressController.mockResolvedValue(true);

      (execAsyncMock as any).mockImplementation(async (cmd: string) => {
        if (cmd.includes('kubectl get nodes') && cmd.includes('architecture'))
          return { stdout: 'amd64', stderr: '' };
        return { stdout: '', stderr: '' };
      });

      const config: PrepareClusterParams = {
        clusterType: 'generic',
        namespace: 'test-ns',
        targetPlatform: 'linux/amd64',
      };
      const result = await prepareCluster(config, createMockToolContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const validationIds = result.value.validationSteps.map((s) => s.id);
      expect(validationIds).toContain('verify-connectivity');
      expect(validationIds).not.toContain('verify-registry-health');
      expect(validationIds).not.toContain('verify-registry-from-cluster');
      expect(validationIds).not.toContain('verify-registry-dns');
    });
  });

  describe('backwards compatibility', () => {
    it('should infer kind from environment=development when clusterType omitted', async () => {
      mockK8sClient.ping.mockResolvedValue(true);
      mockK8sClient.checkPermissions.mockResolvedValue(true);
      mockK8sClient.namespaceExists.mockResolvedValue(true);
      mockK8sClient.checkIngressController.mockResolvedValue(true);
      mockExecForKindExists();

      const config: PrepareClusterParams = {
        environment: 'development',
        namespace: 'default',
        targetPlatform: 'linux/amd64',
      };
      const result = await prepareCluster(config, createMockToolContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.currentState.clusterType).toBe('kind');
      expect(result.value.currentState.kindInstalled).toBe(true);
    });

    it('should infer generic from environment=production when clusterType omitted', async () => {
      mockK8sClient.ping.mockResolvedValue(true);
      mockK8sClient.checkPermissions.mockResolvedValue(true);
      mockK8sClient.namespaceExists.mockResolvedValue(true);
      mockK8sClient.checkIngressController.mockResolvedValue(true);

      (execAsyncMock as any).mockImplementation(async (cmd: string) => {
        if (cmd.includes('kubectl get nodes') && cmd.includes('architecture'))
          return { stdout: 'amd64', stderr: '' };
        return { stdout: '', stderr: '' };
      });

      const config: PrepareClusterParams = {
        environment: 'production',
        namespace: 'prod',
        targetPlatform: 'linux/amd64',
      };
      const result = await prepareCluster(config, createMockToolContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.currentState.clusterType).toBe('generic');
    });

    it('should let clusterType override environment-based inference', async () => {
      mockK8sClient.ping.mockResolvedValue(true);
      mockK8sClient.checkPermissions.mockResolvedValue(true);
      mockK8sClient.namespaceExists.mockResolvedValue(true);
      mockK8sClient.checkIngressController.mockResolvedValue(true);

      (execAsyncMock as any).mockImplementation(async (cmd: string) => {
        if (cmd.includes('kubectl get nodes') && cmd.includes('architecture'))
          return { stdout: 'amd64', stderr: '' };
        return { stdout: '', stderr: '' };
      });

      const config: PrepareClusterParams = {
        clusterType: 'generic',
        environment: 'development',
        namespace: 'override-ns',
        targetPlatform: 'linux/amd64',
      };
      const result = await prepareCluster(config, createMockToolContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.currentState.clusterType).toBe('generic');
      expect(result.value.currentState.kindInstalled).toBeNull();
    });
  });

  describe('summary and structure', () => {
    it('should produce correct summary counts', async () => {
      mockK8sClient.ping.mockResolvedValue(false);
      mockK8sClient.checkPermissions.mockResolvedValue(false);
      mockK8sClient.namespaceExists.mockResolvedValue(false);
      mockExecForKindNotExists();

      const config: PrepareClusterParams = {
        clusterType: 'kind',
        namespace: 'default',
        targetPlatform: 'linux/amd64',
      };
      const result = await prepareCluster(config, createMockToolContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.summary).toContain('setup');
      expect(result.value.summary).toContain('validation');
      expect(result.value.setupSteps.length).toBeGreaterThan(0);
      expect(result.value.validationSteps.length).toBeGreaterThan(0);
    });

    it('should not execute any shell commands that modify state', async () => {
      mockK8sClient.ping.mockResolvedValue(true);
      mockK8sClient.checkPermissions.mockResolvedValue(true);
      mockK8sClient.namespaceExists.mockResolvedValue(true);
      mockK8sClient.checkIngressController.mockResolvedValue(true);
      mockExecForKindExists();

      const config: PrepareClusterParams = {
        clusterType: 'kind',
        namespace: 'default',
        targetPlatform: 'linux/amd64',
      };
      await prepareCluster(config, createMockToolContext());

      const calls = execAsyncMock.mock.calls.map((c: any[]) => c[0] as string);
      const mutatingPatterns = [
        'kind create cluster',
        'docker run ',
        'docker start ',
        'docker network connect',
        'kubectl create namespace',
        'kubectl apply',
        'kubectl run ',
        'kind export kubeconfig',
        'sudo mv',
        'curl -Lo',
      ];

      for (const pattern of mutatingPatterns) {
        const found = calls.filter((cmd: string) => cmd.includes(pattern));
        expect(found).toHaveLength(0);
      }
    });

    it('should include warnings array even when empty', async () => {
      mockK8sClient.ping.mockResolvedValue(true);
      mockK8sClient.checkPermissions.mockResolvedValue(true);
      mockK8sClient.namespaceExists.mockResolvedValue(true);
      mockK8sClient.checkIngressController.mockResolvedValue(true);

      (execAsyncMock as any).mockImplementation(async (cmd: string) => {
        if (cmd.includes('kubectl get nodes') && cmd.includes('architecture'))
          return { stdout: 'amd64', stderr: '' };
        if (cmd.includes('kubectl get nodes') && cmd.includes('operatingSystem'))
          return { stdout: 'linux', stderr: '' };
        return { stdout: '', stderr: '' };
      });

      const config: PrepareClusterParams = {
        clusterType: 'generic',
        namespace: 'default',
        targetPlatform: 'linux/amd64',
      };
      const result = await prepareCluster(config, createMockToolContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(Array.isArray(result.value.warnings)).toBe(true);
    });
  });

  describe('platform compatibility', () => {
    it('should warn on platform mismatch with strict mode', async () => {
      mockK8sClient.ping.mockResolvedValue(true);
      mockK8sClient.checkPermissions.mockResolvedValue(true);
      mockK8sClient.namespaceExists.mockResolvedValue(true);
      mockK8sClient.checkIngressController.mockResolvedValue(true);

      const { isPlatformCompatible } = jest.requireMock('@/lib/platform') as any;
      isPlatformCompatible.mockReturnValue(false);

      (execAsyncMock as any).mockImplementation(async (cmd: string) => {
        if (cmd.includes('kubectl get nodes') && cmd.includes('architecture'))
          return { stdout: 'arm64', stderr: '' };
        if (cmd.includes('kubectl get nodes') && cmd.includes('operatingSystem'))
          return { stdout: 'linux', stderr: '' };
        return { stdout: '', stderr: '' };
      });

      const config: PrepareClusterParams = {
        clusterType: 'generic',
        namespace: 'test-ns',
        targetPlatform: 'linux/amd64',
        strictPlatformValidation: true,
      };
      const result = await prepareCluster(config, createMockToolContext());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.warnings.some((w) => w.includes('Platform mismatch'))).toBe(true);
    });
  });
});
