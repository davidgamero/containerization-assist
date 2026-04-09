import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Logger } from 'pino';

import { validateChartOnDisk, validatePlanShape } from '@/infra/helm/validate-static';

interface ChartFixtureOptions {
  includeChartYaml?: boolean;
  chartYamlContent?: string;
  includeValuesYaml?: boolean;
  valuesYamlContent?: string;
  includeTemplatesDir?: boolean;
  includeHelpersTpl?: boolean;
  helpersTplContent?: string;
  includeHelmIgnore?: boolean;
  templateFiles?: Array<{ relativePath: string; content: string }>;
  includeSchema?: boolean;
  schemaContent?: string;
  includeChartLock?: boolean;
}

describe('validate-static', () => {
  describe('validatePlanShape', () => {
    it('returns empty issues for non-helm manifestType', async () => {
      const issues = await validatePlanShape([], 'kubernetes');
      expect(issues).toEqual([]);
    });

    it('returns block issue when Chart.yaml is missing from plan files', async () => {
      const issues = await validatePlanShape(
        [
          { path: 'values.yaml', purpose: 'values' },
          { path: 'templates/deployment.yaml', purpose: 'manifest' },
        ],
        'helm',
      );

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-plan-missing-chart-yaml',
            severity: 'block',
            phase: 'static',
            target: 'plan',
          }),
        ]),
      );
    });

    it('returns block issue when values.yaml is missing', async () => {
      const issues = await validatePlanShape(
        [
          { path: 'Chart.yaml', purpose: 'chart' },
          { path: 'templates/deployment.yaml', purpose: 'manifest' },
        ],
        'helm',
      );

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-plan-missing-values-yaml',
            severity: 'block',
            phase: 'static',
            target: 'plan',
          }),
        ]),
      );
    });

    it('returns block issue when no template file is present', async () => {
      const issues = await validatePlanShape(
        [
          { path: 'Chart.yaml', purpose: 'chart' },
          { path: 'values.yaml', purpose: 'values' },
        ],
        'helm',
      );

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-plan-missing-templates',
            severity: 'block',
            phase: 'static',
            target: 'plan',
          }),
        ]),
      );
    });

    it('returns warn for legacy k8s paths', async () => {
      const issues = await validatePlanShape(
        [
          { path: 'Chart.yaml', purpose: 'chart' },
          { path: 'values.yaml', purpose: 'values' },
          { path: 'templates/deployment.yaml', purpose: 'manifest' },
          { path: 'k8s/deployment.yaml', purpose: 'legacy' },
        ],
        'helm',
      );

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-plan-legacy-k8s-paths',
            severity: 'warn',
            phase: 'static',
            target: 'plan',
          }),
        ]),
      );
    });

    it('returns no issues for a valid plan', async () => {
      const issues = await validatePlanShape(
        [
          { path: 'Chart.yaml', purpose: 'chart' },
          { path: 'values.yaml', purpose: 'values' },
          { path: 'templates/deployment.yaml', purpose: 'manifest' },
        ],
        'helm',
      );

      expect(issues).toEqual([]);
    });

    it('handles Windows-style backslash paths', async () => {
      const issues = await validatePlanShape(
        [
          { path: 'chart\\Chart.yaml', purpose: 'chart' },
          { path: 'chart\\values.yaml', purpose: 'values' },
          { path: 'chart\\templates\\deployment.yaml', purpose: 'manifest' },
        ],
        'helm',
      );

      expect(issues).toEqual([]);
    });
  });

  describe('validateChartOnDisk', () => {
    let tmpDir: string;
    let logger: Logger;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'validate-static-test-'));
      logger = {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        child: jest.fn(),
      } as unknown as Logger;
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    async function scaffoldChart(options: ChartFixtureOptions = {}): Promise<string> {
      const chartPath = path.join(tmpDir, 'chart');
      const includeChartYaml = options.includeChartYaml ?? true;
      const includeValuesYaml = options.includeValuesYaml ?? true;
      const includeTemplatesDir = options.includeTemplatesDir ?? true;
      const includeHelpersTpl = options.includeHelpersTpl ?? true;
      const includeHelmIgnore = options.includeHelmIgnore ?? true;

      await fs.mkdir(chartPath, { recursive: true });

      if (includeChartYaml) {
        await fs.writeFile(
          path.join(chartPath, 'Chart.yaml'),
          options.chartYamlContent ??
            [
              'apiVersion: v2',
              'name: mychart',
              'version: 0.1.0',
              'appVersion: "1.0.0"',
              'description: Test chart',
            ].join('\n'),
          'utf8',
        );
      }

      if (includeValuesYaml) {
        await fs.writeFile(
          path.join(chartPath, 'values.yaml'),
          options.valuesYamlContent ?? 'replicaCount: 1\nimageTag: latest\n',
          'utf8',
        );
      }

      if (includeTemplatesDir) {
        await fs.mkdir(path.join(chartPath, 'templates'), { recursive: true });
      }

      if (includeTemplatesDir && includeHelpersTpl) {
        await fs.writeFile(
          path.join(chartPath, 'templates', '_helpers.tpl'),
          options.helpersTplContent ??
            '{{- define "mychart.fullname" -}}\n{{- printf "%s" .Chart.Name -}}\n{{- end -}}\n',
          'utf8',
        );
      }

      if (includeHelmIgnore) {
        await fs.writeFile(path.join(chartPath, '.helmignore'), '.DS_Store\n', 'utf8');
      }

      const templateFiles = options.templateFiles ?? [
        {
          relativePath: 'templates/deployment.yaml',
          content:
            '{{ include "mychart.fullname" . }}\n{{ toYaml .Values | nindent 2 }}\napiVersion: apps/v1\n',
        },
      ];

      for (const templateFile of templateFiles) {
        const fullPath = path.join(chartPath, templateFile.relativePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, templateFile.content, 'utf8');
      }

      if (options.includeSchema) {
        await fs.writeFile(
          path.join(chartPath, 'values.schema.json'),
          options.schemaContent ?? '{"type":"object"}',
          'utf8',
        );
      }

      if (options.includeChartLock) {
        await fs.writeFile(path.join(chartPath, 'Chart.lock'), 'digest: abc123\n', 'utf8');
      }

      return chartPath;
    }

    it("returns empty issues when chart path doesn't exist", async () => {
      const issues = await validateChartOnDisk(path.join(tmpDir, 'missing-chart'), logger);
      expect(issues).toEqual([]);
    });

    it('returns block for missing Chart.yaml', async () => {
      const chartPath = await scaffoldChart({ includeChartYaml: false });
      const issues = await validateChartOnDisk(chartPath, logger);

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-chart-missing-chart-yaml',
            severity: 'block',
            phase: 'static',
            target: 'chart',
          }),
        ]),
      );
    });

    it('returns warn for missing values.yaml', async () => {
      const chartPath = await scaffoldChart({ includeValuesYaml: false });
      const issues = await validateChartOnDisk(chartPath, logger);

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-chart-missing-values-yaml',
            severity: 'warn',
          }),
        ]),
      );
    });

    it('returns block for missing templates/ directory', async () => {
      const chartPath = await scaffoldChart({
        includeTemplatesDir: false,
        includeHelpersTpl: false,
        templateFiles: [],
      });
      const issues = await validateChartOnDisk(chartPath, logger);

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-chart-missing-templates-dir',
            severity: 'block',
          }),
        ]),
      );
    });

    it('returns suggest for missing _helpers.tpl', async () => {
      const chartPath = await scaffoldChart({ includeHelpersTpl: false });
      const issues = await validateChartOnDisk(chartPath, logger);

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-chart-missing-helpers-tpl',
            severity: 'suggest',
          }),
        ]),
      );
    });

    it('returns suggest for missing .helmignore', async () => {
      const chartPath = await scaffoldChart({ includeHelmIgnore: false });
      const issues = await validateChartOnDisk(chartPath, logger);

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-chart-missing-helmignore',
            severity: 'suggest',
          }),
        ]),
      );
    });

    it('returns block for invalid Chart.yaml (not valid YAML)', async () => {
      const chartPath = await scaffoldChart({ chartYamlContent: 'apiVersion: [v2\n' });
      const issues = await validateChartOnDisk(chartPath, logger);

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-chart-invalid-chart-yaml',
            severity: 'block',
          }),
        ]),
      );
    });

    it('returns block for missing apiVersion in Chart.yaml', async () => {
      const chartPath = await scaffoldChart({
        chartYamlContent: ['name: mychart', 'version: 0.1.0', 'description: Test chart'].join('\n'),
      });
      const issues = await validateChartOnDisk(chartPath, logger);

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-chart-missing-api-version',
            severity: 'block',
          }),
        ]),
      );
    });

    it('returns block for missing name in Chart.yaml', async () => {
      const chartPath = await scaffoldChart({
        chartYamlContent: ['apiVersion: v2', 'version: 0.1.0', 'description: Test chart'].join(
          '\n',
        ),
      });
      const issues = await validateChartOnDisk(chartPath, logger);

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-chart-missing-name',
            severity: 'block',
          }),
        ]),
      );
    });

    it('returns block for missing version in Chart.yaml', async () => {
      const chartPath = await scaffoldChart({
        chartYamlContent: ['apiVersion: v2', 'name: mychart', 'description: Test chart'].join('\n'),
      });
      const issues = await validateChartOnDisk(chartPath, logger);

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-chart-missing-version',
            severity: 'block',
          }),
        ]),
      );
    });

    it('returns warn for numeric appVersion (should be string)', async () => {
      const chartPath = await scaffoldChart({
        chartYamlContent: [
          'apiVersion: v2',
          'name: mychart',
          'version: 0.1.0',
          'appVersion: 1.2',
          'description: Test chart',
        ].join('\n'),
      });
      const issues = await validateChartOnDisk(chartPath, logger);

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-chart-app-version-not-string',
            severity: 'warn',
          }),
        ]),
      );
    });

    it('returns suggest for missing description', async () => {
      const chartPath = await scaffoldChart({
        chartYamlContent: ['apiVersion: v2', 'name: mychart', 'version: 0.1.0'].join('\n'),
      });
      const issues = await validateChartOnDisk(chartPath, logger);

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-chart-missing-description',
            severity: 'suggest',
          }),
        ]),
      );
    });

    it('returns warn for non-camelCase top-level values.yaml keys', async () => {
      const chartPath = await scaffoldChart({
        valuesYamlContent: 'image_tag: latest\n',
      });
      const issues = await validateChartOnDisk(chartPath, logger);

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-chart-values-key-not-camel-case',
            severity: 'warn',
            file: 'values.yaml',
          }),
        ]),
      );
    });

    it('returns block for invalid values.yaml (not an object)', async () => {
      const chartPath = await scaffoldChart({
        valuesYamlContent: '- itemA\n- itemB\n',
      });
      const issues = await validateChartOnDisk(chartPath, logger);

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-chart-invalid-values-yaml',
            severity: 'block',
          }),
        ]),
      );
    });

    it('returns warn for {{ template }} usage (should use {{ include }})', async () => {
      const chartPath = await scaffoldChart({
        templateFiles: [
          {
            relativePath: 'templates/deployment.yaml',
            content: '{{ template "mychart.fullname" . }}\n',
          },
        ],
      });
      const issues = await validateChartOnDisk(chartPath, logger);

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-chart-template-use-include',
            severity: 'warn',
            file: 'templates/deployment.yaml',
          }),
        ]),
      );
    });

    it('returns warn for | indent (should use | nindent)', async () => {
      const chartPath = await scaffoldChart({
        templateFiles: [
          {
            relativePath: 'templates/deployment.yaml',
            content: '{{ toYaml .Values | indent 2 }}\n',
          },
        ],
      });
      const issues = await validateChartOnDisk(chartPath, logger);

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-chart-template-use-nindent',
            severity: 'warn',
            file: 'templates/deployment.yaml',
          }),
        ]),
      );
    });

    it('returns warn for toYaml . without indent', async () => {
      const chartPath = await scaffoldChart({
        templateFiles: [
          {
            relativePath: 'templates/deployment.yaml',
            content: '{{ toYaml .Values }}\n{{ toYaml . }}\n',
          },
        ],
      });
      const issues = await validateChartOnDisk(chartPath, logger);

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-chart-template-toyaml-without-indent',
            severity: 'warn',
            file: 'templates/deployment.yaml',
          }),
        ]),
      );
    });

    it('returns warn for named templates without chart name prefix', async () => {
      const chartPath = await scaffoldChart({
        templateFiles: [
          {
            relativePath: 'templates/custom.tpl',
            content: '{{- define "fullname" -}}\nfoo\n{{- end -}}\n',
          },
        ],
      });
      const issues = await validateChartOnDisk(chartPath, logger);

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-chart-template-define-prefix',
            severity: 'warn',
            file: 'templates/custom.tpl',
          }),
        ]),
      );
    });

    it('returns block for invalid values.schema.json', async () => {
      const chartPath = await scaffoldChart({
        includeSchema: true,
        schemaContent: '{ invalid json }',
      });
      const issues = await validateChartOnDisk(chartPath, logger);

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-chart-invalid-values-schema',
            severity: 'block',
            file: 'values.schema.json',
          }),
        ]),
      );
    });

    it('returns warn for missing Chart.lock when dependencies exist', async () => {
      const chartPath = await scaffoldChart({
        chartYamlContent: [
          'apiVersion: v2',
          'name: mychart',
          'version: 0.1.0',
          'description: Test chart',
          'dependencies:',
          '  - name: redis',
          '    version: 1.0.0',
          '    repository: "https://example.com/charts"',
        ].join('\n'),
      });
      const issues = await validateChartOnDisk(chartPath, logger);

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'helm-chart-missing-lock-file',
            severity: 'warn',
            file: 'Chart.lock',
          }),
        ]),
      );
    });

    it('returns no issues for a fully valid chart', async () => {
      const chartPath = await scaffoldChart({
        includeSchema: true,
        schemaContent: '{"$schema":"http://json-schema.org/draft-07/schema#","type":"object"}',
      });

      const issues = await validateChartOnDisk(chartPath, logger);
      expect(issues).toEqual([]);
    });
  });
});
