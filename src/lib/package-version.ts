import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function resolvePackageVersion(): string {
  try {
    // Prefer the build-time generated version (created by scripts/generate-version.ts)
    // Use createRequire to dynamically load the generated module so that a missing file
    // does not hard-crash ESM module loading at import time.
    const require = createRequire(import.meta.url);
    const { GENERATED_PACKAGE_VERSION } = require('./generated-version') as {
      GENERATED_PACKAGE_VERSION?: string;
    };
    if (typeof GENERATED_PACKAGE_VERSION === 'string' && GENERATED_PACKAGE_VERSION.length > 0) {
      return GENERATED_PACKAGE_VERSION;
    }
  } catch {
    // generated-version.ts not yet built — fall back to package.json
  }

  try {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = join(currentDir, '../../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
      version?: string;
    };
    if (typeof packageJson.version === 'string' && packageJson.version.length > 0) {
      return packageJson.version;
    }
  } catch {
    // Ignore and use the final default below.
  }

  return '0.0.0';
}

export const PACKAGE_VERSION = resolvePackageVersion();

export const K8S_ANNOTATION_VERSION = 'com.azure.containerizationassist/version';

export const OCI_LABEL_VERSION = 'com.azure.containerizationassist.version';
