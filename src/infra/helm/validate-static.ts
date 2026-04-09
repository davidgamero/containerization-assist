import * as fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import type { Logger } from 'pino';
import type { HelmValidationIssue } from '@/infra/helm/types';

const CAMEL_CASE_KEY = /^[a-z][a-zA-Z0-9]*$/;

function pushIssue(
  issues: HelmValidationIssue[],
  issue: Omit<HelmValidationIssue, 'phase' | 'target'>,
): void {
  issues.push({ ...issue, phase: 'static', target: 'chart' });
}

function pushPlanIssue(
  issues: HelmValidationIssue[],
  issue: Omit<HelmValidationIssue, 'phase' | 'target'>,
): void {
  issues.push({ ...issue, phase: 'static', target: 'plan' });
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await fs.stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

async function collectTemplateFiles(templatesDir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.tpl'))) {
        files.push(entryPath);
      }
    }
  }

  await walk(templatesDir);
  return files;
}

export async function validatePlanShape(
  planFiles: Array<{ path: string; purpose: string }>,
  manifestType: string,
): Promise<HelmValidationIssue[]> {
  const issues: HelmValidationIssue[] = [];
  if (manifestType !== 'helm') {
    return issues;
  }

  const planPaths = new Set(planFiles.map((f) => f.path.replace(/\\/g, '/')));
  const hasChartYaml = Array.from(planPaths).some(
    (p) => p.endsWith('/Chart.yaml') || p === 'Chart.yaml',
  );
  const hasValuesYaml = Array.from(planPaths).some(
    (p) => p.endsWith('/values.yaml') || p === 'values.yaml',
  );
  const hasTemplateFile = Array.from(planPaths).some(
    (p) => p.includes('/templates/') || p.startsWith('templates/'),
  );

  if (!hasChartYaml) {
    pushPlanIssue(issues, {
      ruleId: 'helm-plan-missing-chart-yaml',
      severity: 'block',
      message: 'Helm plan is missing Chart.yaml.',
    });
  }

  if (!hasValuesYaml) {
    pushPlanIssue(issues, {
      ruleId: 'helm-plan-missing-values-yaml',
      severity: 'block',
      message: 'Helm plan is missing values.yaml.',
    });
  }

  if (!hasTemplateFile) {
    pushPlanIssue(issues, {
      ruleId: 'helm-plan-missing-templates',
      severity: 'block',
      message: 'Helm plan must include at least one file under templates/.',
    });
  }

  const hasLegacyK8sPath = Array.from(planPaths).some((p) => /(^|\/)k8s\/.+\.ya?ml$/i.test(p));
  if (hasLegacyK8sPath) {
    pushPlanIssue(issues, {
      ruleId: 'helm-plan-legacy-k8s-paths',
      severity: 'warn',
      message: 'Plan still includes ./k8s/*.yaml style paths instead of Helm chart structure.',
    });
  }

  return issues;
}

export async function validateChartOnDisk(
  chartPath: string,
  logger: Logger,
): Promise<HelmValidationIssue[]> {
  const issues: HelmValidationIssue[] = [];

  const chartYamlPath = path.join(chartPath, 'Chart.yaml');
  const valuesYamlPath = path.join(chartPath, 'values.yaml');
  const templatesDir = path.join(chartPath, 'templates');
  const helpersTplPath = path.join(templatesDir, '_helpers.tpl');
  const helmIgnorePath = path.join(chartPath, '.helmignore');
  const schemaPath = path.join(chartPath, 'values.schema.json');
  const lockPath = path.join(chartPath, 'Chart.lock');

  let chartData: Record<string, unknown> | undefined;

  try {
    if (!(await pathExists(chartPath))) {
      return issues;
    }
  } catch (error) {
    logger.debug({ error, chartPath }, 'Failed checking chart path existence');
    return issues;
  }

  try {
    if (!(await pathExists(chartYamlPath))) {
      pushIssue(issues, {
        ruleId: 'helm-chart-missing-chart-yaml',
        severity: 'block',
        message: 'Chart.yaml is required for a valid Helm chart.',
      });
    }
    if (!(await pathExists(valuesYamlPath))) {
      pushIssue(issues, {
        ruleId: 'helm-chart-missing-values-yaml',
        severity: 'warn',
        message: 'values.yaml is missing.',
      });
    }
    if (!(await isDirectory(templatesDir))) {
      pushIssue(issues, {
        ruleId: 'helm-chart-missing-templates-dir',
        severity: 'block',
        message: 'templates/ directory is required for a Helm chart.',
      });
    }
    if (!(await pathExists(helpersTplPath))) {
      pushIssue(issues, {
        ruleId: 'helm-chart-missing-helpers-tpl',
        severity: 'suggest',
        message: 'Consider adding templates/_helpers.tpl for reusable named templates.',
      });
    }
    if (!(await pathExists(helmIgnorePath))) {
      pushIssue(issues, {
        ruleId: 'helm-chart-missing-helmignore',
        severity: 'suggest',
        message: 'Consider adding .helmignore to avoid packaging unnecessary files.',
      });
    }
  } catch (error) {
    logger.debug({ error, chartPath }, 'Failed during Helm chart structure validation');
  }

  try {
    if (await pathExists(chartYamlPath)) {
      const content = await fs.readFile(chartYamlPath, 'utf8');
      const parsed = yaml.load(content);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        pushIssue(issues, {
          ruleId: 'helm-chart-invalid-chart-yaml',
          severity: 'block',
          message: 'Chart.yaml must be a valid YAML mapping/object.',
        });
      } else {
        chartData = parsed as Record<string, unknown>;

        if (typeof chartData.apiVersion !== 'string' || chartData.apiVersion.trim() === '') {
          pushIssue(issues, {
            ruleId: 'helm-chart-missing-api-version',
            severity: 'block',
            message: 'Chart.yaml must include apiVersion.',
          });
        }

        if (typeof chartData.name !== 'string' || chartData.name.trim() === '') {
          pushIssue(issues, {
            ruleId: 'helm-chart-missing-name',
            severity: 'block',
            message: 'Chart.yaml must include name.',
          });
        }

        if (typeof chartData.version !== 'string' || chartData.version.trim() === '') {
          pushIssue(issues, {
            ruleId: 'helm-chart-missing-version',
            severity: 'block',
            message: 'Chart.yaml must include version.',
          });
        }

        if (typeof chartData.appVersion === 'number') {
          pushIssue(issues, {
            ruleId: 'helm-chart-app-version-not-string',
            severity: 'warn',
            message: 'Chart.yaml appVersion should be quoted/string type.',
          });
        }

        if (typeof chartData.description !== 'string' || chartData.description.trim() === '') {
          pushIssue(issues, {
            ruleId: 'helm-chart-missing-description',
            severity: 'suggest',
            message: 'Consider adding description in Chart.yaml.',
          });
        }
      }
    }
  } catch (error) {
    logger.debug({ error, chartYamlPath }, 'Failed parsing Chart.yaml');
    pushIssue(issues, {
      ruleId: 'helm-chart-invalid-chart-yaml',
      severity: 'block',
      message: 'Chart.yaml could not be parsed as YAML.',
    });
  }

  try {
    if (await pathExists(valuesYamlPath)) {
      const valuesContent = await fs.readFile(valuesYamlPath, 'utf8');
      const valuesParsed = yaml.load(valuesContent);
      if (!valuesParsed || typeof valuesParsed !== 'object' || Array.isArray(valuesParsed)) {
        pushIssue(issues, {
          ruleId: 'helm-chart-invalid-values-yaml',
          severity: 'block',
          message: 'values.yaml must be a valid YAML mapping/object.',
        });
      } else {
        for (const key of Object.keys(valuesParsed as Record<string, unknown>)) {
          if (!CAMEL_CASE_KEY.test(key)) {
            pushIssue(issues, {
              ruleId: 'helm-chart-values-key-not-camel-case',
              severity: 'warn',
              message: `Top-level values.yaml key '${key}' should be camelCase.`,
              file: path.relative(chartPath, valuesYamlPath),
            });
          }
        }
      }
    }
  } catch (error) {
    logger.debug({ error, valuesYamlPath }, 'Failed parsing values.yaml');
    pushIssue(issues, {
      ruleId: 'helm-chart-invalid-values-yaml',
      severity: 'block',
      message: 'values.yaml could not be parsed as YAML.',
    });
  }

  try {
    if (await isDirectory(templatesDir)) {
      const chartName = typeof chartData?.name === 'string' ? chartData.name : undefined;
      const templateFiles = await collectTemplateFiles(templatesDir);

      for (const templateFile of templateFiles) {
        try {
          const content = await fs.readFile(templateFile, 'utf8');
          const relativeFile = path.relative(chartPath, templateFile);

          if (/\{\{\s*-?\s*template\s+/m.test(content)) {
            pushIssue(issues, {
              ruleId: 'helm-chart-template-use-include',
              severity: 'warn',
              message:
                'Use {{ include ... }} instead of {{ template ... }} for better pipeline behavior.',
              file: relativeFile,
            });
          }

          if (/\|\s*indent\s+\d+/m.test(content)) {
            pushIssue(issues, {
              ruleId: 'helm-chart-template-use-nindent',
              severity: 'warn',
              message:
                'Prefer | nindent over | indent in templates to preserve leading newline semantics.',
              file: relativeFile,
            });
          }

          const lines = content.split(/\r?\n/);
          for (const line of lines) {
            if (/toYaml\s+\./.test(line) && !/\|\s*(nindent|indent)\s+\d+/.test(line)) {
              pushIssue(issues, {
                ruleId: 'helm-chart-template-toyaml-without-indent',
                severity: 'warn',
                message:
                  'toYaml . should usually be piped to | nindent or | indent to keep valid YAML structure.',
                file: relativeFile,
              });
              break;
            }
          }

          const defineMatches = content.matchAll(/\{\{-?\s*define\s+"([^"]+)"/g);
          for (const match of defineMatches) {
            const templateName = match[1];
            if (!templateName) {
              continue;
            }

            const hasExpectedPrefix = chartName
              ? templateName.startsWith(`${chartName}.`)
              : templateName.includes('.');
            if (!hasExpectedPrefix) {
              pushIssue(issues, {
                ruleId: 'helm-chart-template-define-prefix',
                severity: 'warn',
                message: `Named template '${templateName}' should be prefixed with chart name.`,
                file: relativeFile,
              });
            }
          }
        } catch (error) {
          logger.debug({ error, templateFile }, 'Failed reading template file for static analysis');
        }
      }
    }
  } catch (error) {
    logger.debug({ error, templatesDir }, 'Failed scanning templates directory');
  }

  try {
    if (await pathExists(schemaPath)) {
      const schemaRaw = await fs.readFile(schemaPath, 'utf8');
      JSON.parse(schemaRaw);
    }
  } catch (error) {
    logger.debug({ error, schemaPath }, 'Invalid values.schema.json');
    pushIssue(issues, {
      ruleId: 'helm-chart-invalid-values-schema',
      severity: 'block',
      message: 'values.schema.json exists but is not valid JSON.',
      file: path.relative(chartPath, schemaPath),
    });
  }

  try {
    const dependencies = chartData?.dependencies;
    const hasDependencies = Array.isArray(dependencies) && dependencies.length > 0;
    if (hasDependencies && !(await pathExists(lockPath))) {
      pushIssue(issues, {
        ruleId: 'helm-chart-missing-lock-file',
        severity: 'warn',
        message: 'Chart.yaml declares dependencies but Chart.lock is missing.',
        file: path.relative(chartPath, lockPath),
      });
    }
  } catch (error) {
    logger.debug({ error, lockPath }, 'Failed checking Chart.lock consistency');
  }

  return issues;
}
