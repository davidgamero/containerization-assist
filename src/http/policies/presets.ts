import type { Policy } from '../types';

export interface PolicyPreset {
  id: string;
  name: string;
  description: string;
  category: 'policy' | 'validation';
  policy: Policy;
  configurable?: boolean | undefined;
  configFields?: Array<{ key: string; label: string; placeholder: string }> | undefined;
}

const IMAGE_ALLOWLIST_DEFAULT_IMAGES = [
  'node:22-slim',
  'node:22-alpine',
  'node:20-slim',
  'node:20-alpine',
  'python:3.12-slim',
  'python:3.11-slim',
  'nginx:alpine',
  'eclipse-temurin:21-jre',
  'amazoncorretto:21-alpine',
];

const IMAGE_ALLOWLIST_DEFAULT_PATTERNS = [
  'mcr.microsoft.com/*',
  'node:22-*',
  'node:20-*',
  'python:3.12-*',
  'python:3.11-*',
];

export const POLICY_PRESETS: PolicyPreset[] = [
  {
    id: 'image-allowlist',
    name: 'Image Allowlist',
    description:
      'Restrict Dockerfiles to approved base images (Node, Python, .NET, nginx, Azure Linux)',
    category: 'validation',
    configurable: true,
    configFields: [
      {
        key: 'allowedImages',
        label: 'Allowed Images',
        placeholder: 'node:22-*, mcr.microsoft.com/*, python:3.12-slim',
      },
    ],
    policy: {
      id: 'image-allowlist',
      name: 'Image Allowlist',
      description: 'Block Dockerfiles that use base images not on the approved list',
      type: 'builtin',
      scope: 'session',
      target: 'dockerfile',
      builtinId: 'image-allowlist',
      config: {
        allowed_images: IMAGE_ALLOWLIST_DEFAULT_IMAGES,
        allowed_patterns: IMAGE_ALLOWLIST_DEFAULT_PATTERNS,
      },
      enabled: true,
    },
  },
  {
    id: 'no-root-user',
    name: 'No Root User',
    description: 'Require all containers to run as non-root user',
    category: 'policy',
    policy: {
      id: 'no-root-user',
      name: 'No Root User',
      description: 'Require all containers to run as non-root user',
      type: 'builtin',
      scope: 'session',
      target: 'dockerfile',
      builtinId: 'no-root-user',
      directive:
        'Ensure every generated Dockerfile includes a USER directive that sets a non-root user. Do not use USER root as the final stage user.',
      enabled: true,
    },
  },
  {
    id: 'mcr-required-images',
    name: 'Require MCR / Azure Linux Images',
    description: 'All base images must come from Microsoft Container Registry (mcr.microsoft.com)',
    category: 'policy',
    policy: {
      id: 'mcr-required-images',
      name: 'Require MCR / Azure Linux Images',
      description: 'Block Dockerfiles that use base images not from Microsoft Container Registry',
      type: 'builtin',
      scope: 'session',
      target: 'dockerfile',
      builtinId: 'mcr-required-images',
      enabled: true,
    },
  },
  {
    id: 'multi-stage-required',
    name: 'Require Multi-stage Builds',
    description: 'All Dockerfiles must use multi-stage builds to minimize image size',
    category: 'policy',
    policy: {
      id: 'multi-stage-required',
      name: 'Require Multi-stage Builds',
      description: 'All Dockerfiles must use multi-stage builds to minimize image size',
      type: 'skill',
      scope: 'session',
      target: 'dockerfile',
      directive:
        'Generated Dockerfiles MUST use multi-stage builds. The first stage should install dependencies and build the application. The final stage should be a minimal runtime image that copies only the built artifacts. Never use single-stage builds.',
      enabled: true,
    },
  },
  {
    id: 'healthcheck-required',
    name: 'Require HEALTHCHECK',
    description: 'All Dockerfiles must include a HEALTHCHECK instruction',
    category: 'policy',
    policy: {
      id: 'healthcheck-required',
      name: 'Require HEALTHCHECK',
      description: 'All Dockerfiles must include a HEALTHCHECK instruction',
      type: 'skill',
      scope: 'session',
      target: 'dockerfile',
      directive:
        'Every generated Dockerfile MUST include a HEALTHCHECK instruction. Use curl, wget, or a custom health script. Set appropriate interval, timeout, and retries values.',
      enabled: true,
    },
  },
  {
    id: 'minimal-packages',
    name: 'Minimal Package Installation',
    description: 'Only install strictly necessary OS packages, use --no-install-recommends',
    category: 'policy',
    policy: {
      id: 'minimal-packages',
      name: 'Minimal Package Installation',
      description: 'Only install strictly necessary OS packages, use --no-install-recommends',
      type: 'skill',
      scope: 'session',
      target: 'dockerfile',
      directive:
        'When installing OS packages in Dockerfiles, use --no-install-recommends (apt) or --no-cache (apk). Only install packages that are strictly required for the application to run. Remove package manager caches in the same RUN layer. Never install debugging or development tools in production images.',
      enabled: true,
    },
  },
];

export function getPreset(id: string): PolicyPreset | undefined {
  return POLICY_PRESETS.find((p) => p.id === id);
}

const DEFAULT_POLICY_IDS = ['no-root-user', 'mcr-required-images'];

export function getDefaultSessionPolicies(): Policy[] {
  return DEFAULT_POLICY_IDS.map((id) => getPreset(id))
    .filter((p): p is PolicyPreset => p !== undefined)
    .map((p) => ({ ...p.policy }));
}
