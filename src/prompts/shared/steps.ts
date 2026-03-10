/**
 * Shared step helpers and prompt assembly for dev-loop prompts.
 *
 * Each helper returns a { heading, body } pair for one workflow step.
 * `assemblePrompt` numbers them dynamically and joins everything.
 */

import { TOOL_NAME } from '@/tools';

export interface Step {
  heading: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Shared steps (identical across loops)
// ---------------------------------------------------------------------------

export function analyzeStep(): Step {
  return {
    heading: 'Analyze the repository',
    body: [
      `Call **${TOOL_NAME.ANALYZE_REPO}** using the current working directory as the repository path.`,
      '- Confirm the detected repository, language, framework, modules, and existing Dockerfiles with the user before proceeding.',
      '- If the repository is a monorepo, list all independently deployable modules and ask the user which ones to target.',
    ].join('\n'),
  };
}

export function generateDockerfileStep(): Step {
  return {
    heading: 'Generate Dockerfile (if missing)',
    body: [
      'If no Dockerfile exists for the target module(s):',
      `1. Call **${TOOL_NAME.GENERATE_DOCKERFILE}** with the repository path and analysis context.`,
      "2. Follow the tool's guidance to create the Dockerfile(s) on disk.",
      '3. Retry up to **2 times** if generation fails.',
    ].join('\n'),
  };
}

export function scanStep(): Step {
  return {
    heading: 'Scan the image',
    body: [
      `1. Call **${TOOL_NAME.SCAN_IMAGE}** with the built image ID.`,
      `2. Review vulnerabilities. If critical/high issues are found, call **${TOOL_NAME.FIX_DOCKERFILE}** and rebuild. Retry up to **2 times**.`,
    ].join('\n'),
  };
}

export function validateManifestsStep(): Step {
  return {
    heading: 'Validate Kubernetes manifests (Recommended)',
    body: [
      `Call **${TOOL_NAME.VALIDATE_MANIFESTS}** to check the generated manifests against Azure AKS Deployment Safeguard rules:`,
      `1. Use the manifest file paths from the previous step.`,
      '2. Review the validation results for violations or warnings.',
      '3. If violations are found, fix the manifest files and re-run validation until all violations are resolved.',
      '4. Then proceed to cluster preparation.',
    ].join('\n'),
  };
}

export function validateManifestsStepAks(): Step {
  return {
    heading: 'Validate Kubernetes manifests (Recommended)',
    body: [
      `Call **${TOOL_NAME.VALIDATE_MANIFESTS}** to validate the generated manifests against Azure AKS Deployment Safeguard compliance:`,
      `1. Use the manifest file paths from the previous step.`,
      `2. Optionally provide the cluster context (e.g., your AKS cluster name) to enable cluster safeguard detection.`,
      `3. For definitive validation, use \`enableDryRun: true\` to test against the cluster's admission controllers via \`kubectl apply --dry-run=server\`.`,
      '4. Review the validation results for violations or warnings.',
      '5. If violations are found, fix the manifest files and re-run validation until all violations are resolved.',
      '6. Then proceed to cluster preparation.',
    ].join('\n'),
  };
}

export function deployStep(target: string): Step {
  return {
    heading: `Deploy to ${target}`,
    body: [
      '1. Apply the generated manifests using `kubectl apply -f <manifest-folder> --namespace <namespace>`.',
      '2. Retry up to **2 times** on failure.',
    ].join('\n'),
  };
}

export function verifyStep(extraLines?: string[]): Step {
  const lines = [
    `1. Call **${TOOL_NAME.VERIFY_DEPLOY}** with the namespace to check pod status, readiness, and events.`,
    '2. If verification fails, inspect pod logs and events, fix issues, and re-deploy. Retry up to **2 times**.',
  ];
  if (extraLines) {
    lines.push(...extraLines);
  }
  return {
    heading: 'Verify the deployment',
    body: lines.join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Shared rules
// ---------------------------------------------------------------------------

export const sharedRules = [
  '- **Retry failed steps at least 2 times** before reporting failure.',
  '- **Follow the chain hints** returned by each tool to determine next steps.',
  '- If a tool suggests calling another tool, follow that suggestion.',
  '- Keep the user informed of progress at each step.',
  '- If all retry attempts for a step are exhausted, report the failure clearly with diagnostic details.',
];

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

/**
 * Assemble a complete loop prompt with dynamically numbered steps.
 */
export function assemblePrompt(
  title: string,
  contextLines: string[],
  steps: Step[],
  rules: string[],
): string {
  const numberedSteps = steps
    .map((s, i) => `### Step ${i + 1} — ${s.heading}\n${s.body}`)
    .join('\n\n');

  return `You are driving a **${title}** using the containerization-assist MCP server tools.

## Context
${contextLines.join('\n')}

## Workflow — follow each step in order

${numberedSteps}

## Important rules
${rules.join('\n')}`;
}
