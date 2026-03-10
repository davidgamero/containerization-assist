import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolContext } from '../../../core/context';
import { createLogger } from '../../../lib/logger';
import validateManifestsTool from '../tool';

const logger = createLogger({ name: 'validate-manifests-integration-test', level: 'error' });

const ctx: ToolContext = {
  logger,
  queryConfig: async () => null,
};

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

const nonCompliantMultiDocYaml = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: no-limits-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: no-limits-app
  template:
    metadata:
      labels:
        app: no-limits-app
    spec:
      containers:
        - name: app
          image: nginx:latest
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: bad-pdb
spec:
  maxUnavailable: 0
  selector:
    matchLabels:
      app: no-limits-app
`;

const compliantMultiDocYaml = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: compliant-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: compliant-app
  template:
    metadata:
      labels:
        app: compliant-app
    spec:
      imagePullSecrets:
        - name: registry-secret
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchLabels:
                  app: compliant-app
              topologyKey: kubernetes.io/hostname
      containers:
        - name: app
          image: mcr.microsoft.com/azurelinux/base:3.0
          resources:
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
          livenessProbe:
            httpGet:
              path: /live
              port: 8080
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: good-pdb
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: compliant-app
`;

describe('validate-manifests integration', () => {
  it('end-to-end non-compliant multi-doc YAML produces violations from multiple rules', async () => {
    const result = await validateManifestsTool.handler(
      {
        manifests: [nonCompliantMultiDocYaml],
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.resourceCount).toBe(2);
    expect(result.value.tier1Results).toHaveLength(2);
    expect(result.value.violations.length).toBeGreaterThan(0);

    const messages = result.value.violations.map((v: { message: string }) => v.message).join(' | ');
    expect(messages).toContain('no-limits-app');
    expect(messages).toContain('bad-pdb');
    expect(messages).toContain('maxUnavailable');

    const ruleIds = result.value.violations.map((v: { ruleId: string }) => v.ruleId).join(' | ');
    expect(
      ruleIds.includes('resource-limits') ||
        ruleIds.includes('safeguard-container-resource-limits'),
    ).toBe(true);
    expect(
      ruleIds.includes('pod-enforce-antiaffinity') ||
        ruleIds.includes('safeguard-pod-enforce-antiaffinity'),
    ).toBe(true);
    expect(ruleIds.includes('bad-pdb') || ruleIds.includes('safeguard-disallowed-bad-pdb')).toBe(
      true,
    );

    expect(
      result.value.tier1Results.some((r: string) => r.includes('Deployment/no-limits-app')),
    ).toBe(true);
    expect(
      result.value.tier1Results.some((r: string) => r.includes('PodDisruptionBudget/bad-pdb')),
    ).toBe(true);
  });

  it('end-to-end compliant manifest returns clean validation', async () => {
    const result = await validateManifestsTool.handler(
      {
        manifests: [compliantMultiDocYaml],
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.resourceCount).toBe(2);
    expect(result.value.passed).toBe(true);
    expect(result.value.violations).toEqual([]);
    expect(result.value.summary.blockingViolations).toBe(0);
  });

  it('file mode reads temp files and validates content', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-manifests-int-'));
    tempDirs.push(tempDir);
    const filePath = path.join(tempDir, 'manifests.yaml');
    fs.writeFileSync(filePath, nonCompliantMultiDocYaml, 'utf-8');

    const result = await validateManifestsTool.handler(
      {
        manifestPaths: [filePath],
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.resourceCount).toBe(2);
    expect(result.value.violations.length).toBeGreaterThan(0);
  });

  it('plan mode accepts ManifestPlan and validates pseudo-YAML', async () => {
    const result = await validateManifestsTool.handler(
      {
        plan: {
          name: 'integration-plan',
          manifests: [nonCompliantMultiDocYaml],
        },
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.resourceCount).toBe(2);
    expect(result.value.violations.length).toBeGreaterThan(0);
    expect(result.value.tier1Results).toHaveLength(2);
  });

  it('ManifestValidationResult structure and summary counts are correct', async () => {
    const result = await validateManifestsTool.handler(
      {
        manifests: [nonCompliantMultiDocYaml],
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveProperty('passed');
    expect(result.value).toHaveProperty('violations');
    expect(result.value).toHaveProperty('warnings');
    expect(result.value).toHaveProperty('suggestions');
    expect(result.value).toHaveProperty('tier1Results');
    expect(result.value).toHaveProperty('tier2');
    expect(result.value).toHaveProperty('tier3Results');
    expect(result.value).toHaveProperty('resourceCount');
    expect(result.value).toHaveProperty('summary');

    expect(result.value.summary.blockingViolations).toBe(result.value.violations.length);
    expect(result.value.summary.warnings).toBe(result.value.warnings.length);
    expect(result.value.summary.suggestions).toBe(result.value.suggestions.length);
    expect(result.value.summary.totalRules).toBe(
      result.value.violations.length +
        result.value.warnings.length +
        result.value.suggestions.length,
    );
    expect(result.value.summary.matchedRules).toBe(result.value.summary.totalRules);
  });

  it('per-resource results are distinguishable by resource identifier', async () => {
    const result = await validateManifestsTool.handler(
      {
        manifests: [nonCompliantMultiDocYaml],
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const perResource = result.value.tier1Results;
    expect(perResource).toHaveLength(2);
    expect(
      perResource.find((entry: string) => entry.startsWith('Deployment/no-limits-app:')),
    ).toBeDefined();
    expect(
      perResource.find((entry: string) => entry.startsWith('PodDisruptionBudget/bad-pdb:')),
    ).toBeDefined();
  });

  it('works with available policy evaluation backend (WASM bundle if supported, otherwise OPA fallback)', async () => {
    const result = await validateManifestsTool.handler(
      {
        manifests: [nonCompliantMultiDocYaml],
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.resourceCount).toBe(2);
    expect(Array.isArray(result.value.violations)).toBe(true);
    expect(Array.isArray(result.value.warnings)).toBe(true);
  });
});
