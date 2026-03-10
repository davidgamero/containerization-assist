/**
 * Dry-Run Validator
 *
 * Validates Kubernetes manifests using kubectl --dry-run=server.
 * Extracts Gatekeeper denial constraints and messages from admission webhook errors.
 *
 * @example
 * ```typescript
 * import { validateWithDryRun } from '@/lib/dry-run-validator';
 * import { createLogger } from '@/lib/logger';
 *
 * const logger = createLogger();
 * const result = await validateWithDryRun(manifestYaml, {
 *   context: 'my-cluster',
 *   logger
 * });
 *
 * if (result.passed) {
 *   console.log('Manifest is valid');
 * } else {
 *   console.log('Violations:', result.violations);
 *   console.log('Details:', result.rawOutput);
 * }
 * ```
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Logger } from './logger';

const execAsync = promisify(exec);

/**
 * Result of dry-run validation
 */
export interface DryRunResult {
  /** Whether validation passed (no violations) */
  passed: boolean;
  /** Array of Gatekeeper constraint violations extracted from kubectl output */
  violations: Array<{
    /** Gatekeeper constraint name (e.g., 'k8sazurev2containerresourcelimits') */
    constraint: string;
    /** Violation message from the constraint */
    message: string;
  }>;
  /** Raw stdout/stderr from kubectl command for debugging */
  rawOutput: string;
}

/**
 * Options for dry-run validation
 */
export interface DryRunOptions {
  /** Kubernetes context to use (optional) */
  context?: string;
  /** Logger instance for debugging */
  logger: Logger;
}

/**
 * Extract Gatekeeper violations from kubectl error output
 *
 * Parses admission webhook denial messages to extract constraint name and message.
 * Handles single and multiple violations in the same error output.
 *
 * @param stderr - stderr from kubectl command
 * @returns Array of violations with constraint name and message
 */
function extractViolations(stderr: string): Array<{ constraint: string; message: string }> {
  const violations: Array<{ constraint: string; message: string }> = [];

  // Create new regex instance to avoid state issues with global flag
  const regex = /\[([^\]]+)\]\s+(.+)/g;
  let match;
  while ((match = regex.exec(stderr)) !== null) {
    violations.push({
      constraint: match[1]!,
      message: match[2]!,
    });
  }

  return violations;
}

/**
 * TEST HELPER: Export violation extraction logic for unit tests
 * @internal
 */
export function extractViolationsForTest(
  stderr: string,
): Array<{ constraint: string; message: string }> {
  return extractViolations(stderr);
}

/**
 * Validate a Kubernetes manifest using kubectl --dry-run=server
 *
 * Performs server-side validation without actually applying resources.
 * Extracts Gatekeeper constraint violations from admission webhook errors.
 *
 * The function:
 * 1. Writes manifest to a temporary file
 * 2. Runs `kubectl apply --dry-run=server` against it
 * 3. Parses success/failure and extracts violations
 * 4. Cleans up temporary files in finally block
 *
 * @param manifestYaml - Kubernetes manifest in YAML format (single or multi-resource)
 * @param options - Validation options (context, logger)
 * @returns Promise<DryRunResult> with validation result and violations
 *
 * @example Success case:
 * ```
 * const result = await validateWithDryRun(validYaml, { logger });
 * // result.passed === true
 * // result.violations === []
 * ```
 *
 * @example Gatekeeper denial case:
 * ```
 * const result = await validateWithDryRun(badYaml, { logger });
 * // result.passed === false
 * // result.violations === [
 * //   { constraint: 'k8sazurev2containerresourcelimits', message: 'missing limits' }
 * // ]
 * ```
 */
export async function validateWithDryRun(
  manifestYaml: string,
  options: DryRunOptions,
): Promise<DryRunResult> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dry-run-'));
  const tempFile = path.join(tempDir, 'manifest.yaml');

  try {
    // Write manifest to temporary file
    fs.writeFileSync(tempFile, manifestYaml, 'utf-8');

    // Build kubectl command
    const contextFlag = options.context ? `--context ${options.context}` : '';
    const command = `kubectl apply --dry-run=server -f "${tempFile}" ${contextFlag} 2>&1`;

    options.logger.debug({ command }, 'Running dry-run validation');

    try {
      // Execute kubectl dry-run
      const { stdout } = await execAsync(command, { timeout: 15000 });

      // Success case
      options.logger.debug('Dry-run validation passed');
      return {
        passed: true,
        violations: [],
        rawOutput: stdout,
      };
    } catch (error: any) {
      // Error case - could be Gatekeeper denial or other kubectl error
      const stderr = error.stderr ?? error.message ?? '';
      const stdout = error.stdout ?? '';
      const output = stderr || stdout;

      options.logger.debug({ stderr, stdout }, 'Dry-run validation failed');

      // Try to extract Gatekeeper violations
      const violations = extractViolations(output);

      if (violations.length > 0) {
        // Gatekeeper denial case
        options.logger.debug({ count: violations.length }, 'Extracted Gatekeeper violations');
        return {
          passed: false,
          violations,
          rawOutput: output,
        };
      }

      // Other kubectl error (syntax error, unavailable, etc.)
      options.logger.debug({ error: error.message }, 'Kubectl error without Gatekeeper violations');
      return {
        passed: false,
        violations: [],
        rawOutput: output,
      };
    }
  } finally {
    // Clean up temporary files
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      options.logger.debug({ tempDir }, 'Cleaned up temporary files');
    } catch (cleanupError) {
      options.logger.warn({ tempDir, error: cleanupError }, 'Failed to cleanup temp directory');
    }
  }
}
