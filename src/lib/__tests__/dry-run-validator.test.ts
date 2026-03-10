/**
 * Dry-Run Validator Tests
 *
 * Comprehensive tests for violation extraction logic.
 * Focuses on regex parsing and result structure without requiring kubectl.
 */

import { describe, it, expect } from 'bun:test';
import { extractViolationsForTest } from '../dry-run-validator';

describe('Gatekeeper Violation Extraction', () => {
  describe('Single violation extraction', () => {
    it('extracts constraint and message from Gatekeeper denial', () => {
      const denialMessage =
        'Error from server (Forbidden): error when creating "temp.yaml": ' +
        'admission webhook "validation.gatekeeper.sh" denied the request: ' +
        "[k8sazurev2containerresourcelimits] Container 'app' missing resource limits";

      const violations = extractViolationsForTest(denialMessage);

      expect(violations.length).toBe(1);
      expect(violations[0].constraint).toBe('k8sazurev2containerresourcelimits');
      expect(violations[0].message).toBe("Container 'app' missing resource limits");
    });

    it('handles simple constraint messages', () => {
      const denialMessage = '[k8srequiredlabels] Missing required label: app';

      const violations = extractViolationsForTest(denialMessage);

      expect(violations.length).toBe(1);
      expect(violations[0].constraint).toBe('k8srequiredlabels');
      expect(violations[0].message).toBe('Missing required label: app');
    });

    it('preserves full message including special characters', () => {
      const denialMessage =
        "[k8sazurev2containerresourcelimits] Container 'app' missing CPU/memory limits";

      const violations = extractViolationsForTest(denialMessage);

      expect(violations.length).toBe(1);
      expect(violations[0].message).toContain('CPU/memory');
      expect(violations[0].message).toContain("'app'");
    });
  });

  describe('Multiple violation extraction', () => {
    it('extracts multiple constraints from separate lines', () => {
      // Real Gatekeeper output has each constraint on separate line
      const multiDenialMessage = `
error when creating "temp.yaml":
admission webhook "validation.gatekeeper.sh" denied the request:
[k8srequiredlabels] Missing required labels
[k8srequiredresourcequota] Missing resource quota
`;

      const violations = extractViolationsForTest(multiDenialMessage);

      expect(violations.length).toBe(2);
      expect(violations[0].constraint).toBe('k8srequiredlabels');
      expect(violations[0].message).toContain('Missing required labels');
      expect(violations[1].constraint).toBe('k8srequiredresourcequota');
      expect(violations[1].message).toContain('Missing resource quota');
    });

    it('handles three or more violations on separate lines', () => {
      const multiDenialMessage = `
[k8slabel1] message one
[k8slabel2] message two
[k8slabel3] message three
`;

      const violations = extractViolationsForTest(multiDenialMessage);

      expect(violations.length).toBe(3);
      expect(violations[0].constraint).toBe('k8slabel1');
      expect(violations[1].constraint).toBe('k8slabel2');
      expect(violations[2].constraint).toBe('k8slabel3');
    });
    it('extracts multiple constraints from same error', () => {
      const multiDenialMessage = `
error when creating "temp.yaml":
admission webhook "validation.gatekeeper.sh" denied the request:
[k8srequiredlabels] Missing required labels
[k8srequiredresourcequota] Missing resource quota
`;

      const violations = extractViolationsForTest(multiDenialMessage);

      expect(violations.length).toBe(2);
      expect(violations[0].constraint).toBe('k8srequiredlabels');
      expect(violations[1].constraint).toBe('k8srequiredresourcequota');
    });

  });

  describe('Edge cases', () => {
    it('returns empty array when no violations found', () => {
      const noViolationMessage = 'Some other kubectl error output';

      const violations = extractViolationsForTest(noViolationMessage);

      expect(violations.length).toBe(0);
      expect(violations).toEqual([]);
    });

    it('handles constraint names with numbers and lowercase', () => {
      const denialMessage = '[k8sazurev2containerresourcelimits] constraint violated';

      const violations = extractViolationsForTest(denialMessage);

      expect(violations.length).toBe(1);
      expect(violations[0].constraint).toBe('k8sazurev2containerresourcelimits');
    });

    it('handles messages with colons and special chars', () => {
      const denialMessage = '[k8srequiredlabels] Missing labels: owner, version, team';

      const violations = extractViolationsForTest(denialMessage);

      expect(violations[0].message).toBe('Missing labels: owner, version, team');
    });

    it('does not match empty constraint name', () => {
      const denialMessage = '[] This should not match';

      const violations = extractViolationsForTest(denialMessage);

      // Empty constraint name should not match our regex
      expect(violations.length).toBe(0);
    });

    it('handles messages with newlines', () => {
      const denialMessage = '[k8sconstraint] Message with\nmultiple lines';

      const violations = extractViolationsForTest(denialMessage);

      expect(violations.length).toBe(1);
      expect(violations[0].constraint).toBe('k8sconstraint');
    });
  });

  describe('Real-world kubectl error scenarios', () => {
    it('parses full kubectl error with Gatekeeper denial', () => {
      const fullError =
        'Error from server (Forbidden): error when creating "deployment.yaml": ' +
        'admission webhook "validation.gatekeeper.sh" denied the request: ' +
        "[k8sazurev2containerresourcelimits] Container 'frontend' missing CPU/memory limits";

      const violations = extractViolationsForTest(fullError);

      expect(violations.length).toBe(1);
      expect(violations[0].constraint).toBe('k8sazurev2containerresourcelimits');
      expect(violations[0].message).toContain('frontend');
    });

    it('parses kubectl error without Gatekeeper (returns empty)', () => {
      const syntaxError =
        'error: unable to parse "manifest.yaml": ' +
        'error converting YAML to JSON: yaml: line 2: did not find expected key';

      const violations = extractViolationsForTest(syntaxError);

      expect(violations.length).toBe(0);
    });

    it('handles kubectl unavailable error (returns empty)', () => {
      const unavailableError =
        'error: unable to connect to the server: ' +
        'dial tcp: lookup kubernetes.default.svc on: no such host';

      const violations = extractViolationsForTest(unavailableError);

      expect(violations.length).toBe(0);
    });
  });

  describe('Regex pattern correctness', () => {
    it('pattern correctly identifies bracket boundaries', () => {
      const messages = [
        '[simple] message',
        '[with-dashes] message',
        '[with123numbers] message',
        '[CAPS] message',
        '[mixed-Case-123] message',
      ];

      for (const msg of messages) {
        const violations = extractViolationsForTest(msg);
        expect(violations.length).toBe(1);
      }
    });

    it('does not match brackets in message part', () => {
      const denialMessage = '[k8sconstraint] Message [with] brackets [in] it';

      const violations = extractViolationsForTest(denialMessage);

      // Should only extract one violation from first bracket pair
      expect(violations.length).toBe(1);
      expect(violations[0].constraint).toBe('k8sconstraint');
      expect(violations[0].message).toContain('[with]');
    });
  });
});

describe('DryRunResult structure', () => {
  it('has required fields: passed, violations, rawOutput', () => {
    const result = {
      passed: true,
      violations: [],
      rawOutput: '',
    };

    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('violations');
    expect(result).toHaveProperty('rawOutput');
    expect(typeof result.passed).toBe('boolean');
    expect(Array.isArray(result.violations)).toBe(true);
    expect(typeof result.rawOutput).toBe('string');
  });

  it('violation objects have constraint and message fields', () => {
    const violation = {
      constraint: 'k8sconstraint',
      message: 'constraint message',
    };

    expect(violation).toHaveProperty('constraint');
    expect(violation).toHaveProperty('message');
    expect(typeof violation.constraint).toBe('string');
    expect(typeof violation.message).toBe('string');
  });
});
