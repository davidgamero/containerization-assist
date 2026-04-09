// biome-ignore assist/source/organizeImports: Keep required @jest/globals import shape/order.
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { checkHelmAvailability, checkKubectlAvailability } from '@/infra/helm/detect';
import type { HelmValidationIssue } from '@/infra/helm/types';
import { validateHelm } from '@/infra/helm/validate';
import { validateChartWithCli } from '@/infra/helm/validate-cli';
import { validateChartOnDisk, validatePlanShape } from '@/infra/helm/validate-static';
import { stat } from 'node:fs/promises';
import type { Logger } from 'pino';

jest.mock('@/infra/helm/detect', () => ({
  checkHelmAvailability: jest.fn(),
  checkKubectlAvailability: jest.fn(),
}));

jest.mock('@/infra/helm/validate-static', () => ({
  validatePlanShape: jest.fn(),
  validateChartOnDisk: jest.fn(),
}));

jest.mock('@/infra/helm/validate-cli', () => ({
  validateChartWithCli: jest.fn(),
}));

jest.mock('node:fs/promises', () => ({
  stat: jest.fn(),
}));

const mockCheckHelmAvailability = checkHelmAvailability as jest.MockedFunction<
  typeof checkHelmAvailability
>;
const mockCheckKubectlAvailability = checkKubectlAvailability as jest.MockedFunction<
  typeof checkKubectlAvailability
>;
const mockValidatePlanShape = validatePlanShape as jest.MockedFunction<typeof validatePlanShape>;
const mockValidateChartOnDisk = validateChartOnDisk as jest.MockedFunction<
  typeof validateChartOnDisk
>;
const mockValidateChartWithCli = validateChartWithCli as jest.MockedFunction<
  typeof validateChartWithCli
>;
const mockStat = stat as jest.MockedFunction<typeof stat>;

function makeIssue(
  ruleId: string,
  severity: HelmValidationIssue['severity'],
  phase: HelmValidationIssue['phase'] = 'static',
  target: HelmValidationIssue['target'] = 'plan',
): HelmValidationIssue {
  return {
    ruleId,
    message: `${ruleId} message`,
    severity,
    phase,
    target,
  };
}

function makeDirectoryStat(isDirectoryValue: boolean): Awaited<ReturnType<typeof stat>> {
  return {
    isDirectory: () => isDirectoryValue,
  } as unknown as Awaited<ReturnType<typeof stat>>;
}

describe('infra/helm/validate', () => {
  let logger: Logger;

  beforeEach(() => {
    jest.clearAllMocks();

    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger;

    mockValidatePlanShape.mockResolvedValue([]);
    mockValidateChartOnDisk.mockResolvedValue([]);
    mockValidateChartWithCli.mockResolvedValue([]);

    mockCheckHelmAvailability.mockResolvedValue({
      ok: true,
      value: { available: true, version: '3.14.0' },
    });
    mockCheckKubectlAvailability.mockResolvedValue({
      ok: true,
      value: { available: true, version: '1.30.0' },
    });

    mockStat.mockResolvedValue(makeDirectoryStat(true));
  });

  async function runValidate(overrides?: Partial<Parameters<typeof validateHelm>[0]>) {
    return validateHelm({
      chartPath: '/workspace/chart',
      planFiles: [{ path: 'Chart.yaml', purpose: 'chart-metadata' }],
      manifestType: 'helm',
      logger,
      ...overrides,
    });
  }

  describe('plan validation', () => {
    it('calls validatePlanShape with planFiles and manifestType', async () => {
      const planFiles = [{ path: 'templates/deployment.yaml', purpose: 'manifest' }];

      await runValidate({ planFiles, manifestType: 'helm' });

      expect(mockValidatePlanShape).toHaveBeenCalledWith(planFiles, 'helm');
    });

    it('includes plan issues in result.issues', async () => {
      const planIssue = makeIssue('plan-warn', 'warn', 'static', 'plan');
      mockValidatePlanShape.mockResolvedValue([planIssue]);

      const result = await runValidate();

      expect(result.issues).toContainEqual(planIssue);
    });

    it('plan issues do not prevent chart validation from running', async () => {
      mockValidatePlanShape.mockResolvedValue([makeIssue('plan-block', 'block', 'static', 'plan')]);

      await runValidate();

      expect(mockValidateChartOnDisk).toHaveBeenCalledWith('/workspace/chart', logger);
    });
  });

  describe('chart path resolution', () => {
    it('skips chart validation when chartPath is undefined', async () => {
      await runValidate({ chartPath: undefined });

      expect(mockStat).not.toHaveBeenCalled();
      expect(mockValidateChartOnDisk).not.toHaveBeenCalled();
    });

    it("skips chart validation when chartPath doesn't exist (stat throws)", async () => {
      mockStat.mockRejectedValue(new Error('ENOENT'));

      const result = await runValidate();

      expect(mockValidateChartOnDisk).not.toHaveBeenCalled();
      expect(result.targetsValidated.chartOnDisk).toBe(false);
    });

    it('skips chart validation when chartPath is not a directory', async () => {
      mockStat.mockResolvedValue(makeDirectoryStat(false));

      const result = await runValidate();

      expect(mockValidateChartOnDisk).not.toHaveBeenCalled();
      expect(result.targetsValidated.chartOnDisk).toBe(false);
    });

    it('runs chart validation when chartPath is a valid directory', async () => {
      await runValidate();

      expect(mockValidateChartOnDisk).toHaveBeenCalledWith('/workspace/chart', logger);
    });
  });

  describe('CLI validation', () => {
    it('runs when chart exists and helm is available with version', async () => {
      await runValidate();

      expect(mockValidateChartWithCli).toHaveBeenCalledWith('/workspace/chart', '3.14.0', logger);
    });

    it('is skipped when helm is not available', async () => {
      mockCheckHelmAvailability.mockResolvedValue({
        ok: false,
        error: 'Helm CLI not found in PATH',
      });

      const result = await runValidate();

      expect(mockValidateChartWithCli).not.toHaveBeenCalled();
      expect(result.phasesRun.helmCli).toBe(false);
    });

    it("is skipped when chart path doesn't exist", async () => {
      mockStat.mockRejectedValue(new Error('missing path'));

      const result = await runValidate();

      expect(mockValidateChartWithCli).not.toHaveBeenCalled();
      expect(result.phasesRun.helmCli).toBe(false);
    });
  });

  describe('result structure', () => {
    it('sets passed=true when no blocking issues', async () => {
      mockValidatePlanShape.mockResolvedValue([makeIssue('plan-warn', 'warn')]);

      const result = await runValidate();

      expect(result.passed).toBe(true);
    });

    it('sets passed=false when blocking issues exist', async () => {
      mockValidateChartOnDisk.mockResolvedValue([
        makeIssue('chart-block', 'block', 'static', 'chart'),
      ]);

      const result = await runValidate();

      expect(result.passed).toBe(false);
    });

    it('sets phase and tooling/targets fields consistently', async () => {
      mockCheckKubectlAvailability.mockResolvedValue({
        ok: true,
        value: { available: false, version: '1.30.0' },
      });

      const result = await runValidate();

      expect(result.phasesRun.static).toBe(true);
      expect(result.phasesRun.helmCli).toBe(true);
      expect(result.phasesRun.kubectlDryRun).toBe(false);
      expect(result.tooling.helm).toEqual({ available: true, version: '3.14.0' });
      expect(result.tooling.kubectl).toEqual({ available: false, version: '1.30.0' });
      expect(result.targetsValidated.plan).toBe(true);
      expect(result.targetsValidated.chartOnDisk).toBe(true);
    });

    it('sets helmCli=false and kubectlDryRun=false when CLI did not run', async () => {
      mockCheckHelmAvailability.mockResolvedValue({ ok: false, error: 'helm unavailable' });

      const result = await runValidate();

      expect(result.phasesRun.helmCli).toBe(false);
      expect(result.phasesRun.kubectlDryRun).toBe(false);
    });
  });

  describe('summary string', () => {
    it('includes issue counts', async () => {
      mockValidatePlanShape.mockResolvedValue([
        makeIssue('a', 'block', 'static', 'plan'),
        makeIssue('b', 'warn', 'static', 'plan'),
        makeIssue('c', 'suggest', 'static', 'plan'),
      ]);

      const result = await runValidate();

      expect(result.summary).toContain('1 blocking, 1 warning, 1 suggestion issue(s).');
    });

    it('includes Install Helm CLI message when helm is not available', async () => {
      mockCheckHelmAvailability.mockResolvedValue({
        ok: false,
        error: 'Helm CLI not found in PATH',
      });

      const result = await runValidate();

      expect(result.summary).toContain('Install Helm CLI for enhanced chart validation');
    });

    it('includes chart-on-disk deferred message when no chart exists', async () => {
      mockStat.mockRejectedValue(new Error('ENOENT'));

      const result = await runValidate();

      expect(result.summary).toContain('Chart validation will run after chart files are created.');
    });
  });

  describe('error handling', () => {
    it('catches and wraps validatePlanShape errors as warn issues', async () => {
      mockValidatePlanShape.mockRejectedValue(new Error('plan exploded'));

      const result = await runValidate();

      expect(result.issues).toContainEqual({
        ruleId: 'helm-plan-validation-failed',
        message: 'Plan validation encountered an internal error.',
        severity: 'warn',
        phase: 'static',
        target: 'plan',
      });
    });

    it('catches and wraps validateChartOnDisk errors as warn issues', async () => {
      mockValidateChartOnDisk.mockRejectedValue(new Error('chart exploded'));

      const result = await runValidate();

      expect(result.issues).toContainEqual({
        ruleId: 'helm-chart-static-validation-failed',
        message: 'Chart static validation encountered an internal error.',
        severity: 'warn',
        phase: 'static',
        target: 'chart',
      });
    });

    it('catches and wraps validateChartWithCli errors as warn issues', async () => {
      mockValidateChartWithCli.mockRejectedValue(new Error('cli exploded'));

      const result = await runValidate();

      expect(result.issues).toContainEqual({
        ruleId: 'helm-cli-validation-failed',
        message: 'Helm CLI validation encountered an internal error.',
        severity: 'warn',
        phase: 'cli',
        target: 'chart',
      });
    });
  });

  describe('integration-style flows', () => {
    it('collects plan + chart + CLI issues when all phases run', async () => {
      const planIssue = makeIssue('plan-warn', 'warn', 'static', 'plan');
      const chartIssue = makeIssue('chart-warn', 'warn', 'static', 'chart');
      const cliIssue = makeIssue('cli-block', 'block', 'cli', 'chart');

      mockValidatePlanShape.mockResolvedValue([planIssue]);
      mockValidateChartOnDisk.mockResolvedValue([chartIssue]);
      mockValidateChartWithCli.mockResolvedValue([cliIssue]);

      const result = await runValidate();

      expect(result.issues).toEqual(expect.arrayContaining([planIssue, chartIssue, cliIssue]));
      expect(result.phasesRun.static).toBe(true);
      expect(result.phasesRun.helmCli).toBe(true);
      expect(result.phasesRun.kubectlDryRun).toBe(true);
      expect(result.targetsValidated.chartOnDisk).toBe(true);
      expect(result.tooling.helm).toEqual({ available: true, version: '3.14.0' });
      expect(result.tooling.kubectl).toEqual({ available: true, version: '1.30.0' });
    });

    it('runs only plan validation when no chart and no helm', async () => {
      mockStat.mockRejectedValue(new Error('ENOENT'));
      mockCheckHelmAvailability.mockResolvedValue({ ok: false, error: 'helm unavailable' });

      const result = await runValidate({ chartPath: '/workspace/missing-chart' });

      expect(mockValidatePlanShape).toHaveBeenCalledTimes(1);
      expect(mockValidateChartOnDisk).not.toHaveBeenCalled();
      expect(mockValidateChartWithCli).not.toHaveBeenCalled();
      expect(result.phasesRun.static).toBe(true);
      expect(result.phasesRun.helmCli).toBe(false);
      expect(result.targetsValidated.plan).toBe(true);
      expect(result.targetsValidated.chartOnDisk).toBe(false);
    });
  });
});
