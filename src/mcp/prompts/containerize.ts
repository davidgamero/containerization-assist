/**
 * MCP Prompt: containerize
 *
 * Orchestrates the full containerization workflow by guiding an AI agent
 * through tool calls in the correct order, with retry logic and Docker CLI usage.
 *
 * @see {@link ../../../docs/adr/005-mcp-integration.md ADR-005: MCP Protocol Integration}
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const PROMPT_NAME = 'containerize';
const PROMPT_DESCRIPTION =
  'Guide an AI agent through the full containerization workflow: analyze, build, scan, deploy.';

/**
 * Prompt argument schema.
 * repositoryPath is required; all others are optional and will be clarified during the workflow.
 */
const promptArgsSchema = {
  repositoryPath: z.string().describe('Absolute path to the repository to containerize.'),
  targetEnvironment: z
    .string()
    .optional()
    .describe('Target environment: development, staging, or production. If omitted, ask the user.'),
  imageName: z
    .string()
    .optional()
    .describe('Docker image name (e.g., "myapp"). If omitted, derive from repository analysis.'),
  imageTag: z
    .string()
    .optional()
    .describe('Docker image tag (e.g., "v1.0.0"). Defaults to "latest".'),
  registry: z
    .string()
    .optional()
    .describe(
      'Container registry hostname (e.g., "myregistry.azurecr.io"). If omitted, skip push step.',
    ),
  namespace: z
    .string()
    .optional()
    .describe('Kubernetes namespace for deployment. Defaults to "default".'),
  manifestType: z
    .enum(['kubernetes', 'helm', 'aca', 'kustomize'])
    .optional()
    .describe('Type of deployment manifests to generate. Defaults to "kubernetes".'),
  skipDeploy: z
    .boolean()
    .optional()
    .describe(
      'If true, stop after image build+scan (skip manifest generation and deployment). Defaults to false.',
    ),
};

type PromptArgs = {
  repositoryPath: string;
  targetEnvironment?: string | undefined;
  imageName?: string | undefined;
  imageTag?: string | undefined;
  registry?: string | undefined;
  namespace?: string | undefined;
  manifestType?: string | undefined;
  skipDeploy?: boolean | undefined;
};

/**
 * Build the orchestration prompt message content.
 *
 * This returns a single user-role message that instructs the AI agent
 * to execute the containerization workflow step by step, calling the
 * MCP tools in the correct order.
 */
function buildPromptMessage(args: PromptArgs): string {
  const {
    repositoryPath,
    targetEnvironment,
    imageName,
    imageTag,
    registry,
    namespace,
    manifestType,
    skipDeploy,
  } = args;

  const envSection = targetEnvironment
    ? `The target environment is **${targetEnvironment}**.`
    : `The target environment was not specified. Before proceeding, ask the user which environment they are targeting: **development**, **staging**, or **production**. The choice affects Dockerfile optimization, replica counts, resource limits, and security settings. Do not proceed until the user confirms.`;

  const imageNameSection = imageName
    ? `Use image name: **${imageName}**`
    : `Derive the image name from the repository analysis (use the module name or repository directory name).`;

  const tagSection = imageTag ? `Tag: **${imageTag}**` : `Tag: **latest**`;

  const registrySection = registry
    ? `Push to registry: **${registry}**`
    : `No registry was specified. After scanning, ask the user if they want to push the image to a registry. If yes, ask for the registry hostname.`;

  const namespaceVal = namespace ?? 'default';
  const manifestTypeVal = manifestType ?? 'kubernetes';

  const deploySection = skipDeploy
    ? `\n\n## Scope\nThe user requested to **skip deployment**. Stop after Step 5 (scan-image). Do not generate manifests or deploy.`
    : '';

  return `You are a containerization assistant. Execute the following workflow step by step, calling the MCP tools provided by the containerization-assist server. Follow the order below. Do not skip steps unless explicitly noted.

## Context
- Repository path: \`${repositoryPath}\`
- ${envSection}
- ${imageNameSection}
- ${tagSection}
- ${registrySection}
- Kubernetes namespace: **${namespaceVal}**
- Manifest type: **${manifestTypeVal}**${deploySection}

---

## Workflow

### Step 1: Analyze Repository
Call **analyze-repo** with:
- \`repositoryPath\`: \`${repositoryPath}\`

Inspect the result. Note the detected modules, language, framework, dependencies, and ports. If the repository is a monorepo with multiple modules, you will need to repeat Steps 2–5 for each deployable module.

**On failure**: Report the error to the user. Check that the path exists and is accessible. Retry once. If it fails again, stop and ask the user for guidance.

---

### Step 2: Generate Dockerfile
Call **generate-dockerfile** with:
- \`repositoryPath\`: \`${repositoryPath}\`
- \`language\`: from Step 1 analysis
- \`languageVersion\`: from Step 1 analysis
- \`framework\`: from Step 1 analysis
- \`environment\`: the confirmed target environment
- \`detectedDependencies\`: from Step 1 analysis
- \`modulePath\`: (if monorepo) the module path from Step 1

This tool returns a **DockerfilePlan** — a set of recommendations, not an actual file. Use the plan's \`nextAction\` field to understand what Dockerfile content to write. **You must create the actual Dockerfile** by following the plan's recommendations, base image selections, and security considerations.

**On failure**: Check if the language/framework is supported. Report policy violations if any. Retry with adjusted parameters.

---

### Step 3: Fix / Validate Dockerfile
Call **fix-dockerfile** with:
- \`path\`: path to the Dockerfile you created in Step 2
- \`environment\`: the confirmed target environment

This validates the Dockerfile against best practices and organizational policies. Review the \`currentIssues\` and \`fixes\` in the result. **Apply all recommended fixes** to the Dockerfile before proceeding. If the validation score is below 70 (grade C or worse), iterate: fix the issues and call fix-dockerfile again until the score improves.

**On failure**: Review the validation errors. If policy violations block progress, inform the user and ask how to proceed.

---

### Step 4: Build Image
Call **build-image-context** with:
- \`path\`: build context directory (usually the repository or module root)
- \`dockerfile\`: relative path to the Dockerfile
- \`imageName\`: the image name
- \`tags\`: [\`${imageTag ?? 'latest'}\`]
- \`platform\`: \`linux/amd64\` (or as specified)

This tool **does not execute the build**. It returns a \`nextAction.buildCommand\` with the exact Docker CLI command to run.

**You must execute the build command yourself** using the Docker CLI:
1. Review the \`preChecks\` — ensure Docker daemon is running
2. Execute the \`buildCommand.command\` string in the terminal, from the \`buildContextPath\` directory, with the environment variables from \`buildCommand.environment\`
3. If the build fails, check the error output:
   - Missing dependencies → update the Dockerfile and re-run fix-dockerfile, then retry the build
   - Docker daemon not running → inform the user
   - Platform mismatch → try the \`fallbackCommand\` if provided
4. On success, proceed to Step 5

---

### Step 5: Scan Image
Call **scan-image** with:
- \`imageId\`: the built image name:tag (e.g., \`myapp:latest\`)
- \`severity\`: \`MEDIUM\` (report MEDIUM and above)
- \`enableAISuggestions\`: \`true\`

Review the scan results:
- If **passed** is \`true\`: proceed to Step 6
- If **passed** is \`false\` (vulnerabilities found):
  1. Report the vulnerability summary to the user
  2. Call **fix-dockerfile** to get remediation guidance for the security issues
  3. Apply fixes (update base images, pin versions, etc.)
  4. Rebuild the image (repeat Step 4)
  5. Re-scan (repeat Step 5)
  6. If after 2 remediation cycles vulnerabilities persist, report them to the user and ask whether to proceed or stop

**On failure** (scanner not installed, image not found): Check if Trivy/OSV is available. Try a different scanner (e.g., \`osv\` as fallback). If the image ID is wrong, verify the build output from Step 4.

---${
    skipDeploy
      ? `

### Done
The user requested to skip deployment. Report the final image name, tag, and scan results. Suggest next steps: push to registry, generate manifests, or deploy.`
      : `
### Step 6: Tag Image (if pushing to registry)
${
  registry
    ? `Call **tag-image** with:
- \`imageId\`: the built image
- \`tag\`: \`${registry}/${imageName ?? '<image-name>'}:${imageTag ?? 'latest'}\`

**On failure**: Verify the image exists locally (\`docker images\`). Check the tag format. Retry once.`
    : `If the user wants to push to a registry, call **tag-image** to apply the registry-qualified tag. Otherwise, skip to Step 8.`
}

---

### Step 7: Push Image (if registry specified)
${
  registry
    ? `Call **push-image** with:
- \`imageId\`: the tagged image from Step 6
- \`registry\`: \`${registry}\`

**On failure**: Check registry credentials (\`docker login\`). Verify network connectivity. If credentials are needed, ask the user. Retry once after fixing auth.`
    : `If the user provided a registry, call **push-image** with the tagged image and registry hostname. Otherwise, skip this step.`
}

---

### Step 8: Generate Manifests
Call **generate-k8s-manifests** with:
- \`name\`: module name from Step 1
- \`modulePath\`: module path from Step 1
- \`manifestType\`: \`${manifestTypeVal}\`
- \`environment\`: the confirmed target environment
- \`namespace\`: \`${namespaceVal}\`
- \`detectedDependencies\`: from Step 1

This returns a **ManifestPlan** — recommendations for creating Kubernetes/Helm/ACA manifests. Use the \`nextAction\` field to create the actual manifest files. **Write the manifest files yourself** following the plan.

**On failure**: Review policy violations. Check that module info is correct. Retry with corrected parameters.

---

### Step 9: Prepare Cluster
Call **prepare-cluster** with:
- \`environment\`: the confirmed target environment
- \`namespace\`: \`${namespaceVal}\`

This validates cluster connectivity, checks permissions, and ensures the namespace exists.

**On failure**: 
- Cluster not found → ask user to verify kubeconfig (\`kubectl cluster-info\`)
- Permission denied → report required RBAC roles
- Retry once after the user fixes the issue

---

### Step 10: Deploy Manifests
**This is a CLI step — there is no MCP tool for this.** Use kubectl directly:

\`\`\`bash
kubectl apply -f <manifest-folder> --namespace ${namespaceVal}
\`\`\`

If the manifests are Helm charts, use:
\`\`\`bash
helm install <release-name> <chart-path> --namespace ${namespaceVal}
\`\`\`

**On failure**: Check the kubectl/helm output. Common issues: image pull errors (registry auth), resource quota exceeded, invalid manifest YAML. Fix and retry.

---

### Step 11: Verify Deployment
Call **verify-deploy** with:
- \`deploymentName\`: the deployment name from the manifests
- \`namespace\`: \`${namespaceVal}\`
- \`checks\`: [\`pods\`, \`services\`, \`health\`]

Review the result. If pods are not ready, wait and retry (up to 3 times with 10-second intervals). Report the final deployment status, endpoints, and any issues to the user.

**On failure**: Check pod logs (\`kubectl logs\`), describe the deployment (\`kubectl describe deployment\`). Report findings to the user.`
  }

---

## General Guidelines

### Retry Policy
- **Retry each tool call up to 2 times** on transient failures (timeouts, temporary unavailability)
- **Do not retry** on validation errors or policy violations — fix the input first
- **After 2 failed retries**, report the error to the user and ask for guidance

### Error Recovery
- If a tool returns an error with guidance (hint + resolution), follow the resolution steps before retrying
- If a step fails and blocks the workflow, do not skip it — the subsequent steps depend on its output

### Docker CLI Usage
- Steps 4 and 10 require you to execute commands directly via the Docker CLI or kubectl
- Always verify Docker is running before Step 4: \`docker info\`
- Always verify cluster access before Step 9: \`kubectl cluster-info\`

### Environment Clarification
- If the target environment was not provided, you MUST ask before Step 2
- Environment affects: base image selection, multi-stage build strategy, resource limits, replica counts, security hardening level

### Monorepo Support
- If Step 1 detects multiple modules, inform the user and ask which modules to containerize
- Repeat Steps 2–5 for each selected module
- Generate manifests for all selected modules in Step 8
`;
}

/**
 * Register the containerize prompt with an MCP server instance.
 */
export function registerContainerizePrompt(server: McpServer): void {
  // Type assertion to avoid deep type instantiation issues with MCP SDK (TS2589)
  // Runtime safety is preserved by Zod schema validation of prompt arguments
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as McpServer & { prompt: any }).prompt(
    PROMPT_NAME,
    PROMPT_DESCRIPTION,
    promptArgsSchema,
    (args: PromptArgs) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: buildPromptMessage(args),
          },
        },
      ],
    }),
  );
}
