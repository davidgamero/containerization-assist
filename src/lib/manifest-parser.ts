/**
 * Kubernetes Manifest Parser
 *
 * Parses YAML and JSON manifests into Kubernetes resource objects.
 * Supports single-document and multi-document YAML with proper error handling.
 * Includes Gatekeeper AdmissionReview wrapper for policy validation.
 */

import yaml from 'js-yaml';
import type { Result } from '@/types';
import { Success, Failure } from '@/types';

/**
 * Kubernetes resource object structure
 */
export interface K8sResource {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Gatekeeper AdmissionReview wrapper structure
 */
export interface GatekeeperAdmissionReview {
  apiVersion: string;
  kind: string;
  review: {
    object: K8sResource;
  };
  parameters: Record<string, unknown>;
}

/**
 * Error details for manifest parsing failures
 */
export interface ManifestParseError {
  message: string;
  line?: number;
  column?: number;
}

/**
 * Parse Kubernetes manifests from YAML or JSON string
 *
 * Supports:
 * - Single-document YAML
 * - Multi-document YAML (separated by ---)
 * - JSON manifests
 * - Edge cases: BOM markers, Windows line endings (CRLF), comments
 *
 * Validates each manifest has required fields:
 * - apiVersion (string)
 * - kind (string)
 * - metadata.name (string)
 *
 * @param input - YAML or JSON string containing one or more Kubernetes manifests
 * @returns Result<K8sResource[]> - Array of parsed resources or detailed error
 *
 * @example
 * ```typescript
 * // Single document
 * const result = parseManifests(yamlString);
 * if (result.ok) {
 *   const resources = result.value;
 *   console.log(`Parsed ${resources.length} resource(s)`);
 * }
 *
 * // Multi-document
 * const multiResult = parseManifests(multiDocYaml);
 * if (multiResult.ok) {
 *   const [ns, deploy, svc] = multiResult.value;
 * }
 * ```
 */
export function parseManifests(input: string): Result<K8sResource[]> {
  try {
    // Validate input is not empty or whitespace-only
    if (!input || !input.trim()) {
      return Failure<K8sResource[]>('Cannot parse empty or whitespace-only manifest');
    }

    // Remove BOM if present
    const cleanedInput = input.replace(/^\uFEFF/, '');

    // Attempt to parse as JSON first (single-line check)
    if (cleanedInput.trim().startsWith('{')) {
      try {
        const jsonResource = JSON.parse(cleanedInput);
        const validation = validateManifest(jsonResource, 0);
        if (!validation.valid) {
          return Failure<K8sResource[]>(validation.error);
        }
        return Success([jsonResource as K8sResource]);
      } catch {
        // Fall through to YAML parsing
      }
    }

    // Parse as YAML (handles both single and multi-doc)
    const documents = parseYamlDocuments(cleanedInput);

    if (documents.length === 0) {
      return Failure<K8sResource[]>('No valid Kubernetes manifests found in input');
    }

    // Validate each document
    const resources: K8sResource[] = [];
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const validation = validateManifest(doc, i);
      if (!validation.valid) {
        return Failure<K8sResource[]>(validation.error);
      }
      resources.push(doc as K8sResource);
    }

    return Success(resources);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return Failure<K8sResource[]>(`Failed to parse manifest: ${errorMsg}`);
  }
}

/**
 * Parse YAML documents from multi-document string
 *
 * Splits on /^---$/m and filters out empty documents.
 * Uses js-yaml.loadAll to handle proper YAML parsing.
 *
 * @param input - YAML string potentially containing multiple documents
 * @returns Array of parsed YAML objects
 */
function parseYamlDocuments(input: string): unknown[] {
  try {
    // Use js-yaml.loadAll for proper multi-document parsing
    const documents: unknown[] = [];
    yaml.loadAll(input, (doc) => {
      // Filter out null/empty documents
      if (doc !== null && doc !== undefined) {
        documents.push(doc);
      }
    });
    return documents;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`YAML parse error: ${errorMsg}`);
  }
}

/**
 * Validate manifest structure
 *
 * Checks for required Kubernetes resource fields:
 * - apiVersion: string
 * - kind: string
 * - metadata: object with name: string
 *
 * @param doc - Document to validate
 * @param index - Document index (for error messages)
 * @returns Validation result with error message if invalid
 */
function validateManifest(
  doc: unknown,
  index: number,
): {
  valid: boolean;
  error?: string;
} {
  if (typeof doc !== 'object' || doc === null) {
    return {
      valid: false,
      error: `Document ${index} is not a valid object`,
    };
  }

  const manifest = doc as Record<string, unknown>;

  // Check apiVersion
  if (typeof manifest.apiVersion !== 'string') {
    return {
      valid: false,
      error: `Document ${index} missing required field: apiVersion (must be string)`,
    };
  }

  // Check kind
  if (typeof manifest.kind !== 'string') {
    return {
      valid: false,
      error: `Document ${index} missing required field: kind (must be string)`,
    };
  }

  // Check metadata
  if (typeof manifest.metadata !== 'object' || manifest.metadata === null) {
    return {
      valid: false,
      error: `Document ${index} missing required field: metadata (must be object)`,
    };
  }

  const metadata = manifest.metadata as Record<string, unknown>;

  // Check metadata.name
  if (typeof metadata.name !== 'string') {
    return {
      valid: false,
      error: `Document ${index} missing required field: metadata.name (must be string)`,
    };
  }

  return { valid: true };
}

/**
 * Wrap Kubernetes resource in Gatekeeper AdmissionReview format
 *
 * Creates the input structure expected by Gatekeeper/OPA constraints:
 * - `apiVersion` and `kind` from the resource
 * - `review.object` contains the full resource
 * - `parameters` contains constraint configuration (if provided)
 *
 * This format matches the Gatekeeper AdmissionReview input that Rego policies expect.
 * Rules access the resource via `input.review.object` and parameters via `input.parameters`.
 *
 * @param resource - Kubernetes resource to wrap
 * @param parameters - Optional constraint parameters (default: {})
 * @returns Gatekeeper AdmissionReview formatted object
 *
 * @example
 * ```typescript
 * const resource = {
 *   apiVersion: 'v1',
 *   kind: 'Pod',
 *   metadata: { name: 'my-pod' },
 *   spec: { containers: [...] }
 * };
 *
 * // Wrap without parameters
 * const wrapped = wrapForGatekeeper(resource);
 * // wrapped.review.object === resource
 * // wrapped.parameters === {}
 *
 * // Wrap with parameters
 * const withParams = wrapForGatekeeper(resource, {
 *   requiredLabels: ['app', 'team']
 * });
 * // withParams.parameters.requiredLabels === ['app', 'team']
 * ```
 */
export function wrapForGatekeeper(
  resource: K8sResource,
  parameters?: Record<string, unknown>,
): GatekeeperAdmissionReview {
  return {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    review: {
      object: resource,
    },
    parameters: parameters || {},
  };
}
