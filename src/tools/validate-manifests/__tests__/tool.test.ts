import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '@/lib/logger';
import type { ToolContext } from '@/core/context';
import validateManifestsTool from '../tool';

const logger = createLogger({ name: 'validate-manifests-tool-test', level: 'error' });

const mockContext: ToolContext = {
  logger,
  queryConfig: async () => null,
};

const compliantDeployment = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: compliant-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: compliant-app
  template:
    metadata:
      labels:
        app: compliant-app
    spec:
      imagePullSecrets:
        - name: private-registry
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
`;

const missingLimitsDeployment = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: missing-limits
spec:
  replicas: 1
  selector:
    matchLabels:
      app: missing-limits
  template:
    metadata:
      labels:
        app: missing-limits
    spec:
      imagePullSecrets:
        - name: private-registry
      containers:
        - name: app
          image: mcr.microsoft.com/azurelinux/base:3.0
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
          livenessProbe:
            httpGet:
              path: /live
              port: 8080
`;

describe('validate-manifests tool', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('inline mode: compliant deployment returns no violations', async () => {
    const result = await validateManifestsTool.handler(
      {
        manifests: [compliantDeployment],
      },
      mockContext,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.violations).toHaveLength(0);
    expect(result.value.allow).toBe(true);
    expect(result.value.resourceCount).toBe(1);
  });

  it('inline mode: deployment missing resource limits has violation', async () => {
    const result = await validateManifestsTool.handler(
      {
        manifests: [missingLimitsDeployment],
      },
      mockContext,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.violations.length).toBeGreaterThan(0);
    expect(result.value.violations.some((v) => v.ruleId.includes('resource-limits'))).toBe(true);
    expect(result.value.allow).toBe(false);
  });

  it('inline mode: multi-doc YAML validates each document independently', async () => {
    const multiDoc = `${compliantDeployment}\n---\n${missingLimitsDeployment}`;
    const result = await validateManifestsTool.handler(
      {
        manifests: [multiDoc],
      },
      mockContext,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.resourceCount).toBe(2);
    expect(result.value.tier1Results).toHaveLength(2);
    expect(result.value.violations.length).toBeGreaterThan(0);
  });

  it('files mode: reads and validates file contents', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-manifests-'));
    tempDirs.push(tmpDir);
    const manifestPath = path.join(tmpDir, 'deployment.yaml');
    fs.writeFileSync(manifestPath, missingLimitsDeployment, 'utf-8');

    const result = await validateManifestsTool.handler(
      {
        manifestPaths: [manifestPath],
      },
      mockContext,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.resourceCount).toBe(1);
    expect(result.value.violations.length).toBeGreaterThan(0);
  });

  it('plan mode: converts plan to YAML and validates', async () => {
    const result = await validateManifestsTool.handler(
      {
        plan: {
          name: 'test-plan',
          manifests: [missingLimitsDeployment],
        },
      },
      mockContext,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.resourceCount).toBe(1);
    expect(result.value.violations.length).toBeGreaterThan(0);
  });

  it('invalid YAML input returns parse error instead of crashing', async () => {
    const result = await validateManifestsTool.handler(
      {
        manifests: ['apiVersion: v1\nkind: Pod\nmetadata:\n  name: bad\n  labels: ['],
      },
      mockContext,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.toLowerCase()).toContain('parse');
  });

  it('multiple violations across containers are all reported', async () => {
    const multiViolation = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: two-bad-containers
spec:
  replicas: 1
  selector:
    matchLabels:
      app: two-bad-containers
  template:
    metadata:
      labels:
        app: two-bad-containers
    spec:
      imagePullSecrets:
        - name: private-registry
      containers:
        - name: app-1
          image: mcr.microsoft.com/azurelinux/base:3.0
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
          livenessProbe:
            httpGet:
              path: /live
              port: 8080
        - name: app-2
          image: mcr.microsoft.com/azurelinux/base:3.0
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
          livenessProbe:
            httpGet:
              path: /live
              port: 8080
`;

    const result = await validateManifestsTool.handler(
      {
        manifests: [multiViolation],
      },
      mockContext,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const messages = result.value.violations.map((v) => v.message).join(' ');
    expect(result.value.violations.length).toBeGreaterThanOrEqual(2);
    expect(messages).toContain('app-1');
    expect(messages).toContain('app-2');
  });
});
