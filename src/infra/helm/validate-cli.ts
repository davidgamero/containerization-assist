import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Logger } from 'pino';
import { checkKubectlAvailability } from '@/infra/helm/detect';
import { HELM_TIMEOUTS, type HelmValidationIssue } from '@/infra/helm/types';

const execFileAsync = promisify(execFile);

function parseLintIssues(output: string): HelmValidationIssue[] {
  const issues: HelmValidationIssue[] = [];
  const lines = output.split(/\r?\n/).map((line) => line.trim());

  for (const line of lines) {
    if (!line) {
      continue;
    }
    if (line.includes('[ERROR]')) {
      issues.push({
        ruleId: 'helm-lint-error',
        message: line,
        severity: 'block',
        phase: 'cli',
        target: 'chart',
      });
      continue;
    }
    if (line.includes('[WARNING]')) {
      issues.push({
        ruleId: 'helm-lint-warning',
        message: line,
        severity: 'warn',
        phase: 'cli',
        target: 'chart',
      });
    }
  }

  return issues;
}

function timedOut(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const maybeCode = (error as NodeJS.ErrnoException).code;
  return maybeCode === 'ETIMEDOUT' || /timed?\s*out/i.test(error.message);
}

function extractErrorText(error: unknown): string {
  if (error instanceof Error) {
    const withStreams = error as Error & { stderr?: string; stdout?: string };
    const stderr = withStreams.stderr?.trim();
    const stdout = withStreams.stdout?.trim();
    if (stderr) {
      return stderr;
    }
    if (stdout) {
      return stdout;
    }
    return error.message;
  }
  return String(error);
}

function isMissingDependencyError(text: string): boolean {
  return /(dependencies|dependency).*(missing|not found|build)|helm dependency build/i.test(text);
}

export async function validateChartWithCli(
  chartPath: string,
  helmVersion: string,
  logger: Logger,
): Promise<HelmValidationIssue[]> {
  const issues: HelmValidationIssue[] = [];
  logger.debug({ helmVersion, chartPath }, 'Running Helm CLI validation');

  let templateOutput = '';

  try {
    const { stdout, stderr } = await execFileAsync('helm', ['lint', '--strict', chartPath], {
      timeout: HELM_TIMEOUTS.lint,
    });
    issues.push(...parseLintIssues(`${stdout}\n${stderr}`));
  } catch (error) {
    if (timedOut(error)) {
      issues.push({
        ruleId: 'helm-lint-timeout',
        message: `helm lint timed out after ${HELM_TIMEOUTS.lint}ms.`,
        severity: 'warn',
        phase: 'cli',
        target: 'chart',
      });
    } else {
      const combined = extractErrorText(error);
      const parsed = parseLintIssues(combined);
      if (parsed.length > 0) {
        issues.push(...parsed);
      } else {
        issues.push({
          ruleId: 'helm-lint-error',
          message: combined,
          severity: 'block',
          phase: 'cli',
          target: 'chart',
        });
      }
    }
  }

  try {
    const { stdout } = await execFileAsync('helm', ['template', 'test-release', chartPath], {
      timeout: HELM_TIMEOUTS.template,
    });
    templateOutput = stdout;
  } catch (error) {
    if (timedOut(error)) {
      issues.push({
        ruleId: 'helm-template-timeout',
        message: `helm template timed out after ${HELM_TIMEOUTS.template}ms.`,
        severity: 'warn',
        phase: 'cli',
        target: 'chart',
      });
    } else {
      const errorText = extractErrorText(error);
      if (isMissingDependencyError(errorText)) {
        issues.push({
          ruleId: 'helm-template-missing-deps',
          message: errorText,
          severity: 'warn',
          phase: 'cli',
          target: 'chart',
        });
      } else {
        issues.push({
          ruleId: 'helm-template-render-error',
          message: errorText,
          severity: 'block',
          phase: 'cli',
          target: 'chart',
        });
      }
    }
  }

  if (templateOutput.trim().length > 0) {
    const kubectlResult = await checkKubectlAvailability(logger);
    if (kubectlResult.ok) {
      try {
        await new Promise<void>((resolve, reject) => {
          const child = execFile(
            'kubectl',
            ['apply', '--dry-run=client', '-f', '-'],
            { timeout: HELM_TIMEOUTS.kubectlDryRun, maxBuffer: 10 * 1024 * 1024 },
            (error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            },
          );
          child.stdin?.end(templateOutput);
        });
      } catch (error) {
        const timeoutMessage = timedOut(error)
          ? `kubectl dry-run timed out after ${HELM_TIMEOUTS.kubectlDryRun}ms.`
          : extractErrorText(error);
        issues.push({
          ruleId: 'helm-kubectl-dryrun-error',
          message: timeoutMessage,
          severity: 'warn',
          phase: 'cli',
          target: 'chart',
        });
      }
    }
  }

  return issues;
}
