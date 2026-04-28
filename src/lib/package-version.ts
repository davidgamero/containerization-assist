import { readFileSync } from 'node:fs';
import path from 'node:path';

function resolvePackageVersion(): string {
  try {
    const searchPaths = [
      path.join(__dirname, '../../../../package.json'),
      path.join(__dirname, '../../../package.json'),
      path.join(__dirname, '../../package.json'),
    ];
    for (const candidate of searchPaths) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === 'containerization-assist-mcp' && pkg.version) {
          return pkg.version;
        }
      } catch {
        continue;
      }
    }
  } catch {
    /* fallback to 'unknown' */
  }
  return 'unknown';
}

export const PACKAGE_VERSION = resolvePackageVersion();

export const TOOL_NAME = 'containerization-assist';

export const K8S_LABEL_MANAGED_BY = 'app.kubernetes.io/managed-by';
export const K8S_LABEL_NAME = 'app.kubernetes.io/name';
export const K8S_ANNOTATION_VERSION = 'containerization-assist.io/version';

export const OCI_LABEL_CREATED_BY = 'org.opencontainers.image.created-by';
export const OCI_LABEL_VERSION = 'org.opencontainers.image.version';
