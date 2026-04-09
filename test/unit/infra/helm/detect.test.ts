import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Logger } from 'pino';

let mockExecFileAsync: jest.MockedFunction<
  (file: string, args: string[], options?: unknown) => Promise<{ stdout: string; stderr?: string }>
>;

const promisifiedFunctions = new Map<(...args: unknown[]) => unknown, 'execFile'>();

jest.mock('node:child_process', () => {
  const mockExecFileFn = jest.fn();
  promisifiedFunctions.set(mockExecFileFn, 'execFile');
  return {
    execFile: mockExecFileFn,
  };
});

jest.mock('node:util', () => {
  const actual = jest.requireActual<typeof import('node:util')>('node:util');
  return {
    ...actual,
    promisify: (fn: (...args: unknown[]) => unknown) => {
      const fnType = promisifiedFunctions.get(fn);
      return (...args: unknown[]) => {
        if (fnType === 'execFile') {
          if (!mockExecFileAsync) {
            throw new Error('mockExecFileAsync not initialized');
          }
          return mockExecFileAsync(...(args as [string, string[], unknown?]));
        }
        throw new Error('Unexpected function passed to promisify');
      };
    },
  };
});

import {
  checkHelmAvailability,
  checkKubectlAvailability,
  resetDetectionCache,
} from '@/infra/helm/detect';

describe('infra/helm/detect', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    mockExecFileAsync =
      jest.fn<
        (
          file: string,
          args: string[],
          options?: unknown,
        ) => Promise<{ stdout: string; stderr?: string }>
      >();

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger;

    resetDetectionCache();
    jest.clearAllMocks();
  });

  describe('checkHelmAvailability', () => {
    it('returns Success with version when helm outputs v3.14.0+g3fc9f4b', async () => {
      mockExecFileAsync.mockResolvedValueOnce({
        stdout: 'v3.14.0+g3fc9f4b\n',
        stderr: '',
      });

      const result = await checkHelmAvailability(mockLogger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ available: true, version: '3.14.0' });
      }
      expect(mockExecFileAsync).toHaveBeenCalledWith('helm', ['version', '--short'], {
        timeout: 5000,
      });
    });

    it('returns Failure when version is below minimum', async () => {
      mockExecFileAsync.mockResolvedValueOnce({
        stdout: 'v2.17.0\n',
        stderr: '',
      });

      const result = await checkHelmAvailability(mockLogger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('below minimum required 3.0.0');
      }
    });

    it('returns Failure when helm is not found (ENOENT)', async () => {
      const err = new Error('spawn helm ENOENT') as Error & { code?: string };
      err.code = 'ENOENT';
      mockExecFileAsync.mockRejectedValueOnce(err);

      const result = await checkHelmAvailability(mockLogger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Helm CLI not found in PATH');
      }
    });

    it('returns Failure when version string is unparseable', async () => {
      mockExecFileAsync.mockResolvedValueOnce({
        stdout: 'garbage\n',
        stderr: '',
      });

      const result = await checkHelmAvailability(mockLogger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Could not parse Helm version');
      }
    });

    it('returns cached result on second call', async () => {
      mockExecFileAsync.mockResolvedValueOnce({
        stdout: 'v3.14.0+g3fc9f4b\n',
        stderr: '',
      });

      const first = await checkHelmAvailability(mockLogger);
      const second = await checkHelmAvailability(mockLogger);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
    });

    it('cache is cleared by resetDetectionCache', async () => {
      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: 'v3.14.0+g3fc9f4b\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'v3.14.1\n', stderr: '' });

      const first = await checkHelmAvailability(mockLogger);
      resetDetectionCache();
      const second = await checkHelmAvailability(mockLogger);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
    });
  });

  describe('checkKubectlAvailability', () => {
    it('returns Success when kubectl outputs Client Version: v1.28.2', async () => {
      mockExecFileAsync.mockResolvedValueOnce({
        stdout: 'Client Version: v1.28.2\n',
        stderr: '',
      });

      const result = await checkKubectlAvailability(mockLogger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ available: true, version: '1.28.2' });
      }
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'kubectl',
        ['version', '--client', '--short'],
        { timeout: 5000 },
      );
    });

    it('returns Success when --short fails but JSON fallback works', async () => {
      mockExecFileAsync
        .mockRejectedValueOnce(new Error('unknown flag: --short'))
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ clientVersion: { gitVersion: 'v1.28.2' } }),
          stderr: '',
        });

      const result = await checkKubectlAvailability(mockLogger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ available: true, version: '1.28.2' });
      }
      expect(mockExecFileAsync).toHaveBeenNthCalledWith(
        1,
        'kubectl',
        ['version', '--client', '--short'],
        { timeout: 5000 },
      );
      expect(mockExecFileAsync).toHaveBeenNthCalledWith(
        2,
        'kubectl',
        ['version', '--client', '-o', 'json'],
        { timeout: 5000 },
      );
    });

    it('returns Failure when both approaches throw', async () => {
      mockExecFileAsync
        .mockRejectedValueOnce(new Error('first failed'))
        .mockRejectedValueOnce(new Error('second failed'));

      const result = await checkKubectlAvailability(mockLogger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('kubectl not found in PATH');
      }
    });

    it('caches results properly', async () => {
      mockExecFileAsync.mockResolvedValueOnce({
        stdout: 'Client Version: v1.28.2\n',
        stderr: '',
      });

      const first = await checkKubectlAvailability(mockLogger);
      const second = await checkKubectlAvailability(mockLogger);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe('resetDetectionCache', () => {
    it('clears both helm and kubectl caches', async () => {
      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: 'v3.14.0\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'Client Version: v1.28.2\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'v3.14.1\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'Client Version: v1.28.3\n', stderr: '' });

      await checkHelmAvailability(mockLogger);
      await checkKubectlAvailability(mockLogger);
      expect(mockExecFileAsync).toHaveBeenCalledTimes(2);

      await checkHelmAvailability(mockLogger);
      await checkKubectlAvailability(mockLogger);
      expect(mockExecFileAsync).toHaveBeenCalledTimes(2);

      resetDetectionCache();

      await checkHelmAvailability(mockLogger);
      await checkKubectlAvailability(mockLogger);
      expect(mockExecFileAsync).toHaveBeenCalledTimes(4);
    });
  });
});
