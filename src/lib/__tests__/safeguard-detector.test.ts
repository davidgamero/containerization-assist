/**
 * Safeguard Detector Tests
 *
 * Tests for detectSafeguardLevel() function with az CLI, kubectl, and offline fallback.
 * Uses TDD approach: tests define expected behavior before implementation.
 */

import { describe, it, expect, mock } from 'bun:test';
import type { Logger } from 'pino';

// Mock logger for tests
const mockLogger: Logger = {
  debug: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
} as unknown as Logger;

// Mock exec function for child_process testing
type ExecResult = { stdout: string; stderr: string };
type ExecFunction = (command: string, options?: { timeout: number }) => Promise<ExecResult>;

describe('detectSafeguardLevel', () => {
  describe('Azure CLI detection', () => {
    it('detects Warning level from az CLI', async () => {
      const { detectSafeguardLevel } = await import('../safeguard-detector');

      // Mock execAsync to return az CLI success with Warning level
      const mockExec: ExecFunction = async (command) => {
        if (command.includes('kubectl config current-context')) {
          return { stdout: 'my-aks\n', stderr: '' };
        }
        if (command.includes('kubectl config view')) {
          return {
            stdout: JSON.stringify({
              contexts: [{ name: 'my-aks', context: { cluster: 'my-cluster' } }],
              clusters: [{ name: 'my-cluster', cluster: { server: 'https://my-rg-my-cluster-abc.hcp.eastus.azmk8s.io:443' } }],
            }),
            stderr: '',
          };
        }
        if (command.includes('az aks show')) {
          return {
            stdout: JSON.stringify({
              level: 'Warning',
              version: 'v1.0.0',
              excludedNamespaces: ['kube-system', 'gatekeeper-system'],
            }),
            stderr: '',
          };
        }
        throw new Error('Command not recognized');
      };

      const result = await detectSafeguardLevel({
        logger: mockLogger,
        _mockExec: mockExec,
      });

      expect(result.level).toBe('warn');
      expect(result.source).toBe('az-cli');
      expect(result.version).toBe('v1.0.0');
      expect(result.excludedNamespaces).toEqual(['kube-system', 'gatekeeper-system']);
    });

    it('detects Enforcement level from az CLI', async () => {
      const { detectSafeguardLevel } = await import('../safeguard-detector');
      
      const mockExec: ExecFunction = async (command) => {
        if (command.includes('kubectl config current-context')) {
          return { stdout: 'my-aks\n', stderr: '' };
        }
        if (command.includes('kubectl config view')) {
          return {
            stdout: JSON.stringify({
              contexts: [{ name: 'my-aks', context: { cluster: 'my-cluster' } }],
              clusters: [{ name: 'my-cluster', cluster: { server: 'https://my-rg-my-cluster-abc.hcp.eastus.azmk8s.io:443' } }],
            }),
            stderr: '',
          };
        }
        if (command.includes('az aks show')) {
          return {
            stdout: JSON.stringify({
              level: 'Enforcement',
              version: 'v1.1.0',
              excludedNamespaces: ['kube-system'],
            }),
            stderr: '',
          };
        }
        throw new Error('Command not recognized');
      };

      const result = await detectSafeguardLevel({
        logger: mockLogger,
        _mockExec: mockExec,
      });

      expect(result.level).toBe('enforce');
      expect(result.source).toBe('az-cli');
      expect(result.version).toBe('v1.1.0');
    });

    it('falls back to kubectl when az CLI not found', async () => {
      const { detectSafeguardLevel } = await import('../safeguard-detector');
      
      const mockExec: ExecFunction = async (command) => {
        if (command.includes('kubectl config')) {
          throw new Error('kubectl not configured');
        }
        if (command.includes('az aks show')) {
          throw new Error('az: command not found');
        }
        if (command.includes('kubectl get constrainttemplates')) {
          return {
            stdout: JSON.stringify({
              items: [
                { metadata: { name: 'k8sazurev2containerresourcelimits' } },
                { metadata: { name: 'k8sazurev2containerenforceprobes' } },
              ],
            }),
            stderr: '',
          };
        }
        throw new Error('Command not recognized');
      };

      const result = await detectSafeguardLevel({
        logger: mockLogger,
        _mockExec: mockExec,
      });

      expect(result.level).toBe('warn');
      expect(result.source).toBe('kubectl');
    });

    it('falls back to kubectl when az CLI fails with JSON parse error', async () => {
      const { detectSafeguardLevel } = await import('../safeguard-detector');
      
      const mockExec: ExecFunction = async (command) => {
        if (command.includes('kubectl config current-context')) {
          return { stdout: 'my-aks\n', stderr: '' };
        }
        if (command.includes('kubectl config view')) {
          return {
            stdout: JSON.stringify({
              contexts: [{ name: 'my-aks', context: { cluster: 'my-cluster' } }],
              clusters: [{ name: 'my-cluster', cluster: { server: 'https://my-rg-my-cluster-abc.hcp.eastus.azmk8s.io:443' } }],
            }),
            stderr: '',
          };
        }
        if (command.includes('az aks show')) {
          return {
            stdout: 'invalid json',
            stderr: '',
          };
        }
        if (command.includes('kubectl get constrainttemplates')) {
          return {
            stdout: JSON.stringify({ items: [] }),
            stderr: '',
          };
        }
        throw new Error('Command not recognized');
      };

      const result = await detectSafeguardLevel({
        logger: mockLogger,
        _mockExec: mockExec,
      });

      expect(result.level).toBe('off');
      expect(result.source).toBe('kubectl');
    });
  });

  describe('kubectl fallback detection', () => {
    it('detects Gatekeeper present (warn) from kubectl', async () => {
      const { detectSafeguardLevel } = await import('../safeguard-detector');

      const mockExec: ExecFunction = async (command) => {
        if (command.includes('az aks show')) {
          throw new Error('az not available');
        }
        if (command.includes('kubectl get constrainttemplates')) {
          return {
            stdout: JSON.stringify({
              items: [{ metadata: { name: 'template1' } }],
            }),
            stderr: '',
          };
        }
        throw new Error('Command not recognized');
      };

      const result = await detectSafeguardLevel({
        logger: mockLogger,
        _mockExec: mockExec,
      });

      expect(result.level).toBe('warn');
      expect(result.source).toBe('kubectl');
    });

    it('detects Gatekeeper absent (off) from kubectl', async () => {
      const { detectSafeguardLevel } = await import('../safeguard-detector');

      const mockExec: ExecFunction = async (command) => {
        if (command.includes('az aks show')) {
          throw new Error('az not available');
        }
        if (command.includes('kubectl get constrainttemplates')) {
          return {
            stdout: JSON.stringify({ items: [] }),
            stderr: '',
          };
        }
        throw new Error('Command not recognized');
      };

      const result = await detectSafeguardLevel({
        logger: mockLogger,
        _mockExec: mockExec,
      });

      expect(result.level).toBe('off');
      expect(result.source).toBe('kubectl');
    });

    it('handles kubectl command failure', async () => {
      const { detectSafeguardLevel } = await import('../safeguard-detector');

      const mockExec: ExecFunction = async (command) => {
        if (command.includes('az aks show')) {
          throw new Error('az not available');
        }
        if (command.includes('kubectl get constrainttemplates')) {
          throw new Error('kubectl: command not found');
        }
        throw new Error('Command not recognized');
      };

      const result = await detectSafeguardLevel({
        logger: mockLogger,
        _mockExec: mockExec,
      });

      expect(result.level).toBe('unknown');
      expect(result.source).toBe('offline');
    });
  });

  describe('offline fallback', () => {
    it('returns unknown when both az and kubectl unavailable', async () => {
      const { detectSafeguardLevel } = await import('../safeguard-detector');

      const mockExec: ExecFunction = async () => {
        throw new Error('No CLI tools available');
      };

      const result = await detectSafeguardLevel({
        logger: mockLogger,
        _mockExec: mockExec,
      });

      expect(result.level).toBe('unknown');
      expect(result.source).toBe('offline');
    });

    it('returns unknown when all commands timeout', async () => {
      const { detectSafeguardLevel } = await import('../safeguard-detector');

      const mockExec: ExecFunction = async () => {
        throw new Error('Timeout exceeded');
      };

      const result = await detectSafeguardLevel({
        logger: mockLogger,
        _mockExec: mockExec,
      });

      expect(result.level).toBe('unknown');
      expect(result.source).toBe('offline');
    });
  });

  describe('cluster context extraction', () => {
    it('extracts resource group and cluster name from kubectl context', async () => {
      const { detectSafeguardLevel } = await import('../safeguard-detector');

      const mockExec: ExecFunction = async (command) => {
        if (command.includes('kubectl config current-context')) {
          return {
            stdout: 'my-cluster\n',
            stderr: '',
          };
        }
        if (command.includes('kubectl config view')) {
          return {
            stdout: JSON.stringify({
              contexts: [
                { name: 'my-cluster', context: { cluster: 'my-aks-cluster', user: 'user@azure.com' } },
              ],
              clusters: [
                { name: 'my-aks-cluster', cluster: { server: 'https://my-rg-my-cluster-abc123.hcp.eastus.azmk8s.io:443' } },
              ],
            }),
            stderr: '',
          };
        }
        if (command.includes('az aks show')) {
          return {
            stdout: JSON.stringify({ level: 'Warning', version: 'v1.0.0' }),
            stderr: '',
          };
        }
        throw new Error('Command not recognized');
      };

      const result = await detectSafeguardLevel({
        logger: mockLogger,
        _mockExec: mockExec,
      });

      expect(result.level).toBe('warn');
      expect(result.source).toBe('az-cli');
    });

    it('uses provided clusterContext to extract resource group and cluster name', async () => {
      const { detectSafeguardLevel } = await import('../safeguard-detector');

      const mockExec: ExecFunction = async (command) => {
        if (command.includes('az aks show')) {
          return {
            stdout: JSON.stringify({ level: 'Enforcement', version: 'v1.0.0' }),
            stderr: '',
          };
        }
        throw new Error('Command not recognized');
      };

      const result = await detectSafeguardLevel({
        clusterContext: 'my-rg-my-cluster',
        logger: mockLogger,
        _mockExec: mockExec,
      });

      expect(result.level).toBe('enforce');
      expect(result.source).toBe('az-cli');
    });
  });

  describe('timeout handling', () => {
    it('respects 10-second timeout per CLI call', async () => {
      const { detectSafeguardLevel } = await import('../safeguard-detector');

      const mockExec: ExecFunction = async (_command, options) => {
        expect(options?.timeout).toBe(10000);
        throw new Error('Timeout');
      };

      const result = await detectSafeguardLevel({
        logger: mockLogger,
        _mockExec: mockExec,
      });

      expect(result.level).toBe('unknown');
      expect(result.source).toBe('offline');
    });
  });
});
