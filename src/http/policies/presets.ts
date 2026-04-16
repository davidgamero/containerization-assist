import type { PolicySkill, ValidationSkill } from '../types';

export interface PolicyPreset {
  id: string;
  name: string;
  description: string;
  category: 'policy' | 'validation';
  skill: PolicySkill | ValidationSkill;
  configurable?: boolean | undefined;
  configFields?: Array<{ key: string; label: string; placeholder: string }> | undefined;
}

const IMAGE_ALLOWLIST_DEFAULT_IMAGES = [
  'node',
  'node:22-slim',
  'node:22-alpine',
  'node:20-slim',
  'node:20-alpine',
  'python:3.12-slim',
  'python:3.11-slim',
  'nginx:alpine',
  'mcr.microsoft.com/dotnet/aspnet',
  'mcr.microsoft.com/dotnet/sdk',
  'eclipse-temurin',
  'amazoncorretto',
  'mcr.microsoft.com/cbl-mariner/base/core',
];

function buildImageAllowlistRegoFromImages(images: string[]): string {
  const allowedImagesBlock = images
    .map((image) => `  "${image.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}",`)
    .join('\n');

  return `package containerization.image_allowlist

import rego.v1

default allow := false

allowed_images := {
${allowedImagesBlock}
}

image_from_line(line) := img if {
  parts := split(trim_space(line), " ")
  parts[0] == "FROM"
  img_with_as := parts[1]
  img := split(img_with_as, ":")[0]
}

violations contains result if {
  input_type == "dockerfile"
  some line in split(input.content, "\\n")
  img := image_from_line(line)
  not img in allowed_images
  not startswith(img, "mcr.microsoft.com/")
  result := {
    "rule": "image-allowlist",
    "category": "security",
    "priority": 95,
    "severity": "block",
    "message": concat("", ["Base image '", img, "' is not in the approved allowlist. Use an approved image."]),
    "description": "Only pre-approved base images may be used in Dockerfiles",
  }
}

input_type := "dockerfile" if {
  input.type == "dockerfile"
}

allow if {
  count(violations) == 0
}

result := {
  "allow": allow,
  "violations": violations,
  "warnings": set(),
  "suggestions": set(),
  "summary": {
    "total_violations": count(violations),
    "total_warnings": 0,
    "total_suggestions": 0,
  },
}
`;
}

const IMAGE_ALLOWLIST_REGO = buildImageAllowlistRegoFromImages(IMAGE_ALLOWLIST_DEFAULT_IMAGES);

export function buildImageAllowlistRego(imageExpressions: string): string {
  const images = imageExpressions
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (images.length === 0) {
    return IMAGE_ALLOWLIST_REGO;
  }

  return buildImageAllowlistRegoFromImages(images);
}

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
        placeholder: 'mcr.microsoft.com/*, node:22-*',
      },
    ],
    skill: {
      id: 'image-allowlist',
      name: 'Image Allowlist',
      description: 'Block Dockerfiles that use base images not on the approved list',
      rego: IMAGE_ALLOWLIST_REGO,
    } satisfies ValidationSkill,
  },
  {
    id: 'no-root-user',
    name: 'No Root User',
    description: 'Require all containers to run as non-root user',
    category: 'policy',
    skill: {
      id: 'no-root-user',
      name: 'No Root User',
      description:
        'Ensure every generated Dockerfile includes a USER directive that sets a non-root user. Do not use USER root as the final stage user.',
    } satisfies PolicySkill,
  },
  {
    id: 'multi-stage-required',
    name: 'Require Multi-stage Builds',
    description: 'All Dockerfiles must use multi-stage builds to minimize image size',
    category: 'policy',
    skill: {
      id: 'multi-stage-required',
      name: 'Require Multi-stage Builds',
      description:
        'Generated Dockerfiles MUST use multi-stage builds. The first stage should install dependencies and build the application. The final stage should be a minimal runtime image that copies only the built artifacts. Never use single-stage builds.',
    } satisfies PolicySkill,
  },
  {
    id: 'healthcheck-required',
    name: 'Require HEALTHCHECK',
    description: 'All Dockerfiles must include a HEALTHCHECK instruction',
    category: 'policy',
    skill: {
      id: 'healthcheck-required',
      name: 'Require HEALTHCHECK',
      description:
        'Every generated Dockerfile MUST include a HEALTHCHECK instruction. Use curl, wget, or a custom health script. Set appropriate interval, timeout, and retries values.',
    } satisfies PolicySkill,
  },
  {
    id: 'minimal-packages',
    name: 'Minimal Package Installation',
    description: 'Only install strictly necessary OS packages, use --no-install-recommends',
    category: 'policy',
    skill: {
      id: 'minimal-packages',
      name: 'Minimal Package Installation',
      description:
        'When installing OS packages in Dockerfiles, use --no-install-recommends (apt) or --no-cache (apk). Only install packages that are strictly required for the application to run. Remove package manager caches in the same RUN layer. Never install debugging or development tools in production images.',
    } satisfies PolicySkill,
  },
];

export function getPreset(id: string): PolicyPreset | undefined {
  return POLICY_PRESETS.find((p) => p.id === id);
}
