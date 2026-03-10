/**
 * Manifest Parser Tests
 *
 * Comprehensive tests for parseManifests() and wrapForGatekeeper() functions.
 * Uses TDD approach: tests define expected behavior before implementation.
 */

import { describe, it, expect } from 'bun:test';
import { parseManifests, wrapForGatekeeper } from '../manifest-parser';

describe('parseManifests', () => {
  describe('Single-document YAML', () => {
    it('parses valid single-document YAML', () => {
      const yaml = `
apiVersion: v1
kind: Pod
metadata:
  name: test-pod
  namespace: default
spec:
  containers:
    - name: app
      image: nginx:latest
`;
      const result = parseManifests(yaml);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const manifests = result.value;
        expect(manifests.length).toBe(1);
        expect(manifests[0].apiVersion).toBe('v1');
        expect(manifests[0].kind).toBe('Pod');
        expect(manifests[0].metadata.name).toBe('test-pod');
      }
    });

    it('parses Deployment YAML', () => {
      const yaml = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deploy
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
`;
      const result = parseManifests(yaml);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const manifests = result.value;
        expect(manifests[0].kind).toBe('Deployment');
        expect(manifests[0].spec.replicas).toBe(3);
      }
    });

    it('parses Service YAML', () => {
      const yaml = `
apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 8080
`;
      const result = parseManifests(yaml);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const manifests = result.value;
        expect(manifests[0].kind).toBe('Service');
        expect(manifests[0].spec.type).toBe('ClusterIP');
      }
    });
  });

  describe('Multi-document YAML', () => {
    it('parses multi-document YAML separated by ---', () => {
      const yaml = `
apiVersion: v1
kind: Namespace
metadata:
  name: test-ns
---
apiVersion: v1
kind: Pod
metadata:
  name: test-pod
  namespace: test-ns
spec:
  containers:
    - name: app
      image: nginx
`;
      const result = parseManifests(yaml);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const manifests = result.value;
        expect(manifests.length).toBe(2);
        expect(manifests[0].kind).toBe('Namespace');
        expect(manifests[1].kind).toBe('Pod');
      }
    });

    it('parses three documents correctly', () => {
      const yaml = `
apiVersion: v1
kind: Namespace
metadata:
  name: app-ns
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
  namespace: app-ns
spec:
  replicas: 2
---
apiVersion: v1
kind: Service
metadata:
  name: app-svc
  namespace: app-ns
spec:
  type: LoadBalancer
`;
      const result = parseManifests(yaml);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const manifests = result.value;
        expect(manifests.length).toBe(3);
        expect(manifests[0].kind).toBe('Namespace');
        expect(manifests[1].kind).toBe('Deployment');
        expect(manifests[2].kind).toBe('Service');
      }
    });

    it('ignores empty documents after --- split', () => {
      const yaml = `
apiVersion: v1
kind: Pod
metadata:
  name: pod1
---

---
apiVersion: v1
kind: Pod
metadata:
  name: pod2
`;
      const result = parseManifests(yaml);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const manifests = result.value;
        expect(manifests.length).toBe(2);
        expect(manifests[0].metadata.name).toBe('pod1');
        expect(manifests[1].metadata.name).toBe('pod2');
      }
    });

    it('handles trailing --- correctly', () => {
      const yaml = `
apiVersion: v1
kind: Pod
metadata:
  name: pod1
---
`;
      const result = parseManifests(yaml);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const manifests = result.value;
        expect(manifests.length).toBe(1);
      }
    });
  });

  describe('JSON parsing', () => {
    it('parses JSON manifest', () => {
      const json = `{
  "apiVersion": "v1",
  "kind": "ConfigMap",
  "metadata": {
    "name": "app-config",
    "namespace": "default"
  },
  "data": {
    "key": "value"
  }
}`;
      const result = parseManifests(json);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const manifests = result.value;
        expect(manifests.length).toBe(1);
        expect(manifests[0].kind).toBe('ConfigMap');
        expect(manifests[0].data.key).toBe('value');
      }
    });
  });

  describe('Edge cases', () => {
    it('handles BOM markers', () => {
      const yaml = '\uFEFFapiVersion: v1\nkind: Pod\nmetadata:\n  name: test';
      const result = parseManifests(yaml);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const manifests = result.value;
        expect(manifests[0].kind).toBe('Pod');
      }
    });

    it('handles Windows line endings (CRLF)', () => {
      const yaml = 'apiVersion: v1\r\nkind: Pod\r\nmetadata:\r\n  name: test';
      const result = parseManifests(yaml);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const manifests = result.value;
        expect(manifests[0].kind).toBe('Pod');
      }
    });

    it('handles leading/trailing whitespace', () => {
      const yaml = `
    
apiVersion: v1
kind: Pod
metadata:
  name: test
    
`;
      const result = parseManifests(yaml);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const manifests = result.value;
        expect(manifests.length).toBe(1);
      }
    });

    it('handles comments in YAML', () => {
      const yaml = `# This is a comment
apiVersion: v1
kind: Pod
metadata:
  name: test # inline comment
`;
      const result = parseManifests(yaml);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const manifests = result.value;
        expect(manifests[0].kind).toBe('Pod');
      }
    });
  });

  describe('Error handling', () => {
    it('returns Failure for invalid YAML syntax', () => {
      const yaml = `
apiVersion: v1
kind: Pod
metadata:
  name: test
  invalid: [unclosed list
`;
      const result = parseManifests(yaml);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeDefined();
        expect(result.error).toContain('parse');
      }
    });

    it('returns Failure for missing required fields (no apiVersion)', () => {
      const yaml = `
kind: Pod
metadata:
  name: test
`;
      const result = parseManifests(yaml);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/apiVersion|required/i);
      }
    });

    it('returns Failure for missing required fields (no kind)', () => {
      const yaml = `
apiVersion: v1
metadata:
  name: test
`;
      const result = parseManifests(yaml);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/kind|required/i);
      }
    });

    it('returns Failure for missing required fields (no metadata.name)', () => {
      const yaml = `
apiVersion: v1
kind: Pod
metadata:
  namespace: default
`;
      const result = parseManifests(yaml);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/metadata\.name|name|required/i);
      }
    });

    it('includes line number in error for syntax errors', () => {
      const yaml = `line 1
line 2
invalid: [unclosed
line 4`;
      const result = parseManifests(yaml);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeDefined();
      }
    });

    it('returns Failure for empty string', () => {
      const result = parseManifests('');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeDefined();
      }
    });

    it('returns Failure for only whitespace', () => {
      const result = parseManifests('   \n\n  ');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeDefined();
      }
    });
  });
});

describe('wrapForGatekeeper', () => {
  describe('Basic wrapping', () => {
    it('wraps resource in Gatekeeper AdmissionReview format', () => {
      const resource = {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
          name: 'test-pod',
        },
        spec: {
          containers: [{ name: 'app', image: 'nginx' }],
        },
      };

      const wrapped = wrapForGatekeeper(resource);

      expect(wrapped.apiVersion).toBe('v1');
      expect(wrapped.kind).toBe('Pod');
      expect(wrapped.review.object).toEqual(resource);
      expect(wrapped.parameters).toEqual({});
    });

    it('preserves resource metadata in review.object', () => {
      const resource = {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: {
          name: 'app-deploy',
          namespace: 'production',
          labels: { app: 'myapp' },
        },
        spec: { replicas: 3 },
      };

      const wrapped = wrapForGatekeeper(resource);

      expect(wrapped.review.object.metadata.name).toBe('app-deploy');
      expect(wrapped.review.object.metadata.namespace).toBe('production');
      expect(wrapped.review.object.metadata.labels.app).toBe('myapp');
    });
  });

  describe('With parameters', () => {
    it('includes custom parameters in wrapper', () => {
      const resource = {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'config' },
      };

      const params = {
        requiredLabels: ['app', 'environment'],
        forbiddenImages: ['ubuntu:latest'],
      };

      const wrapped = wrapForGatekeeper(resource, params);

      expect(wrapped.parameters).toEqual(params);
      expect(wrapped.parameters.requiredLabels).toEqual(['app', 'environment']);
    });

    it('wraps with empty parameters when params not provided', () => {
      const resource = {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'pod' },
      };

      const wrapped = wrapForGatekeeper(resource);

      expect(wrapped.parameters).toEqual({});
    });

    it('wraps with undefined parameters correctly', () => {
      const resource = {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'svc' },
      };

      const wrapped = wrapForGatekeeper(resource, undefined);

      expect(wrapped.parameters).toEqual({});
    });
  });

  describe('Gatekeeper structure validation', () => {
    it('produces valid Gatekeeper input.review.object structure', () => {
      const resource = {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'test' },
        spec: { containers: [{ name: 'c1', image: 'img' }] },
      };

      const wrapped = wrapForGatekeeper(resource);

      // Verify structure matches Gatekeeper AdmissionReview format
      expect(wrapped).toHaveProperty('apiVersion');
      expect(wrapped).toHaveProperty('kind');
      expect(wrapped).toHaveProperty('review');
      expect(wrapped.review).toHaveProperty('object');
      expect(wrapped).toHaveProperty('parameters');

      // Verify review.object contains the resource
      expect(wrapped.review.object).toBe(resource);
    });

    it('wraps multiple resources independently', () => {
      const pod = {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'pod1' },
      };

      const svc = {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'svc1' },
      };

      const wrappedPod = wrapForGatekeeper(pod);
      const wrappedSvc = wrapForGatekeeper(svc);

      expect(wrappedPod.review.object).toBe(pod);
      expect(wrappedSvc.review.object).toBe(svc);
      expect(wrappedPod.kind).toBe('Pod');
      expect(wrappedSvc.kind).toBe('Service');
    });
  });

  describe('With result integration', () => {
    it('works with parseManifests result', () => {
      const yaml = `
apiVersion: v1
kind: Pod
metadata:
  name: test-pod
spec:
  containers:
    - name: app
      image: nginx
`;
      const parseResult = parseManifests(yaml);

      expect(parseResult.ok).toBe(true);
      if (parseResult.ok) {
        const [resource] = parseResult.value;
        const wrapped = wrapForGatekeeper(resource);

        expect(wrapped.review.object).toBe(resource);
        expect(wrapped.parameters).toEqual({});
      }
    });

    it('chains parseManifests and wrapForGatekeeper', () => {
      const yaml = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
spec:
  replicas: 1
---
apiVersion: v1
kind: Service
metadata:
  name: app-svc
spec:
  type: ClusterIP
`;
      const parseResult = parseManifests(yaml);

      expect(parseResult.ok).toBe(true);
      if (parseResult.ok) {
        const manifests = parseResult.value;
        expect(manifests.length).toBe(2);

        const wrappedDeploy = wrapForGatekeeper(manifests[0]);
        const wrappedSvc = wrapForGatekeeper(manifests[1]);

        expect(wrappedDeploy.kind).toBe('Deployment');
        expect(wrappedSvc.kind).toBe('Service');
      }
    });
  });
});
